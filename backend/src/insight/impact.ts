// Cross-kind impact scoring (pure, deterministic, no IO).
//
// PROBLEM: historically each proposal kind computed priority with a different,
// incomparable formula (bug_fix ~0-40, feature_gap ~0-8, enhancement ~0-3), so
// sorting all three on one list was meaningless.
//
// SOLUTION: map ANY kind onto a single 0-100 "impact" score by decomposing it
// into orthogonal factors on a shared (0,1] scale:
//
//   score = 100 * evidence * value * confidence * momentum
//
//   - evidence   how much corroboration/demand backs the proposal (SAME curve
//                for every kind — this is what makes them comparable).
//   - value      intrinsic worth of acting: severity/risk for bugs, fixed
//                new-capability value for gaps, lower value for enhancements.
//   - confidence how much we trust the proposal is real/actionable (bugs are
//                directly observed → 1.0; gaps are discounted by verdict).
//   - momentum   trend multiplier (rising > new ~ stable > declining).
//
// Because every factor lives in (0,1] and is multiplied, the score stays in
// (0,100], is monotonic in each factor, and a 10-user gap and a 10-report bug
// receive the IDENTICAL evidence factor — so they rank head-to-head on value
// and momentum rather than on which arbitrary constant their kind happened to use.

import type { Trend } from '../util/trend.js';

export type ImpactBand = 'critical' | 'high' | 'medium' | 'low';

export interface ImpactResult {
  score: number; // 0..100, rounded to 2 decimals
  band: ImpactBand;
}

export type ProposalImpactInput =
  | {
      kind: 'bug_fix';
      corroboration: number;
      severity: 1 | 2 | 3 | 4;
      risk: 'low' | 'medium' | 'high' | 'critical';
      trend: Trend;
    }
  | { kind: 'feature_gap'; demand: number; verdict: 'grounded' | 'partial' | 'ungrounded'; trend: Trend }
  | { kind: 'enhancement'; demand: number; trend: Trend }
  // Supply-side debt (code-health P2). Not review-backed: `smellScore` (0-100) is the debt principal
  // (how bad), `churn` is the interest rate (how often the debt is paid). See the refactor case below.
  | { kind: 'refactor'; smellScore: number; churn: number };

// --- Tuning constants (documented; tests pin the behaviour) -----------------

// Evidence saturation constant. With `1 - exp(-count/K)` and K = 4:
//   1 report  -> ~0.221   3 -> ~0.528   10 -> ~0.918   100 -> ~1.000
// One report already carries real weight, ten is most of the way to the cap,
// and a hundred can't run away beyond the single report — the curve saturates.
const EVIDENCE_K = 4;

// Value scale per kind, all in (0,1].
// Bug value is a blend of severity and risk; the table below gives the two
// endpoints used in the blend.
//   severity 1->4 maps to SEV_VALUE; risk low->critical maps to RISK_VALUE.
const SEV_VALUE: Record<1 | 2 | 3 | 4, number> = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1.0 };
const RISK_VALUE: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1.0,
};
// Severity is the dominant signal for a bug's worth; risk modulates it.
const BUG_SEV_WEIGHT = 0.6;
const BUG_RISK_WEIGHT = 0.4;

// A new capability (feature_gap) has a solid, fixed intrinsic value: shipping a
// missing feature is meaningful but, value-wise, sits below a top-severity bug
// (severity 4 = 1.0). 0.7 keeps a strong grounded rising gap competitive with —
// and able to beat — a weak/stale bug, while a critical corroborated bug still wins.
const GAP_VALUE = 0.7;

// Enhancement = improving something that already works. Lower intrinsic value
// than a new capability or a serious bug, but high demand + rising momentum can
// still lift it above a stale, low-severity bug.
const ENH_VALUE = 0.45;

// Confidence: bugs are observed failures (full confidence). Gaps are inferred
// from user asks and discounted by how grounded the request is. Enhancements
// target an existing module, so they're concrete (full confidence).
const VERDICT_CONFIDENCE: Record<'grounded' | 'partial' | 'ungrounded', number> = {
  grounded: 1.0,
  partial: 0.7,
  ungrounded: 0.4,
};

// Momentum: rising work is most worth doing now; declining is fading.
const MOMENTUM: Record<Trend, number> = {
  rising: 1.0,
  new: 0.85,
  stable: 0.85,
  declining: 0.6,
};

// Band cutoffs on the 0-100 score.
const CRITICAL_MIN = 75;
const HIGH_MIN = 50;
const MEDIUM_MIN = 25;

// Refactor (supply-side) tuning. Priority = badness × interest × weight (user's "오염도×활동 하이브리드"):
//   - badness  = smellScore/100 (the debt principal — how rotten the code is).
//   - interest = churn momentum, FLOORED so dormant-but-awful code still surfaces, while an actively
//                churned mess ranks top (CodeScene: debt you pay interest on most is worth fixing most).
//   - weight   = discount vs demand-side: a FULL-strength bug (≈100) edges the MAX refactor (≤85). This is
//                the "bug-우위" the user chose — at equal underlying strength the user-facing bug wins. It is
//                NOT absolute: a weakly-corroborated bug (low evidence) can rank below a severe refactor, by
//                design — evidence is a first-class dimension for every kind, refactor included (via churn).
const REFACTOR_WEIGHT = 0.85;
const REFACTOR_MOMENTUM_FLOOR = 0.6;

// --- Helpers ----------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Saturating evidence curve shared by ALL kinds. Negative/NaN counts clamp to 0.
function evidenceFactor(count: number): number {
  const c = Number.isFinite(count) && count > 0 ? count : 0;
  return 1 - Math.exp(-c / EVIDENCE_K);
}

function bandOf(score: number): ImpactBand {
  if (score >= CRITICAL_MIN) return 'critical';
  if (score >= HIGH_MIN) return 'high';
  if (score >= MEDIUM_MIN) return 'medium';
  return 'low';
}

// --- Public API -------------------------------------------------------------

export function proposalImpact(p: ProposalImpactInput): ImpactResult {
  let evidence: number;
  let value: number;
  let confidence: number;

  switch (p.kind) {
    case 'bug_fix': {
      evidence = evidenceFactor(p.corroboration);
      value = BUG_SEV_WEIGHT * SEV_VALUE[p.severity] + BUG_RISK_WEIGHT * RISK_VALUE[p.risk];
      confidence = 1.0; // a corroborated bug is an observed failure
      break;
    }
    case 'feature_gap': {
      evidence = evidenceFactor(p.demand);
      value = GAP_VALUE;
      confidence = VERDICT_CONFIDENCE[p.verdict];
      break;
    }
    case 'enhancement': {
      evidence = evidenceFactor(p.demand);
      value = ENH_VALUE;
      confidence = 1.0; // targets an existing, concrete module
      break;
    }
    case 'refactor': {
      // Supply-side: badness × churn-interest × weight (see the REFACTOR_* notes above). Deterministic
      // (no review evidence), so it's scored directly rather than through evidence×value×confidence.
      const interest = REFACTOR_MOMENTUM_FLOOR + (1 - REFACTOR_MOMENTUM_FLOOR) * evidenceFactor(p.churn);
      const score = round2(Math.max(0, Math.min(100, p.smellScore)) * interest * REFACTOR_WEIGHT);
      return { score, band: bandOf(score) };
    }
  }

  const momentum = MOMENTUM[p.trend];
  const score = round2(100 * evidence * value * confidence * momentum);
  return { score, band: bandOf(score) };
}
