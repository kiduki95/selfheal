import { describe, it, expect } from 'vitest';
import { suppressionDecision, estimateEffort } from '../src/insight/lifecycle.js';

// ④ Lifecycle / suppression — pure decision over resolution vs regression signals.
describe('suppressionDecision (④)', () => {
  it('resolved with no new defects after → suppress (the fix held)', () => {
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 0, trend: 'stable', corroboration: 3 });
    expect(r.suppress).toBe(true);
    expect(r.reason).toMatch(/resolved/i);
  });

  it('resolution + new defect reports after it → regression → do NOT suppress (resurface)', () => {
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 2, trend: 'rising', corroboration: 3 });
    expect(r.suppress).toBe(false);
    expect(r.reason).toMatch(/regression/i);
  });

  it('no resolution report at all → do NOT suppress (proposal stands)', () => {
    const r = suppressionDecision({ resolutionReports: 0, reportsSinceResolution: 0, trend: 'rising', corroboration: 4 });
    expect(r.suppress).toBe(false);
    expect(r.reason).toMatch(/no resolution/i);
  });

  it('declining trend with a resolution and no regression → suppress (fade confirmed)', () => {
    const r = suppressionDecision({ resolutionReports: 2, reportsSinceResolution: 0, trend: 'declining', corroboration: 2 });
    expect(r.suppress).toBe(true);
    expect(r.reason).toMatch(/declining/i);
  });

  it('a fresh-but-resolved incident still suppresses (resolution does not require declining)', () => {
    // trend 'new'/'rising' must not block suppression when there is a clean resolution.
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 0, trend: 'new', corroboration: 1 });
    expect(r.suppress).toBe(true);
  });

  it('weak group: a single late report (tolerance 0) is treated as regression → resurface', () => {
    // corroboration < 5 → tolerance 0, so one post-resolution defect resurfaces it.
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 1, trend: 'stable', corroboration: 3 });
    expect(r.suppress).toBe(false);
    expect(r.reason).toMatch(/regression/i);
  });

  it('strong group: a single late report is within tolerance (1) → still suppress', () => {
    // corroboration >= 5 → tolerance 1, so one straggler does not resurface a once-loud incident.
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 1, trend: 'stable', corroboration: 6 });
    expect(r.suppress).toBe(true);
    expect(r.reason).toMatch(/within tolerance/i);
  });

  it('strong group: two late reports exceed tolerance (1) → regression → resurface', () => {
    const r = suppressionDecision({ resolutionReports: 1, reportsSinceResolution: 2, trend: 'stable', corroboration: 6 });
    expect(r.suppress).toBe(false);
    expect(r.reason).toMatch(/regression/i);
  });
});

// ⑥ Effort estimate — coarse pre-PR S/M/L/XL from kind + spread + blast radius.
describe('estimateEffort (⑥)', () => {
  it('feature_gap landing a brand-new module → XL', () => {
    const r = estimateEffort({ kind: 'feature_gap', touchedModules: 1, isNewModule: true, blastRadius: 0 });
    expect(r.size).toBe('XL'); // M base (1) + new module (+2) = XL
    expect(r.weeks).not.toHaveLength(0);
  });

  it('isolated bug_fix (blastRadius 0, single module) → S', () => {
    const r = estimateEffort({ kind: 'bug_fix', touchedModules: 1, isNewModule: false, blastRadius: 0 });
    expect(r.size).toBe('S');
    expect(r.weeks).not.toHaveLength(0);
  });

  it('high-blast bug is bumped up from the S baseline', () => {
    const isolated = estimateEffort({ kind: 'bug_fix', touchedModules: 1, isNewModule: false, blastRadius: 0 });
    const hot = estimateEffort({ kind: 'bug_fix', touchedModules: 1, isNewModule: false, blastRadius: 10 });
    expect(isolated.size).toBe('S');
    expect(hot.size).toBe('L'); // S base (0) + blast>=8 (+2) = L
    expect(SIZE_ORDER.indexOf(hot.size)).toBeGreaterThan(SIZE_ORDER.indexOf(isolated.size));
  });

  it('enhancement is S by default and reaches M with moderate spread', () => {
    const small = estimateEffort({ kind: 'enhancement', touchedModules: 1, isNewModule: false, blastRadius: 0 });
    const medium = estimateEffort({ kind: 'enhancement', touchedModules: 2, isNewModule: false, blastRadius: 0 });
    expect(small.size).toBe('S');
    expect(medium.size).toBe('M'); // S base (0) + spans 2 modules (+1) = M
  });

  it('touchedModules increases size monotonically', () => {
    const one = estimateEffort({ kind: 'bug_fix', touchedModules: 1, isNewModule: false, blastRadius: 0 });
    const few = estimateEffort({ kind: 'bug_fix', touchedModules: 3, isNewModule: false, blastRadius: 0 });
    const many = estimateEffort({ kind: 'bug_fix', touchedModules: 6, isNewModule: false, blastRadius: 0 });
    expect(SIZE_ORDER.indexOf(few.size)).toBeGreaterThan(SIZE_ORDER.indexOf(one.size));
    expect(SIZE_ORDER.indexOf(many.size)).toBeGreaterThanOrEqual(SIZE_ORDER.indexOf(few.size));
    expect(many.size).toBe('L'); // S base (0) + spans 5+ modules (+2) = L
  });

  it('every result carries a non-empty weeks string and rationale', () => {
    const r = estimateEffort({ kind: 'feature_gap', touchedModules: 2, isNewModule: false, blastRadius: 4 });
    expect(r.weeks.length).toBeGreaterThan(0);
    expect(r.rationale.length).toBeGreaterThan(0);
  });
});

const SIZE_ORDER = ['S', 'M', 'L', 'XL'] as const;
