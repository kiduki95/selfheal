import { describe, it, expect } from 'vitest';
import { sanitizeSegment, branchName } from '../src/autodev/workspace.js';
import { backoffMs, scopePrefixes } from '../src/autodev/verify.js';
import { assembleBrief, type ProposalRow } from '../src/autodev/brief.js';
import { buildAgentPrompt, parseChangedFiles } from '../src/autodev/drivers/claude-cli.js';

// Pure-logic Auto-Dev tests — no DB, no git. These run everywhere (verify scope/diff helpers,
// sanitize, brief assembly, backoff) even when Postgres is unavailable.

describe('workspace sanitize + branch', () => {
  it('replaces non [A-Za-z0-9._-] with underscore (spec §4)', () => {
    expect(sanitizeSegment('tete-lab/automated-trading-system')).toBe('tete-lab_automated-trading-system');
    expect(sanitizeSegment('a b@c#d')).toBe('a_b_c_d');
    expect(sanitizeSegment('keep.dots_and-dashes')).toBe('keep.dots_and-dashes');
  });
  it('branch name is selfheal/<kind>-<ref8>', () => {
    expect(branchName('bug_fix', '1234567890abcdef')).toBe('selfheal/bug_fix-12345678');
  });
});

describe('backoff (spec §5: min(10s·2^n, 5m))', () => {
  it('is exponential and capped at 5 minutes', () => {
    expect(backoffMs(0)).toBe(10_000);
    expect(backoffMs(1)).toBe(20_000);
    expect(backoffMs(2)).toBe(40_000);
    expect(backoffMs(10)).toBe(300_000); // capped
  });
});

describe('brief assembly (CodeFlow-grounded, spec §4)', () => {
  const base: ProposalRow = {
    repo: 'r', kind: 'bug_fix', ref_id: 'sig-123456789', title: '[bug] order crash',
    body: '## repro\ntap buy', target_module: 'src/orders', placement: null,
    evidence: { code_risk: 'high', corroboration: 5, defect: { repro: ['tap buy'], expected: 'order placed', actual: 'crash' } },
  };

  it('derives risk tier, target files, defect, and TDD instructions', async () => {
    const brief = await assembleBrief(base, { blastRadius: [
      { path: 'src/orders/order.ts', module: 'src/orders', symbol: 'placeOrder', risk_tier: 'high', callers: 3 },
    ] });
    expect(brief.riskTier).toBe('high');
    expect(brief.targetFiles).toContain('src/orders/order.ts');
    expect(brief.defect?.actual).toBe('crash');
    expect(brief.instructions).toMatch(/FAILING test/);
    expect(brief.instructions).toMatch(/selfheal\(bug_fix\)/); // commit convention
    expect(brief.instructions).toMatch(/blast radius/i);
  });

  it('feature_gap brief frames placement, not defect', async () => {
    const brief = await assembleBrief({ ...base, kind: 'feature_gap', target_module: 'src/alerts', evidence: {} }, { blastRadius: [] });
    expect(brief.defect).toBeUndefined();
    expect(brief.instructions).toMatch(/missing feature/);
    expect(brief.targetFiles).toEqual(['src/alerts']);
  });
});

describe('claude-cli driver — pure pieces (v2-a)', () => {
  const base: ProposalRow = {
    repo: 'r', kind: 'bug_fix', ref_id: 'sig-abcdef012', title: '[bug] order crash',
    body: '## repro\ntap buy', target_module: 'src/orders', placement: null,
    evidence: { defect: { repro: ['tap buy'], expected: 'placed', actual: 'crash' } },
  };

  it('buildAgentPrompt embeds the grounded brief + TDD/scope directives; adds feedback only on retry', async () => {
    const brief = await assembleBrief(base, { blastRadius: [{ path: 'src/orders/order.ts', module: 'src/orders', symbol: 'placeOrder', risk_tier: 'low', callers: 2 }] });

    const first = buildAgentPrompt(brief, 0);
    expect(first).toMatch(/autonomous coding agent/i);
    expect(first).toMatch(/FAILING test/);          // TDD directive
    expect(first).toMatch(/Do NOT run git/);        // harness owns VCS
    expect(first).toContain(brief.instructions);    // the grounded brief is embedded
    expect(first).not.toMatch(/Previous attempt FAILED/); // no feedback on attempt 0

    const retry = buildAgentPrompt(brief, 1, '- [scope] edited src/x.ts outside boundary');
    expect(retry).toMatch(/Previous attempt FAILED verification \(attempt 1\)/);
    expect(retry).toMatch(/outside boundary/);
  });

  it('parseChangedFiles handles modified, untracked, and renamed porcelain lines', () => {
    const porcelain = ' M src/orders/order.ts\n?? src/orders/order.test.ts\nR  old/a.ts -> src/orders/b.ts\n';
    const files = parseChangedFiles(porcelain);
    expect(files).toContain('src/orders/order.ts');
    expect(files).toContain('src/orders/order.test.ts');
    expect(files).toContain('src/orders/b.ts'); // rename → new path
    expect(files).not.toContain('old/a.ts');
    expect(parseChangedFiles('')).toEqual([]);   // empty diff
  });
});

describe('scope prefixes', () => {
  it('unions target module + target files + blast-radius paths/modules', async () => {
    const brief = await assembleBrief(
      { repo: 'r', kind: 'bug_fix', ref_id: 'x', title: 't', body: 'b', target_module: 'src/orders', placement: null, evidence: {} },
      { blastRadius: [{ path: 'src/risk/guard.ts', module: 'src/risk', symbol: null, risk_tier: 'low', callers: 1 }] },
    );
    const prefixes = scopePrefixes(brief, ['test']);
    expect(prefixes).toContain('src/orders');
    expect(prefixes).toContain('src/risk/guard.ts');
    expect(prefixes).toContain('src/risk');
    expect(prefixes).toContain('test');
  });
});
