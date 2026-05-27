import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeGitFixture, type GitFixture } from './helpers/gitfixture.js';
import { createWorkspace, type Workspace } from '../src/autodev/workspace.js';
import { verify } from '../src/autodev/verify.js';
import { assembleBrief, type GroundedBrief } from '../src/autodev/brief.js';

// Verify-gate tests use a hermetic git fixture (worktree) but NO database — they exercise the
// deterministic gate (spec §5) directly: empty-diff, scope-violation, build/test injection, risk tier.

async function brief(overrides: Partial<Parameters<typeof assembleBrief>[0]> = {}): Promise<GroundedBrief> {
  return assembleBrief(
    { repo: 'test/fix', kind: 'bug_fix', ref_id: 'sig-deadbeef00', title: '[bug] order crash', body: 'repro: tap buy', target_module: 'src/orders', placement: null, evidence: { code_risk: 'low' }, ...overrides },
    { blastRadius: [{ path: 'src/orders/order.ts', module: 'src/orders', symbol: 'placeOrder', risk_tier: 'low', callers: 2 }] },
  );
}

describe('verify deterministic gate', () => {
  let fx: GitFixture;
  let ws: Workspace;

  beforeEach(async () => {
    fx = makeGitFixture();
    ws = await createWorkspace({ repo: 'test/fix', kind: 'bug_fix', ref_id: 'sig-deadbeef00', mirrorDir: fx.dir, workspacesRoot: join(fx.dir, '..', 'ws-verify') });
  });
  afterEach(() => { try { ws.cleanup(); } catch {} fx.dispose(); });

  it('rejects an empty diff', async () => {
    const r = await verify(ws, await brief());
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.name === 'diff_nonempty')?.pass).toBe(false);
  });

  it('rejects edits outside target module ∪ blast-radius', async () => {
    mkdirSync(join(ws.path, 'src/unrelated'), { recursive: true });
    writeFileSync(join(ws.path, 'src/unrelated/secret.ts'), 'export const hacked = 1;\n');
    const r = await verify(ws, await brief());
    expect(r.ok).toBe(false);
    const scope = r.gates.find((g) => g.name === 'diff_scope');
    expect(scope?.pass).toBe(false);
    expect(scope?.reason).toMatch(/src\/unrelated\/secret\.ts/);
  });

  it('rejects an out-of-scope file whose path merely contains the bare module name (S2)', async () => {
    mkdirSync(join(ws.path, 'src/billing/orders'), { recursive: true });
    writeFileSync(join(ws.path, 'src/billing/orders/leak.ts'), 'export const x = 1;\n');
    // target_module is the bare segment 'orders'; the leak file sits under billing/orders, NOT the
    // target. Path-ROOT scope matching must reject it — the old segment-substring matching wrongly
    // accepted any path containing an 'orders' segment.
    const r = await verify(ws, await brief({ target_module: 'orders' }));
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.name === 'diff_scope')?.pass).toBe(false);
  });

  it('passes an in-scope edit + injected build/test', async () => {
    writeFileSync(join(ws.path, 'src/orders/order.ts'), 'export function placeOrder() { return 42; }\n');
    writeFileSync(join(ws.path, 'src/orders/order.test.ts'), 'export const t = 2;\n');
    const r = await verify(ws, await brief(), { build: () => ({ ok: true, output: '' }), test: () => ({ ok: true, output: '' }) });
    expect(r.ok).toBe(true);
    expect(r.gates.find((g) => g.name === 'build')?.pass).toBe(true);
    expect(r.changedFiles).toContain('src/orders/order.ts');
  });

  it('fails when the injected build/typecheck fails', async () => {
    writeFileSync(join(ws.path, 'src/orders/order.ts'), 'broken syntax(((\n');
    const r = await verify(ws, await brief(), { build: () => ({ ok: false, output: 'TS1005: expected' }) });
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.name === 'build')?.reason).toMatch(/TS1005/);
  });

  it('warns (non-blocking) when a bug_fix has no regression test', async () => {
    writeFileSync(join(ws.path, 'src/orders/order.ts'), 'export function placeOrder() { return 1; }\n');
    const r = await verify(ws, await brief(), { build: () => ({ ok: true, output: '' }), test: () => ({ ok: true, output: '' }) });
    expect(r.ok).toBe(true); // non-blocking in v1
    expect(r.gates.find((g) => g.name === 'regression_test')?.warning).toBe(true);
  });

  it('forces manual review for a critical / payment-auth risk tier', async () => {
    writeFileSync(join(ws.path, 'src/orders/order.ts'), 'export function placeOrder() { return 1; }\n');
    const r = await verify(ws, await brief({ evidence: { code_risk: 'critical' } }), { build: () => ({ ok: true, output: '' }), test: () => ({ ok: true, output: '' }) });
    expect(r.manualReview).toBe(true);
  });

  it('runs the v2 Skeptic hook only after deterministic gates pass', async () => {
    writeFileSync(join(ws.path, 'src/orders/order.ts'), 'export function placeOrder() { return 1; }\n');
    let called = false;
    const r = await verify(ws, await brief(), {
      build: () => ({ ok: true, output: '' }), test: () => ({ ok: true, output: '' }),
      skeptic: async () => { called = true; return { pass: false, reasons: ['surface patch'] }; },
    });
    expect(called).toBe(true);
    expect(r.ok).toBe(false); // skeptic vetoed
    expect(r.skeptic?.pass).toBe(false);
  });
});
