import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from '../db/db.js';
import { assembleBrief, type ProposalRow, type GroundedBrief, type BlastRadiusEntry } from './brief.js';
import { createWorkspace, runBeforeRun, runAfterRun, type Workspace, type WorkspaceHooks } from './workspace.js';
import { makeAgentDriver } from './drivers/index.js';
import type { AgentDriver } from './drivers/types.js';
import { verify, backoffMs, type VerifyConfig, type VerifyResult } from './verify.js';

// AutoDev Orchestrator (spec §2, §3, §6). The SINGLE authority that serializes state transitions so a
// proposal is never double-dispatched. Per run: prepare → brief → DRIVE → VERIFY (bounded retry) →
// handoff (dry-run patch + PR-body artifact). No GitHub push.

export interface RunAutoDevOpts {
  // DB handle (injected by tests for the isolated harness). Default: a new Db() closed on completion.
  db?: Db;
  // Base ref to branch worktrees from (default: mirror HEAD). Forwarded to createWorkspace.
  baseRef?: string;
  // Mirror source = product repo local checkout (codeflow rootDir). Required for real worktrees.
  mirrorDir: string;
  // Where per-run worktrees live. Default derived from mirrorDir.
  workspacesRoot?: string;
  // Where dry-run patch + PR-body artifacts are written (persists past worktree teardown).
  // Default: <workspacesRoot>/.artifacts.
  artifactsDir?: string;
  // Concurrency slots (sequential per slot; v1 default 1 — deterministic).
  concurrency?: number;
  // Max verify retries before rejected_by_verifier (spec §5). Default 2 → attempts 0,1,2.
  maxAttempts?: number;
  // Driver override (DI). Default makeAgentDriver() → stub.
  driver?: AgentDriver;
  // Verify config (injectable build/test/skeptic + scope tolerance).
  verify?: VerifyConfig;
  // Workspace lifecycle hooks (after_create/before_run/after_run). before_run injects the brief file.
  hooks?: WorkspaceHooks;
  // Inject blast-radius for brief assembly (deterministic tests); else queried via Db.codeBlastRadius.
  blastRadius?: BlastRadiusEntry[];
  // Sleep impl (injected so tests don't actually wait the exponential backoff). Default no-op in tests.
  sleep?: (ms: number) => Promise<void>;
  // Skip the real backoff wait entirely (tests). When true, sleep is never called.
  noBackoff?: boolean;
  log?: (msg: string) => void;
}

export interface RunOutcome {
  runId: string;
  ref_id: string;
  kind: string;
  status: string;
  branch?: string;
  artifactPath?: string;
  verdict?: VerifyResult;
  error?: string;
}

const TERMINAL_OK = 'pr_open'; // handoff terminal state; we also flip proposal_reviews → in_dev.

export async function runAutoDev(repo: string, opts: RunAutoDevOpts): Promise<RunOutcome[]> {
  const db = opts.db ?? new Db();
  const log = opts.log ?? (() => {});
  const driver = opts.driver ?? makeAgentDriver();
  const maxAttempts = opts.maxAttempts ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Dispatch queue: approved proposals with no active/succeeded run (spec §6.2).
  const approved = (await db.approvedProposals(repo)) as ProposalRow[];
  const queue: ProposalRow[] = [];
  for (const p of approved) {
    const active = await db.activeRunFor(p.repo, p.kind, p.ref_id);
    if (!active) queue.push(p);
    else log(`skip ${p.kind}/${String(p.ref_id).slice(0, 8)} — active/succeeded run ${active.id} (${active.status})`);
  }

  const outcomes: RunOutcome[] = [];
  // Concurrency: simple slotting. v1 default 1 keeps the loop fully deterministic; raising it runs
  // independent proposals in parallel (each run is isolated in its own worktree).
  const slots = Math.max(1, opts.concurrency ?? 1);
  for (let i = 0; i < queue.length; i += slots) {
    const batch = queue.slice(i, i + slots);
    const results = await Promise.all(batch.map((p) => runOne(repo, p, { db, log, driver, maxAttempts, sleep, ...opts })));
    outcomes.push(...results.filter((r): r is RunOutcome => r !== null));
  }
  if (!opts.db) await db.close();
  return outcomes;
}

// One isolated run. claim → prepare → brief → DRIVE → VERIFY(retry) → handoff. All status transitions
// go through db.updateAgentRun (the single serialization authority) and emit agent_run_events.
async function runOne(
  repo: string,
  proposal: ProposalRow,
  ctx: { db: Db; log: (m: string) => void; driver: AgentDriver; maxAttempts: number; sleep: (ms: number) => Promise<void> } & RunAutoDevOpts,
): Promise<RunOutcome | null> {
  const { db, log, driver, maxAttempts } = ctx;

  // CLAIM — insert against the partial-unique active index. Null ⇒ another run already owns it.
  const run = await db.createAgentRun({ repo, kind: proposal.kind, ref_id: proposal.ref_id, status: 'queued' });
  if (!run) {
    log(`claim refused for ${proposal.kind}/${String(proposal.ref_id).slice(0, 8)} (already active)`);
    return null;
  }
  const runId = run.id;
  const transition = async (status: string, phase: string, message: string | null, payload?: unknown) => {
    await db.updateAgentRun(runId, { status });
    await db.appendRunEvent(runId, phase, message, payload);
    log(`run ${runId.slice(0, 8)} → ${status}${message ? `: ${message}` : ''}`);
  };

  let ws: Workspace | null = null;
  try {
    // PREPARE — worktree + branch (after_create hook inside createWorkspace).
    await transition('preparing', 'preparing', 'creating worktree');
    ws = await createWorkspace({
      mirrorDir: ctx.mirrorDir,
      workspacesRoot: ctx.workspacesRoot,
      repo,
      kind: proposal.kind,
      ref_id: proposal.ref_id,
      hooks: ctx.hooks,
      baseRef: ctx.baseRef,
    });
    await db.updateAgentRun(runId, { branch: ws.branch, base_sha: ws.baseSha, workspace_path: ws.path });

    // BRIEF — CodeFlow-grounded brief (spec §4).
    await transition('planning', 'planning', 'assembling grounded brief');
    const brief = await assembleBrief(proposal, { db: ctx.blastRadius ? undefined : db, blastRadius: ctx.blastRadius });
    await runBeforeRun(ws, ctx.hooks); // before_run: inject brief/AGENTS.md

    // DRIVE + VERIFY with bounded retry (spec §5).
    let verdict: VerifyResult | null = null;
    let feedback: string | undefined;
    let attempt = 0;
    for (; attempt <= maxAttempts; attempt++) {
      await db.updateAgentRun(runId, { attempt });
      await transition('implementing', 'implementing', `driver attempt ${attempt}`);
      const result = await driver.run({ workspace: ws.path, brief, attempt, feedback });
      for (const f of result.filesChanged) ws.assertInside(f); // agent must not escape (spec §4)
      await db.appendRunEvent(runId, 'implementing', result.summary, { filesChanged: result.filesChanged, turnCount: result.turnCount });

      await transition('verifying', 'verifying', `verify attempt ${attempt}`);
      verdict = await verify(ws, brief, ctx.verify ?? {});
      await db.appendRunEvent(runId, 'verifying', verdict.ok ? 'gates passed' : 'gates failed', { gates: verdict.gates, manualReview: verdict.manualReview });
      if (verdict.ok) break;

      feedback = verdict.feedback;
      // Reset the worktree so a failed attempt's edits don't accumulate into the next diff.
      if (attempt < maxAttempts) {
        ws.git(['reset', '--hard']);
        ws.git(['clean', '-fd']);
        if (!ctx.noBackoff) await ctx.sleep(backoffMs(attempt));
      }
    }

    if (!verdict || !verdict.ok) {
      // Exhausted retries → rejected_by_verifier (spec §5).
      await db.updateAgentRun(runId, { status: 'rejected_by_verifier', verdict: verdict ?? undefined, error: verdict?.feedback ?? 'verification failed' });
      await db.appendRunEvent(runId, 'rejected_by_verifier', 'retries exhausted', { gates: verdict?.gates });
      return { runId, ref_id: proposal.ref_id, kind: proposal.kind, status: 'rejected_by_verifier', branch: ws.branch, verdict: verdict ?? undefined };
    }

    // HANDOFF — commit + produce dry-run patch + PR-body artifact. NO push (spec §1). Artifacts are
    // written OUTSIDE the worktree (it gets torn down in finally) so the dry-run output persists.
    const artifactsDir = ctx.artifactsDir ?? join(ws.path, '..', '..', '.artifacts');
    const artifactPath = await handoff(ws, brief, verdict, artifactsDir);
    await db.updateAgentRun(runId, { status: TERMINAL_OK, verdict, pr_url: artifactPath });
    await db.appendRunEvent(runId, 'pr_open', verdict.manualReview ? 'handoff (draft — manual review required)' : 'handoff', { artifactPath, manualReview: verdict.manualReview });

    // Flip proposal_reviews → in_dev on success (spec §6.8). Keyed on the stable identity.
    await db.decideProposal({ repo, kind: proposal.kind, ref_id: proposal.ref_id, decision: 'in_dev' });

    return { runId, ref_id: proposal.ref_id, kind: proposal.kind, status: TERMINAL_OK, branch: ws.branch, artifactPath, verdict };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await db.updateAgentRun(runId, { status: 'failed', error: msg });
    await db.appendRunEvent(runId, 'failed', msg);
    log(`run ${runId.slice(0, 8)} failed: ${msg}`);
    return { runId, ref_id: proposal.ref_id, kind: proposal.kind, status: 'failed', error: msg, branch: ws?.branch };
  } finally {
    // after_run hook then teardown (rollback/cleanup of the worktree — spec §4).
    if (ws) {
      try { await runAfterRun(ws, ctx.hooks); } catch { /* best effort */ }
      try { ws.cleanup(); } catch { /* best effort */ }
    }
  }
}

// Dry-run handoff: commit on the branch, then write a `.patch` (git format-patch-style diff) + a PR-body
// markdown next to it under the artifacts dir. Returns the patch path (stored as agent_runs.pr_url).
async function handoff(ws: Workspace, brief: GroundedBrief, verdict: VerifyResult, artifactsDir: string): Promise<string> {
  const commitMsg = `selfheal(${brief.kind}): ${brief.title}\n\n[ref ${brief.ref_id.slice(0, 8)}]`;
  ws.git(['add', '-A']);
  // Hermetic identity: the real target repo (e.g. kiduki-gcs) may have no user.name/email configured,
  // which would make `git commit` throw AFTER verify already passed — losing a valid diff. Pin it.
  ws.git(['-c', 'user.email=autodev@selfheal.local', '-c', 'user.name=selfheal-autodev', 'commit', '-m', commitMsg, '--no-verify']);

  mkdirSync(artifactsDir, { recursive: true });

  // Patch = diff of the branch vs the pinned base sha (the full change set; well-defined regardless
  // of how many commits the run made).
  const patch = ws.git(['diff', ws.baseSha, 'HEAD']);
  const patchPath = join(artifactsDir, `${brief.kind}-${brief.ref_id.slice(0, 8)}.patch`);
  writeFileSync(patchPath, patch);

  const draft = verdict.manualReview;
  const prBody = renderPrBody(ws, brief, verdict, draft);
  writeFileSync(join(artifactsDir, `${brief.kind}-${brief.ref_id.slice(0, 8)}.pr.md`), prBody);

  return patchPath;
}

function renderPrBody(ws: Workspace, brief: GroundedBrief, verdict: VerifyResult, draft: boolean): string {
  const gateLines = verdict.gates
    .map((g) => `- ${g.pass ? (g.warning ? '⚠️' : '✅') : '❌'} **${g.name}**${g.reason ? ` — ${g.reason}` : ''}`)
    .join('\n');
  return [
    `# ${draft ? '[DRAFT] ' : ''}${brief.title}`,
    '',
    draft ? '> ⚠️ Risk tier requires manual review — opened as a draft (auto-ready disabled, spec §5).' : '',
    `Branch: \`${ws.branch}\``,
    `Kind: \`${brief.kind}\` · Ref: \`${brief.ref_id.slice(0, 8)}\` · Risk: \`${brief.riskTier}\``,
    '',
    '## Changed files',
    verdict.changedFiles.map((f) => `- \`${f}\``).join('\n') || '- (none)',
    '',
    '## Verification gates',
    gateLines,
    '',
    '## Proposal',
    brief.body,
  ].join('\n');
}
