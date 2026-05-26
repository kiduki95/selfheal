import { describe, it, expect } from 'vitest';
import { blastTier, effectiveRisk, bugPriority } from '../src/insight/insight.js';

// #1 — risk dimension must be informative on any repo. Pure functions, no DB.
describe('bug priority: risk fusion (#1)', () => {
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

  it('severity is an orthogonal factor', () => {
    const base = { corroboration: 2, codeRiskTier: 'low', callers: 0, trend: 'rising' };
    expect(bugPriority({ ...base, sev: 4 }).priority).toBeGreaterThan(bugPriority({ ...base, sev: 1 }).priority);
  });

  it('a low-code-risk bug in heavily-depended-on code outranks an isolated one (same severity)', () => {
    const base = { corroboration: 2, sev: 3, codeRiskTier: 'low', trend: 'rising' };
    const hot = bugPriority({ ...base, callers: 8 });
    const cold = bugPriority({ ...base, callers: 0 });
    expect(hot.risk).toBe('critical');
    expect(cold.risk).toBe('low');
    expect(hot.priority).toBeGreaterThan(cold.priority);
  });
});
