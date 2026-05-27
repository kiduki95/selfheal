import { describe, it, expect } from 'vitest';
import { blastTier, effectiveRisk } from '../src/insight/insight.js';

// #1 — risk dimension must be informative on any repo. Pure functions, no DB.
// (Priority itself is now the unified proposalImpact score — see insight-impact.test.ts.
//  Here we pin the risk-fusion that feeds it.)
describe('risk fusion (#1): effective risk = max(path heuristic, blast-radius)', () => {
  it('blast-radius elevates risk when the path heuristic is silent (low)', () => {
    expect(effectiveRisk('low', 0)).toBe('low');
    expect(effectiveRisk('low', 2)).toBe('medium');
    expect(effectiveRisk('low', 4)).toBe('high');
    expect(effectiveRisk('low', 8)).toBe('critical');
  });

  it('path heuristic floors risk even when blast-radius is low', () => {
    expect(effectiveRisk('critical', 0)).toBe('critical');
    expect(effectiveRisk('high', 1)).toBe('high');
  });

  it('blastTier thresholds', () => {
    expect(blastTier(0)).toBe('low');
    expect(blastTier(3)).toBe('medium');
    expect(blastTier(7)).toBe('high');
    expect(blastTier(20)).toBe('critical');
  });
});
