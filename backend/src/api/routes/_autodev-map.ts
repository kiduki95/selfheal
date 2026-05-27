// DB-row → contract mappers for the Auto-Dev layer (GET /api/agents, GET /api/activity).
// Pure shaping, no LLM. agent_runs → AgentRun (with steps reconstructed from agent_run_events);
// agent_run_events → AuditEvent. Fields with no real source in the dry-run (GitHub PR number,
// diff line counts) are defaulted and flagged, so the frontend contract stays satisfied without
// fabricating data.
import type { AgentRun, AgentStep, AuditEvent } from '../contract.js';
import { toRelativeLong } from '../format.js';

type RunRow = {
  id: string; kind: string; ref_id: string; title: string | null; decision: string | null;
  branch: string | null; status: string; attempt: number; pr_url: string | null;
  verdict: any; error: string | null; started_at: string;
};
type EventRow = { id: string; run_id: string; ts: string; phase: string; message: string | null; payload: any; branch: string | null; kind: string; ref_id: string };

const FAIL = new Set(['failed', 'timed_out', 'rejected_by_verifier', 'canceled']);
const DONE = new Set(['pr_open', 'succeeded']);

// Our run statuses → the frontend's 4-value union.
function toAgentStatus(status: string, decision: string | null): AgentRun['status'] {
  if (decision === 'merged') return 'merged';
  if (DONE.has(status)) return 'review-needed'; // handoff = awaiting human review (dry-run, no merge)
  if (FAIL.has(status)) return 'failed';
  return 'running'; // queued/preparing/planning/implementing/verifying
}

const PROGRESS: Record<string, number> = {
  queued: 5, preparing: 15, planning: 30, implementing: 55, verifying: 80,
  pr_open: 100, succeeded: 100, failed: 100, timed_out: 100, rejected_by_verifier: 100, canceled: 100,
};

// kind → remediation skill label (same mapping the proposals route uses).
const KIND_SKILL: Record<string, string> = { bug_fix: 'debugging', feature_gap: 'feature-dev', enhancement: 'enhancement' };

// The canonical phase sequence shown as the run's step timeline.
const STEP_DEFS: { phase: string; label: string; desc: string }[] = [
  { phase: 'preparing', label: 'Prepare', desc: 'isolated worktree + branch' },
  { phase: 'planning', label: 'Plan', desc: 'CodeFlow-grounded brief' },
  { phase: 'implementing', label: 'Implement', desc: 'apply edits in scope' },
  { phase: 'verifying', label: 'Verify', desc: 'deterministic gates' },
  { phase: 'pr_open', label: 'Handoff', desc: 'patch + PR body (dry-run)' },
];

function buildSteps(status: string, events: EventRow[]): { steps: AgentStep[]; failedAt?: number } {
  const reached = new Set(events.map((e) => e.phase));
  // events arrive newest-first; iterate so the EARLIEST ts of each phase wins as its timestamp.
  const phaseTs = new Map<string, string>();
  for (const e of events) phaseTs.set(e.phase, e.ts);
  const failed = FAIL.has(status);
  const done = DONE.has(status);
  const lastReachedIdx = STEP_DEFS.reduce((acc, s, i) => (reached.has(s.phase) ? i : acc), -1);

  let failedAt: number | undefined;
  const steps = STEP_DEFS.map((s, i): AgentStep => {
    let state: AgentStep['state'];
    if (done) state = reached.has(s.phase) ? 'done' : 'idle';
    else if (failed) {
      if (i < lastReachedIdx) state = 'done';
      else if (i === lastReachedIdx) { state = 'failed'; failedAt = i; }
      else state = 'idle';
    } else {
      // running: the current phase is active, earlier reached phases are done.
      if (s.phase === status) state = 'active';
      else if (reached.has(s.phase) && i < lastReachedIdx) state = 'done';
      else if (reached.has(s.phase)) state = 'active';
      else state = 'idle';
    }
    const t = phaseTs.get(s.phase);
    return { label: s.label, desc: s.desc, state, ...(t ? { t: toRelativeLong(t) } : {}) };
  });
  return { steps, failedAt };
}

export function toAgentRun(run: RunRow, events: EventRow[]): AgentRun {
  const { steps, failedAt } = buildSteps(run.status, events);
  const files = Array.isArray(run.verdict?.changedFiles) ? run.verdict.changedFiles.length : 0;
  const out: AgentRun = {
    id: run.id,
    proposal: run.ref_id,
    title: run.title ?? `[${run.kind}] ${run.ref_id.slice(0, 8)}`,
    branch: run.branch ?? '',
    status: toAgentStatus(run.status, run.decision),
    progress: PROGRESS[run.status] ?? 0,
    started: toRelativeLong(run.started_at),
    eta: '—', // no model timing in the stub/dry-run
    issue: 0, // dry-run: no GitHub issue number
    skill: KIND_SKILL[run.kind] ?? 'unknown',
    steps,
    // diff: verify records changed-file count; line counts aren't tracked in v1 → 0. TODO(v2): numstat.
    diff: { added: 0, removed: 0, files },
  };
  if (failedAt !== undefined) out.failedAt = failedAt;
  if (run.error) out.error = run.error;
  return out;
}

// --- activity feed ---
const TONE: Record<string, AuditEvent['tone']> = {
  queued: 'info', preparing: 'purple', planning: 'purple', implementing: 'accent',
  verifying: 'info', pr_open: 'good', failed: 'danger', rejected_by_verifier: 'danger',
  timed_out: 'warn', canceled: 'warn',
};

function pad(n: number): string { return String(n).padStart(2, '0'); }
function timeOfDay(d: Date): string { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function dayBucket(d: Date): string {
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toISOString().slice(0, 10);
}
function truncate(s: string, n = 300): string { return s.length > n ? s.slice(0, n) + '…' : s; }

export function toAuditEvent(e: EventRow): AuditEvent {
  const d = new Date(e.ts);
  return {
    id: e.id,
    t: timeOfDay(d),
    day: dayBucket(d),
    actor: 'selfheal-autodev',
    actorKind: 'agent',
    type: e.phase,
    title: e.message ?? e.phase,
    target: e.branch ?? `${e.kind}/${e.ref_id.slice(0, 8)}`,
    detail: e.payload != null ? truncate(JSON.stringify(e.payload)) : '',
    tone: TONE[e.phase] ?? 'info',
  };
}
