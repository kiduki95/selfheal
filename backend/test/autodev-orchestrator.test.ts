import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import { makeGitFixture, type GitFixture } from './helpers/gitfixture.js';
import { runAutoDev } from '../src/autodev/orchestrator.js';
import { StubAgentDriver, type StubScript } from '../src/autodev/drivers/stub.js';
import { config } from '../src/config.js';
import type { Db } from '../src/db/db.js';

// Seed an approved proposal that depends on a refactor of `prereqPath` (landing-zone gate, P3).
async function seedApprovedWithPrereq(db: Db, prereqPath: string, ref = REF): Promise<void> {
  await db.query(
    `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence, prerequisite)
     VALUES ($1,'bug_fix',$2,'[bug] crash','repro',80,'src/orders',NULL,$3,$4)`,
    [REPO, ref, JSON.stringify({ code_risk: 'low' }), prereqPath],
  );
  await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: ref, decision: 'approved' });
}

// End-to-end Auto-Dev orchestration tests (spec §9.2 cases). Run rows live in the isolated test DB;
// the worktree/verify run against a hermetic git fixture; the StubAgentDriver makes the path fully
// deterministic (no model). Covers: approved → pr_open, empty-diff rejected, scope-violation rejected,
// duplicate claim blocked, verify-failure retry → rejected_by_verifier, and workspace cleanup.
const reachable = await canConnect();
const REPO = 'test/autodev';
const REF = 'sig-orch00001';

// Seed one approved bug_fix proposal (proposals + proposal_reviews = the dispatch contract).
async function seedApproved(db: Db, ref = REF): Promise<void> {
  await db.query(
    `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence)
     VALUES ($1,'bug_fix',$2,'[bug] order crash','repro: tap buy',90,'src/orders',NULL,$3)`,
    [REPO, ref, JSON.stringify({ code_risk: 'low' })],
  );
  await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: ref, decision: 'approved' });
}

const PASS = { build: () => ({ ok: true, output: '' }), test: () => ({ ok: true, output: '' }) };

// In-scope edit + a regression test (passes all gates).
const goodScript: StubScript = {
  edits: [
    { path: 'src/orders/order.ts', content: 'export function placeOrder() { return 42; }\n' },
    { path: 'src/orders/order.test.ts', content: 'export const fixed = true;\n' },
  ],
};

describe.skipIf(!reachable)('Auto-Dev orchestrator', () => {
  let db: Db;
  let fx: GitFixture;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); fx = makeGitFixture(); });
  afterEach(() => { fx.dispose(); });

  function opts(driver: StubAgentDriver, extra: Partial<Parameters<typeof runAutoDev>[1]> = {}) {
    return {
      db, mirrorDir: fx.dir, workspacesRoot: `${fx.dir}-ws`,
      driver, verify: PASS, noBackoff: true, sleep: async () => {}, maxAttempts: 2, ...extra,
    } as Parameters<typeof runAutoDev>[1];
  }

  it('approved proposal → pr_open + patch artifact + proposal flips to in_dev', async () => {
    await seedApproved(db);
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe('pr_open');

    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.status).toBe('pr_open');
    expect(run?.branch).toBe('selfheal/bug_fix-sig-orch'); // selfheal/bug_fix-<ref8>, ref8='sig-orch'
    expect(run?.base_sha).toBeTruthy();
    expect(run?.pr_url).toBeTruthy();
    expect(existsSync(run!.pr_url!)).toBe(true); // dry-run patch artifact on disk

    const review = await db.query<{ decision: string }>(`SELECT decision FROM proposal_reviews WHERE ref_id=$1`, [REF]);
    expect(review[0]?.decision).toBe('in_dev');

    const events = await db.query<{ phase: string }>(`SELECT phase FROM agent_run_events WHERE run_id=$1 ORDER BY ts`, [outcomes[0]!.runId]);
    expect(events.map((e) => e.phase)).toContain('pr_open');
  });

  it('empty diff is rejected', async () => {
    await seedApproved(db);
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver({ noChanges: true })));
    expect(outcomes[0]!.status).toBe('rejected_by_verifier');
    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.status).toBe('rejected_by_verifier');
    expect(run?.verdict?.gates?.find((g: any) => g.name === 'diff_nonempty')?.pass).toBe(false);
  });

  it('scope violation is rejected', async () => {
    await seedApproved(db);
    const badScope: StubScript = { edits: [{ path: 'src/unrelated/hack.ts', content: 'export const x=1;\n' }] };
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(badScope)));
    expect(outcomes[0]!.status).toBe('rejected_by_verifier');
  });

  it('blocks a duplicate claim — only one active run per proposal', async () => {
    await seedApproved(db);
    // Pre-claim a run so the orchestrator's claim hits the partial-unique active index.
    const claimed = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: REF, status: 'implementing' });
    expect(claimed).not.toBeNull();
    const dup = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: REF, status: 'queued' });
    expect(dup).toBeNull(); // second claim refused

    // The orchestrator sees the active run and skips dispatch entirely.
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(outcomes).toHaveLength(0);
  });

  it('verify-failure retries then ends rejected_by_verifier when retries are exhausted', async () => {
    await seedApproved(db);
    // Every attempt writes out of scope → verify always fails → exhaust maxAttempts.
    const alwaysBad: StubScript = { edits: [{ path: 'src/unrelated/hack.ts', content: 'export const x=1;\n' }] };
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(alwaysBad), { maxAttempts: 2 }));
    expect(outcomes[0]!.status).toBe('rejected_by_verifier');
    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.attempt).toBe(2); // attempts 0,1,2 ran

    // One "driver attempt N" transition event per attempt (0,1,2) → 3.
    const impl = await db.query<{ n: string }>(`SELECT count(*) n FROM agent_run_events WHERE run_id=$1 AND phase='implementing' AND message LIKE 'driver attempt%'`, [outcomes[0]!.runId]);
    expect(Number(impl[0]!.n)).toBe(3);
  });

  it('retries with feedback and succeeds on a later attempt', async () => {
    await seedApproved(db);
    // attempt 0 = out of scope (fails), attempt 1 = in scope + test (passes).
    const perAttempt: StubScript = {
      perAttempt: {
        0: [{ path: 'src/unrelated/hack.ts', content: 'export const x=1;\n' }],
        1: [
          { path: 'src/orders/order.ts', content: 'export function placeOrder() { return 7; }\n' },
          { path: 'src/orders/order.test.ts', content: 'export const ok = true;\n' },
        ],
      },
    };
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(perAttempt)));
    expect(outcomes[0]!.status).toBe('pr_open');
    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.attempt).toBe(1);
  });

  it('cleans up the worktree after a run (success or rejection)', async () => {
    await seedApproved(db);
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.workspace_path).toBeTruthy();
    expect(existsSync(run!.workspace_path!)).toBe(false); // worktree torn down
  });

  it('rejects an empty-scope proposal up front without dispatching the agent (F3)', async () => {
    // No target_module, no evidence → no blast-radius (empty test repo) → empty brief scope. The
    // orchestrator must reject before driving (would otherwise time out / scatter on a legacy repo).
    await db.query(
      `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence)
       VALUES ($1,'bug_fix','sig-noscope01','[bug] something somewhere','no repro',50,NULL,NULL,$2)`,
      [REPO, JSON.stringify({})],
    );
    await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: 'sig-noscope01', decision: 'approved' });

    // A driver that would throw if ever invoked — proves we reject BEFORE dispatch.
    const explode = new StubAgentDriver(goodScript);
    (explode as any).run = () => { throw new Error('driver must not be called for empty-scope'); };

    const outcomes = await runAutoDev(REPO, opts(explode));
    expect(outcomes[0]!.status).toBe('rejected_by_verifier');

    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.status).toBe('rejected_by_verifier');
    expect(run?.error).toMatch(/empty scope/);

    const phases = (await db.query<{ phase: string }>(`SELECT phase FROM agent_run_events WHERE run_id=$1`, [outcomes[0]!.runId])).map((e) => e.phase);
    expect(phases).not.toContain('implementing'); // never drove the agent
    expect(phases).toContain('rejected_by_verifier');

    // The reject path must still tear down its worktree (finally branch on early return).
    expect(run?.workspace_path).toBeTruthy();
    expect(existsSync(run!.workspace_path!)).toBe(false);
  });

  it('forces manual-review draft handoff for a critical risk tier (still pr_open)', async () => {
    await db.query(
      `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence)
       VALUES ($1,'bug_fix','sig-critical1','[bug] payment fails','repro',95,'src/orders',NULL,$2)`,
      [REPO, JSON.stringify({ code_risk: 'critical' })],
    );
    await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: 'sig-critical1', decision: 'approved' });
    const outcomes = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(outcomes[0]!.status).toBe('pr_open');
    const run = await db.getAgentRun(outcomes[0]!.runId);
    expect(run?.verdict?.manualReview).toBe(true);
  });

  it('landing-zone gate (P3): holds a proposal until its prerequisite refactor is in progress', async () => {
    await seedApprovedWithPrereq(db, 'src/orders'); // bug depends on a refactor of src/orders (not started)

    // gate ON (default) + prerequisite unsatisfied → held, nothing dispatched.
    const held = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(held).toHaveLength(0);

    // the refactor goes in progress → prerequisite satisfied → the bug now dispatches.
    await db.decideProposal({ repo: REPO, kind: 'refactor', ref_id: 'src/orders', decision: 'in_dev' });
    const dispatched = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.status).toBe('pr_open');
  });

  it('landing-zone gate OFF: dispatches despite an unsatisfied prerequisite', async () => {
    await seedApprovedWithPrereq(db, 'src/orders');
    const prev = config.landingZoneGate;
    (config as { landingZoneGate: boolean }).landingZoneGate = false;
    try {
      const out = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
      expect(out[0]!.status).toBe('pr_open'); // gate off → no hold
    } finally {
      (config as { landingZoneGate: boolean }).landingZoneGate = prev;
    }
  });

  it('freshness gate: holds a stale proposal (target changed since grounding), dispatches once regrounded', async () => {
    // current scan: src/orders file is at content_hash FRESH
    await db.query(`INSERT INTO code_artifact_registry (repo, path, kind, content_hash) VALUES ($1,'src/orders','file','FRESH')`, [REPO]);
    // a bug grounded against the OLD hash (code moved since) → stale
    await db.query(
      `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence, grounded_hash)
       VALUES ($1,'bug_fix',$2,'[bug] crash','repro',80,'src/orders',NULL,'{}','STALE')`,
      [REPO, REF],
    );
    await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: REF, decision: 'approved' });

    const held = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(held).toHaveLength(0); // stale grounding → held (no run created)

    // reground (a fresh re-scan + re-insight would do this): now the stamp matches the current scan.
    await db.query(`UPDATE proposals SET grounded_hash='FRESH' WHERE repo=$1 AND ref_id=$2`, [REPO, REF]);
    const fresh = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(fresh[0]!.status).toBe('pr_open');
  });

  it('a staleness-held proposal does NOT consume the file slot — a fresh same-file one still dispatches', async () => {
    await db.query(`INSERT INTO code_artifact_registry (repo, path, kind, content_hash) VALUES ($1,'src/orders','file','FRESH')`, [REPO]);
    // high-priority bug on src/orders but STALE grounding → held; lower-priority FRESH bug on same file.
    await db.query(`INSERT INTO proposals (repo,kind,ref_id,title,body,priority,target_module,placement,evidence,grounded_hash) VALUES ($1,'bug_fix','sig-stale','[bug] stale','r',95,'src/orders',NULL,'{}','STALE')`, [REPO]);
    await db.query(`INSERT INTO proposals (repo,kind,ref_id,title,body,priority,target_module,placement,evidence,grounded_hash) VALUES ($1,'bug_fix','sig-fresh','[bug] fresh','r',60,'src/orders',NULL,'{}','FRESH')`, [REPO]);
    await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: 'sig-stale', decision: 'approved' });
    await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: 'sig-fresh', decision: 'approved' });

    const out = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(out).toHaveLength(1);
    expect(out[0]!.ref_id).toBe('sig-fresh'); // the held (stale) high-prio one didn't block the fresh one
  });

  it('cross-run serialization: defers a proposal whose target file has an active run from a prior dispatch', async () => {
    // a prior, still-active run occupies src/orders (a different proposal).
    await db.query(`INSERT INTO proposals (repo,kind,ref_id,title,body,priority,target_module,placement,evidence) VALUES ($1,'bug_fix','sig-prior','[bug] prior','r',70,'src/orders',NULL,'{}')`, [REPO]);
    const claimed = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: 'sig-prior', status: 'implementing' });
    expect(claimed).not.toBeNull();

    await seedApproved(db); // a NEW approved bug on the same file (src/orders)
    const out = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(out).toHaveLength(0); // deferred — the prior run still holds src/orders
  });

  it('file serialization: two proposals on the same file → only the higher-priority one dispatches', async () => {
    for (const [ref, prio] of [['sig-hi', 90], ['sig-lo', 50]] as const) {
      await db.query(
        `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence)
         VALUES ($1,'bug_fix',$2,$3,'repro',$4,'src/orders',NULL,'{}')`,
        [REPO, ref, `[bug] ${ref}`, prio],
      );
      await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: ref, decision: 'approved' });
    }
    const out = await runAutoDev(REPO, opts(new StubAgentDriver(goodScript)));
    expect(out).toHaveLength(1); // same target file → serialized to one this run
    expect(out[0]!.ref_id).toBe('sig-hi'); // the higher-priority proposal wins the slot
  });
});
