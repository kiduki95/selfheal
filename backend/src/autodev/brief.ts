import type { Db } from '../db/db.js';

// The grounded brief — selfheal's asymmetric advantage (spec §0, §4). Instead of handing the agent a
// raw issue and making it explore the repo (expensive, unstable), CodeFlow has already laid the map:
// exact files, blast-radius (callers), repro/expected/actual. The brief feeds the agent its destination.
export type ProposalKind = 'bug_fix' | 'feature_gap' | 'enhancement';

export interface BlastRadiusEntry {
  path: string;
  module: string;
  symbol: string | null;
  risk_tier: string;
  callers: number;
}

export interface GroundedBrief {
  repo: string;
  kind: ProposalKind;
  ref_id: string;
  title: string;
  // Issue draft markdown already produced by Insight.
  body: string;
  // Target module / file the proposal points at (proposals.target_module). The edit scope anchor.
  targetModule: string | null;
  // CodeFlow-derived files the agent should edit within (bug_fix: signal_group.code_artifact_ids).
  targetFiles: string[];
  // Impacted callers (Db.codeBlastRadius) — the agent must consider these; verify uses them as scope.
  blastRadius: BlastRadiusEntry[];
  // Risk tier fused by Insight (evidence.code_risk). 'critical' / payment-auth → always draft (spec §5).
  riskTier: string;
  // bug_fix grounding: defect repro/expected/actual (spec §4) pulled from evidence when present.
  defect?: { repro?: string[]; expected?: string | null; actual?: string | null };
  // Insight evidence blob (corroboration / band / effort / verdict) — context for the agent.
  evidence: Record<string, unknown>;
  // Rendered markdown instruction block (TDD-first, edit-within-blast-radius, commit convention).
  instructions: string;
}

// An approved proposal row as returned by Db.approvedProposals (proposals.* + decision fields).
export interface ProposalRow {
  repo: string;
  kind: string;
  ref_id: string;
  title: string;
  body: string;
  target_module: string | null;
  placement: string | null;
  evidence: Record<string, unknown> | null;
}

// Common instruction block (spec §4): failing-repro-test-first (TDD), edit only within blast-radius,
// commit message convention. Per-kind framing differs (what to reproduce / where to place).
function renderInstructions(kind: ProposalKind, brief: Omit<GroundedBrief, 'instructions'>): string {
  const files = brief.targetFiles.length ? brief.targetFiles.map((f) => `- \`${f}\``).join('\n') : '- (none mapped — stay within the target module)';
  const radius = brief.blastRadius.length
    ? brief.blastRadius.map((b) => `- \`${b.path}\`${b.symbol ? ` (${b.symbol})` : ''} — ${b.callers} caller(s), risk ${b.risk_tier}`).join('\n')
    : '- (no callers mapped)';
  const commitConv = `selfheal(${kind}): <summary>  [ref ${brief.ref_id.slice(0, 8)}]`;

  const kindGuidance =
    kind === 'bug_fix'
      ? `## Goal: fix the defect\n${defectBlock(brief.defect)}\nWrite a FAILING test that reproduces this defect FIRST (TDD), then make it pass.`
      : kind === 'feature_gap'
        ? `## Goal: implement the missing feature\nPlacement: \`${brief.targetModule ?? 'new module'}\`. Add a test that asserts the new behavior FIRST, then implement.`
        : `## Goal: enhance the existing feature\nAnchor: \`${brief.targetModule ?? '?'}\`. Add/extend a test for the improved behavior FIRST, then implement.`;

  return [
    `# Auto-Dev brief — ${brief.title}`,
    '',
    kindGuidance,
    '',
    '## Files to edit (CodeFlow-grounded)',
    files,
    '',
    '## Blast radius — these callers may break; do NOT edit outside this set',
    radius,
    '',
    '## Rules',
    '- Edit ONLY within the target module ∪ blast-radius. Touching unrelated files fails verification.',
    '- Failing-repro test FIRST, then the fix (TDD). Keep the diff minimal.',
    `- Commit message convention: \`${commitConv}\``,
    '',
    '## Proposal',
    brief.body,
  ].join('\n');
}

function defectBlock(defect: GroundedBrief['defect']): string {
  if (!defect) return 'Reproduce the user-reported failure described in the proposal below.';
  const lines: string[] = [];
  if (defect.repro?.length) lines.push(`- Repro: ${defect.repro.join(' → ')}`);
  if (defect.expected) lines.push(`- Expected: ${defect.expected}`);
  if (defect.actual) lines.push(`- Actual: ${defect.actual}`);
  return lines.length ? lines.join('\n') : 'Reproduce the user-reported failure described in the proposal below.';
}

// Assemble a GroundedBrief from an approved proposal + CodeFlow queries (spec §4). Pure-ish: the only
// IO is the optional CodeFlow query through `db`; everything else is derived from the proposal row, so
// brief assembly is unit-testable without a live DB by passing precomputed blastRadius.
export async function assembleBrief(
  proposal: ProposalRow,
  opts: { db?: Db; blastRadius?: BlastRadiusEntry[]; blastRadiusLimit?: number } = {},
): Promise<GroundedBrief> {
  const kind = proposal.kind as ProposalKind;
  const evidence = (proposal.evidence ?? {}) as Record<string, unknown>;

  // risk tier: Insight fuses path heuristic + blast-radius into evidence.code_risk (bug_fix). Fall back to 'low'.
  const riskTier = String(evidence.code_risk ?? evidence.risk_tier ?? 'low');

  // CodeFlow blast-radius: query if a db is provided, else use the injected fixture (deterministic tests).
  let blastRadius: BlastRadiusEntry[] = opts.blastRadius ?? [];
  if (!opts.blastRadius && opts.db) {
    const rows = await opts.db.codeBlastRadius(proposal.repo, opts.blastRadiusLimit ?? 20);
    // Narrow to the target module when known (the agent's scope), else keep the top of the repo radius.
    const tgt = proposal.target_module;
    blastRadius = rows
      .filter((r) => !tgt || r.module === tgt || r.path === tgt || r.path.includes(tgt))
      .map((r) => ({ path: r.path, module: r.module, symbol: r.symbol, risk_tier: r.risk_tier, callers: r.callers }));
  }

  // bug_fix defect grounding from evidence (Insight may carry repro/expected/actual under `defect`).
  const defectRaw = (evidence.defect ?? null) as { repro?: string[]; expected?: string | null; actual?: string | null } | null;
  const defect = kind === 'bug_fix' && defectRaw ? defectRaw : undefined;

  // target files: explicit list in evidence, else derive from blast-radius paths, else the target module.
  const targetFiles = Array.isArray(evidence.target_files)
    ? (evidence.target_files as string[])
    : blastRadius.length
      ? [...new Set(blastRadius.map((b) => b.path))]
      : proposal.target_module
        ? [proposal.target_module]
        : [];

  const base: Omit<GroundedBrief, 'instructions'> = {
    repo: proposal.repo,
    kind,
    ref_id: proposal.ref_id,
    title: proposal.title,
    body: proposal.body,
    targetModule: proposal.target_module,
    targetFiles,
    blastRadius,
    riskTier,
    defect,
    evidence,
  };
  return { ...base, instructions: renderInstructions(kind, base) };
}
