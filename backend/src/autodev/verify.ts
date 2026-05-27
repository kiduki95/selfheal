import type { Workspace } from './workspace.js';
import type { GroundedBrief } from './brief.js';

// Verification — the reliability core (spec §5). v1 = deterministic gate only (always, free):
//   1. diff non-empty
//   2. diff scope ⊆ (target_module ∪ blast-radius ± tolerance)  — reject scattershot edits
//   3. build / typecheck passes
//   4. test passes (ceiling = typecheck+build when no suite)
//   5. bug_fix: a new regression test SHOULD exist — warn (non-blocking in v1; becomes blocking in v2)
// v2 = adversarial Skeptic (claude-cli) via the typed hook below. Both must pass to PR.
// Risk tier rule: critical / payment-auth proposals always force draft + manualReview (no auto-ready).

export interface GateResult {
  name: string;
  pass: boolean;
  reason?: string;
  // Non-blocking advisory (e.g. missing regression test in v1). Does not fail the gate.
  warning?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  gates: GateResult[];
  // Files in the diff (repo-relative) — recorded for audit + the PR body.
  changedFiles: string[];
  // Forced human review (risk tier) even when gates pass — PR must open as a draft (spec §5).
  manualReview: boolean;
  // Skeptic verdict slot (v2). Always null in v1; the hook point is wired so v2 is a drop-in.
  skeptic: SkepticVerdict | null;
  // Aggregated feedback to re-inject into the driver on retry.
  feedback: string;
}

// v2 Skeptic hook point (spec §5). A v2 implementation reviews the diff against the proposal and
// returns a verdict; v1 leaves this unset so the gate is purely deterministic.
export interface SkepticVerdict {
  pass: boolean;
  reasons: string[];
}
export type Skeptic = (input: { brief: GroundedBrief; changedFiles: string[]; diff: string }) => Promise<SkepticVerdict>;

// Injectable command runner so deterministic tests point build/test at a fixture with known pass/fail
// instead of depending on a heavy external repo. Returns ok + captured output.
export interface CommandResult { ok: boolean; output: string; skipped?: boolean }
export type CommandRunner = (ws: Workspace) => Promise<CommandResult> | CommandResult;

export interface VerifyConfig {
  // Scope tolerance: extra repo-relative path prefixes allowed beyond target_module ∪ blast-radius
  // (e.g. a test dir). Calibration is open question #4.
  scopeAllow?: string[];
  // build / typecheck command. Omit → gate skipped at the ceiling (treated as pass, marked skipped).
  build?: CommandRunner;
  // test command. Omit → ceiling = typecheck+build (spec §5.4); gate marked skipped.
  test?: CommandRunner;
  // v2 Skeptic. Omit in v1.
  skeptic?: Skeptic;
}

// Risk tiers that force manual review regardless of gate outcome (spec §5).
const FORCE_REVIEW_TIERS = new Set(['critical', 'payment', 'auth', 'payment-auth', 'payment_auth']);

// Normalize a path for prefix comparison.
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

// Is `file` within scope = any of the allowed prefixes (module/path roots)? A file matches a prefix
// when it equals it or sits under it (prefix + '/') — path-ROOT matching only (see the inner comment
// for why bare-name substring matching was removed).
function inScope(file: string, prefixes: string[]): boolean {
  const f = norm(file);
  return prefixes.some((p) => {
    const pre = norm(p).replace(/\/+$/, '');
    if (!pre) return false;
    // Path-ROOT match only: equal to the prefix, or under it (prefix + '/'). NO segment-substring
    // matching — that let out-of-scope edits slip through for short/bare module names (e.g. module
    // 'orders' wrongly accepting 'src/billing/orders/x.ts'). Scope = targetFiles ∪ blastRadius paths ∪
    // targetModule dir ∪ tests ∪ scopeAllow; bug targets are real code paths, so root matching is right.
    return f === pre || f.startsWith(pre + '/');
  });
}

// Looks like a test file (heuristic for the bug_fix regression-test warning).
function isTestFile(p: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
}

// The diff scope set: target module + blast-radius paths/modules + configured tolerance.
export function scopePrefixes(brief: GroundedBrief, allow: string[] = []): string[] {
  const set = new Set<string>(allow);
  if (brief.targetModule) set.add(brief.targetModule);
  for (const f of brief.targetFiles) set.add(f);
  for (const b of brief.blastRadius) { set.add(b.path); set.add(b.module); }
  return [...set].filter(Boolean);
}

// Run the v1 deterministic gate. `git` is read from the workspace; build/test are injected.
export async function verify(ws: Workspace, brief: GroundedBrief, cfg: VerifyConfig = {}): Promise<VerifyResult> {
  const gates: GateResult[] = [];

  // Stage the worktree so the diff captures new + modified files uniformly.
  ws.git(['add', '-A']);
  const diff = ws.git(['diff', '--cached']);
  const nameOnly = ws.git(['diff', '--cached', '--name-only']).split('\n').map((s) => s.trim()).filter(Boolean);
  const changedFiles = nameOnly.map(norm);

  // Gate 1: diff non-empty.
  const nonEmpty = changedFiles.length > 0;
  gates.push({ name: 'diff_nonempty', pass: nonEmpty, reason: nonEmpty ? undefined : 'no files changed' });

  // Gate 2: scope ⊆ target_module ∪ blast-radius ± tolerance.
  const prefixes = scopePrefixes(brief, cfg.scopeAllow);
  const out = changedFiles.filter((f) => !inScope(f, prefixes) && !isTestFile(f));
  const scopeOk = nonEmpty && out.length === 0;
  gates.push({
    name: 'diff_scope',
    pass: scopeOk,
    reason: out.length ? `edits outside scope: ${out.join(', ')} (allowed: ${prefixes.join(', ') || 'none'})` : undefined,
  });

  // Gate 3: build / typecheck.
  const buildRes = cfg.build ? await cfg.build(ws) : { ok: true, output: '', skipped: true };
  gates.push({ name: 'build', pass: buildRes.ok, reason: buildRes.ok ? undefined : truncate(buildRes.output), warning: buildRes.skipped });

  // Gate 4: test (ceiling = typecheck+build when no suite).
  const testRes = cfg.test ? await cfg.test(ws) : { ok: true, output: '', skipped: true };
  gates.push({
    name: 'test',
    pass: testRes.ok,
    reason: testRes.ok ? (testRes.skipped ? 'no test suite — ceiling at typecheck+build' : undefined) : truncate(testRes.output),
    warning: testRes.skipped,
  });

  // Gate 5: bug_fix regression-test-present (non-blocking warning in v1).
  if (brief.kind === 'bug_fix') {
    const hasTest = changedFiles.some(isTestFile);
    gates.push({ name: 'regression_test', pass: true, warning: !hasTest, reason: hasTest ? undefined : 'no new regression test in diff (non-blocking in v1)' });
  }

  // v2 Skeptic hook (deterministic gate must also pass for the Skeptic to even run).
  let skeptic: SkepticVerdict | null = null;
  const blockingPass = gates.every((g) => g.pass);
  if (blockingPass && cfg.skeptic) {
    skeptic = await cfg.skeptic({ brief, changedFiles, diff });
  }

  const ok = blockingPass && (skeptic ? skeptic.pass : true);
  const manualReview = FORCE_REVIEW_TIERS.has(brief.riskTier.toLowerCase());

  const feedback = buildFeedback(gates, skeptic);
  return { ok, gates, changedFiles, manualReview, skeptic, feedback };
}

function buildFeedback(gates: GateResult[], skeptic: SkepticVerdict | null): string {
  const lines = gates.filter((g) => !g.pass).map((g) => `- [${g.name}] ${g.reason ?? 'failed'}`);
  if (skeptic && !skeptic.pass) for (const r of skeptic.reasons) lines.push(`- [skeptic] ${r}`);
  return lines.length ? `Verification failed:\n${lines.join('\n')}` : '';
}

function truncate(s: string, n = 2000): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Bounded-retry backoff (spec §5): min(10s · 2^n, 5m). Exposed for the orchestrator + tests.
export function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** attempt, 5 * 60_000);
}
