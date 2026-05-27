import { describe, it, expect } from 'vitest';
import { proposalImpact, type ProposalImpactInput, type ImpactBand } from '../src/insight/impact.js';

// Cross-kind impact scoring. Pure functions, no DB.
// The whole point of impact.ts is to put bug_fix / feature_gap / enhancement on
// ONE comparable 0-100 scale, so these tests focus on bounds, monotonicity, and
// — most importantly — cross-kind comparability.

// Convenience builders so each test reads as the dimension it varies.
function bug(over: Partial<Extract<ProposalImpactInput, { kind: 'bug_fix' }>> = {}) {
  return proposalImpact({
    kind: 'bug_fix',
    corroboration: 3,
    severity: 3,
    risk: 'high',
    trend: 'stable',
    ...over,
  });
}
function gap(over: Partial<Extract<ProposalImpactInput, { kind: 'feature_gap' }>> = {}) {
  return proposalImpact({
    kind: 'feature_gap',
    demand: 3,
    verdict: 'grounded',
    trend: 'stable',
    ...over,
  });
}
function enh(over: Partial<Extract<ProposalImpactInput, { kind: 'enhancement' }>> = {}) {
  return proposalImpact({
    kind: 'enhancement',
    demand: 3,
    trend: 'stable',
    ...over,
  });
}

// Every combination we can reasonably enumerate, for the bounds test.
const TRENDS = ['new', 'rising', 'stable', 'declining'] as const;
const SEVS = [1, 2, 3, 4] as const;
const RISKS = ['low', 'medium', 'high', 'critical'] as const;
const VERDICTS = ['grounded', 'partial', 'ungrounded'] as const;
const COUNTS = [0, 1, 2, 3, 10, 100, 10000];

describe('proposalImpact: bounds (1)', () => {
  it('every output score is within [0,100]', () => {
    const all: ProposalImpactInput[] = [];
    for (const trend of TRENDS) {
      for (const c of COUNTS) {
        for (const severity of SEVS) {
          for (const risk of RISKS) {
            all.push({ kind: 'bug_fix', corroboration: c, severity, risk, trend });
          }
        }
        for (const verdict of VERDICTS) {
          all.push({ kind: 'feature_gap', demand: c, verdict, trend });
        }
        all.push({ kind: 'enhancement', demand: c, trend });
      }
    }
    for (const p of all) {
      const { score } = proposalImpact(p);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('the absolute ceiling (critical+critical bug, saturated, rising) stays <= 100', () => {
    const top = proposalImpact({
      kind: 'bug_fix',
      corroboration: 100000,
      severity: 4,
      risk: 'critical',
      trend: 'rising',
    });
    expect(top.score).toBeLessThanOrEqual(100);
    expect(top.score).toBeGreaterThan(90); // and it really does approach the top
    expect(top.band).toBe('critical');
  });

  it('handles degenerate evidence counts (0, negative, NaN) without escaping bounds', () => {
    expect(bug({ corroboration: 0 }).score).toBe(0); // evidence 0 -> score 0
    expect(bug({ corroboration: -5 }).score).toBe(0);
    expect(bug({ corroboration: NaN }).score).toBe(0);
    expect(gap({ demand: 0 }).score).toBe(0);
  });
});

describe('proposalImpact: monotonicity (2)', () => {
  it('score increases with corroboration (bug)', () => {
    expect(bug({ corroboration: 1 }).score).toBeLessThan(bug({ corroboration: 2 }).score);
    expect(bug({ corroboration: 2 }).score).toBeLessThan(bug({ corroboration: 5 }).score);
    expect(bug({ corroboration: 5 }).score).toBeLessThan(bug({ corroboration: 20 }).score);
  });

  it('score increases with demand (gap and enhancement)', () => {
    expect(gap({ demand: 1 }).score).toBeLessThan(gap({ demand: 4 }).score);
    expect(enh({ demand: 1 }).score).toBeLessThan(enh({ demand: 4 }).score);
  });

  it('severity ordering: critical > high > medium > low (others fixed)', () => {
    const s1 = bug({ severity: 1 }).score;
    const s2 = bug({ severity: 2 }).score;
    const s3 = bug({ severity: 3 }).score;
    const s4 = bug({ severity: 4 }).score;
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s3).toBeLessThan(s4);
  });

  it('risk ordering: critical > high > medium > low (others fixed)', () => {
    const rl = bug({ risk: 'low' }).score;
    const rm = bug({ risk: 'medium' }).score;
    const rh = bug({ risk: 'high' }).score;
    const rc = bug({ risk: 'critical' }).score;
    expect(rl).toBeLessThan(rm);
    expect(rm).toBeLessThan(rh);
    expect(rh).toBeLessThan(rc);
  });

  it('verdict ordering: grounded > partial > ungrounded (others fixed)', () => {
    const g = gap({ verdict: 'grounded' }).score;
    const p = gap({ verdict: 'partial' }).score;
    const u = gap({ verdict: 'ungrounded' }).score;
    expect(g).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(u);
  });

  it('trend ordering: rising > stable ~ new > declining (each kind)', () => {
    for (const k of [bug, gap, enh]) {
      const rising = k({ trend: 'rising' }).score;
      const stable = k({ trend: 'stable' }).score;
      const fresh = k({ trend: 'new' }).score;
      const declining = k({ trend: 'declining' }).score;
      expect(rising).toBeGreaterThan(stable);
      expect(stable).toBe(fresh); // new and stable share the same momentum weight
      expect(stable).toBeGreaterThan(declining);
    }
  });
});

describe('proposalImpact: cross-kind comparability (3) — the key property', () => {
  it('a high-demand rising grounded gap OUTRANKS a 1-report low-severity declining bug', () => {
    const strongGap = proposalImpact({
      kind: 'feature_gap',
      demand: 12,
      verdict: 'grounded',
      trend: 'rising',
    });
    const weakBug = proposalImpact({
      kind: 'bug_fix',
      corroboration: 1,
      severity: 1,
      risk: 'low',
      trend: 'declining',
    });
    // Assert the actual scores, not just the ordering.
    // strongGap: evidence(12)=0.9502 * value 0.7 * conf 1.0 * mom 1.0 = ~66.5
    // weakBug:   evidence(1)=0.2212  * value(0.6*0.25+0.4*0.25=0.25) * 1.0 * mom 0.6 = ~3.32
    expect(strongGap.score).toBeGreaterThan(60);
    expect(weakBug.score).toBeLessThan(10);
    expect(strongGap.score).toBeGreaterThan(weakBug.score);
  });

  it('a critical highly-corroborated bug OUTRANKS a low-demand enhancement', () => {
    const criticalBug = proposalImpact({
      kind: 'bug_fix',
      corroboration: 20,
      severity: 4,
      risk: 'critical',
      trend: 'rising',
    });
    const weakEnh = proposalImpact({
      kind: 'enhancement',
      demand: 1,
      trend: 'declining',
    });
    // criticalBug: evidence(20)=~0.9933 * value 1.0 * 1.0 * 1.0 = ~99.3
    // weakEnh:     evidence(1)=0.2212 * value 0.45 * 1.0 * mom 0.6 = ~5.97
    expect(criticalBug.score).toBeGreaterThan(95);
    expect(weakEnh.score).toBeLessThan(10);
    expect(criticalBug.score).toBeGreaterThan(weakEnh.score);
  });

  it('a strongly-demanded rising enhancement can beat a stale low-severity bug', () => {
    const hotEnh = proposalImpact({
      kind: 'enhancement',
      demand: 30,
      trend: 'rising',
    });
    const staleBug = proposalImpact({
      kind: 'bug_fix',
      corroboration: 2,
      severity: 1,
      risk: 'low',
      trend: 'declining',
    });
    expect(hotEnh.score).toBeGreaterThan(staleBug.score);
  });

  it('same evidence count yields the IDENTICAL evidence factor across kinds (basis of comparability)', () => {
    // Construct a bug and a gap whose value*confidence*momentum products match,
    // and verify equal counts give equal scores — proving evidence is shared.
    // bug value with sev/risk that yields exactly GAP_VALUE (0.7):
    //   0.6*SEV + 0.4*RISK = 0.7  ->  sev=4 (1.0), risk=low (0.25): 0.6+0.1=0.7
    const b = proposalImpact({ kind: 'bug_fix', corroboration: 7, severity: 4, risk: 'low', trend: 'rising' });
    const g = proposalImpact({ kind: 'feature_gap', demand: 7, verdict: 'grounded', trend: 'rising' });
    expect(b.score).toBeCloseTo(g.score, 6);
  });
});

describe('proposalImpact: band classification (4)', () => {
  it('maps scores to the documented cutoffs (critical>=75, high>=50, medium>=25, else low)', () => {
    const cases: Array<{ score: number; band: ImpactBand }> = [
      { score: 80, band: 'critical' },
      { score: 60, band: 'high' },
      { score: 30, band: 'medium' },
      { score: 5, band: 'low' },
    ];
    // We can't set score directly, so we pick inputs known to land in each band
    // and assert both the band and that the score sits on the expected side.
    const critical = proposalImpact({
      kind: 'bug_fix',
      corroboration: 100,
      severity: 4,
      risk: 'critical',
      trend: 'rising',
    });
    expect(critical.score).toBeGreaterThanOrEqual(75);
    expect(critical.band).toBe('critical');

    const high = proposalImpact({
      kind: 'feature_gap',
      demand: 12,
      verdict: 'grounded',
      trend: 'rising',
    }); // ~66.5
    expect(high.score).toBeGreaterThanOrEqual(50);
    expect(high.score).toBeLessThan(75);
    expect(high.band).toBe('high');

    const medium = proposalImpact({
      kind: 'enhancement',
      demand: 10,
      trend: 'rising',
    }); // evidence(10)=0.9179 * 0.45 * 1.0 * 1.0 = ~41.3
    expect(medium.score).toBeGreaterThanOrEqual(25);
    expect(medium.score).toBeLessThan(50);
    expect(medium.band).toBe('medium');

    const low = proposalImpact({
      kind: 'bug_fix',
      corroboration: 1,
      severity: 1,
      risk: 'low',
      trend: 'declining',
    }); // ~3.3
    expect(low.score).toBeLessThan(25);
    expect(low.band).toBe('low');

    // silence unused-var lint for the documentation table
    expect(cases.length).toBe(4);
  });

  it('classifies exactly at the cutoff boundaries (>= is inclusive)', () => {
    // Find inputs whose rounded score equals each boundary, then confirm the band.
    // 75.0: tune a bug. evidence * value * 100 = 75 with mom 1.0, conf 1.0.
    //   value(sev4,critical)=1.0 -> need evidence=0.75 -> count = -K*ln(0.25) = 4*1.3863 = 5.545
    const atCritical = proposalImpact({
      kind: 'bug_fix',
      corroboration: 4 * Math.log(4), // evidence = 1 - exp(-ln4) = 0.75 exactly
      severity: 4,
      risk: 'critical',
      trend: 'rising',
    });
    expect(atCritical.score).toBeCloseTo(75, 5);
    expect(atCritical.band).toBe('critical'); // 75 is critical (>=75)

    // Just below 75 must be high.
    const justBelow = proposalImpact({
      kind: 'bug_fix',
      corroboration: 4 * Math.log(4) - 0.05,
      severity: 4,
      risk: 'critical',
      trend: 'rising',
    });
    expect(justBelow.score).toBeLessThan(75);
    expect(justBelow.band).toBe('high');
  });
});
