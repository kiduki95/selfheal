import type { Trend } from '../util/trend.js'; // 'new' | 'rising' | 'stable' | 'declining'

// Insight lifecycle helpers — pure, deterministic, no DB/IO/async.
// The orchestrator fetches the underlying counts/flags and calls these; we only decide.
//   ④ suppressionDecision — should a bug proposal be muted because the incident looks resolved?
//   ⑥ estimateEffort     — coarse pre-PR effort hint (S/M/L/XL + weeks) for product triage.

// ④ Lifecycle / suppression ----------------------------------------------------
// A resolution report ("works now after the update") is negative evidence: it says the
// incident is gone. Today such reports are stored but never act on the proposal, so a
// fixed bug keeps getting re-proposed (with stale reviews attached). We suppress a bug
// proposal once it is resolved AND has not regressed.
export interface SuppressionInput {
  resolutionReports: number;        // # of "fixed now" reports linked to the signal group
  reportsSinceResolution: number;   // # of NEW defect reports created AFTER the latest resolution report (regression signal)
  trend: Trend;                     // declining = the group is fading on its own
  corroboration: number;            // # of corroborating defect reports overall (group strength)
}
export interface SuppressionResult {
  suppress: boolean;
  reason: string;
}

// Tolerance: a lone late defect report can be noise (a stale review, a duplicate) rather than a
// true regression. We allow a small number of post-resolution reports before resurfacing, scaled
// by how strong the group was — a once-loud incident needs more than one straggler to come back.
function regressionTolerance(corroboration: number): number {
  // 0 for weak groups, up to 1 for well-corroborated ones. Kept deliberately small: the spec's
  // rule of thumb is "no (or negligible) new reports after resolution".
  return corroboration >= 5 ? 1 : 0;
}

export function suppressionDecision(i: SuppressionInput): SuppressionResult {
  // No resolution evidence → nothing to suppress; let normal prioritization run.
  if (i.resolutionReports <= 0) {
    return { suppress: false, reason: 'no resolution report — proposal stands' };
  }

  // Regression check: defect reports filed AFTER the latest resolution mean the fix did not hold.
  // Resurface (do NOT suppress) once they exceed the small tolerance for the group's strength.
  const tolerance = regressionTolerance(i.corroboration);
  if (i.reportsSinceResolution > tolerance) {
    return {
      suppress: false,
      reason: `regression: ${i.reportsSinceResolution} new defect report(s) after resolution (tolerance ${tolerance}) — resurface`,
    };
  }

  // Resolved and not regressed. A declining trend is extra confirmation it is truly fading; we note
  // it but do not require it (a fresh-but-resolved incident should still be suppressed).
  const trendNote = i.trend === 'declining' ? ' (trend declining — confirms fade)' : '';
  const within = i.reportsSinceResolution > 0
    ? ` (${i.reportsSinceResolution} late report within tolerance ${tolerance})`
    : '';
  return {
    suppress: true,
    reason: `resolved by ${i.resolutionReports} report(s), no regression${within}${trendNote}`,
  };
}

// ⑥ Effort estimate -----------------------------------------------------------
// We have no diff yet, so estimate from pre-PR signals: the kind of work, how many modules it
// likely spans (CodeFlow connection plan / blast-radius), whether it lands a brand-new module,
// and how many dependents the target has (more dependents = more careful, higher-risk work).
export type EffortSize = 'S' | 'M' | 'L' | 'XL';
export interface EffortInput {
  kind: 'bug_fix' | 'feature_gap' | 'enhancement';
  touchedModules: number;     // # of code modules the work likely spans
  isNewModule: boolean;       // feature_gap placed as a brand-new module
  blastRadius: number;        // # of dependents on the target (risk/care multiplier)
}
export interface EffortResult {
  size: EffortSize;
  weeks: string;
  rationale: string;
}

const SIZES = ['S', 'M', 'L', 'XL'] as const;
// Coarse, human-readable duration per size. Strings are intentionally fuzzy (pre-PR estimate).
const SIZE_WEEKS: Record<EffortSize, string> = {
  S: '~3 days',
  M: '1–2 wks',
  L: '2–4 wks',
  XL: '4+ wks',
};

// Base size by kind: bugs are usually contained; gaps add net-new behavior; enhancements sit between.
const KIND_BASE: Record<EffortInput['kind'], number> = {
  bug_fix: 0,    // S
  feature_gap: 1, // M
  enhancement: 0, // S
};

// Map a count to how many size-steps it adds.
function modulesBump(touchedModules: number): number {
  // 1 module (or fewer) is the contained case; each handful of extra modules bumps a step.
  return touchedModules >= 5 ? 2 : touchedModules >= 2 ? 1 : 0;
}
function blastBump(blastRadius: number): number {
  // Heavily-depended-on targets need more testing/coordination, regardless of LOC.
  return blastRadius >= 8 ? 2 : blastRadius >= 3 ? 1 : 0;
}

export function estimateEffort(i: EffortInput): EffortResult {
  const reasons: string[] = [];
  let step = KIND_BASE[i.kind];
  reasons.push(`${i.kind} base ${SIZES[step]}`);

  // A brand-new module is the heaviest signal we have pre-PR → push straight toward XL.
  if (i.kind === 'feature_gap' && i.isNewModule) {
    step += 2;
    reasons.push('new module (+2)');
  }

  const mb = modulesBump(i.touchedModules);
  if (mb) {
    step += mb;
    reasons.push(`spans ${i.touchedModules} modules (+${mb})`);
  }

  const bb = blastBump(i.blastRadius);
  if (bb) {
    step += bb;
    reasons.push(`blast-radius ${i.blastRadius} (+${bb})`);
  }

  // Clamp into the S..XL band.
  const idx = Math.max(0, Math.min(SIZES.length - 1, step));
  const size = SIZES[idx]!;
  return {
    size,
    weeks: SIZE_WEEKS[size],
    rationale: reasons.join(', '),
  };
}
