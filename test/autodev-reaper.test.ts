import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import type { Db } from '../src/db/db.js';

// Reaper (spec §2): a crashed/stalled non-terminal run holds the active claim forever (the partial-
// unique index only frees on a terminal status). reapStaleRuns releases it by flipping to timed_out.
// B1 regression: 'pr_open' is a TERMINAL success/handoff status — the reaper must NOT touch it
// (otherwise a finished dry-run handoff would be silently corrupted into a timed-out failure).
const reachable = await canConnect();
const REPO = 'test/reaper';

describe.skipIf(!reachable)('reapStaleRuns', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  async function mkRun(ref: string, status: string): Promise<string> {
    const run = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: ref, status: 'queued' });
    await db.updateAgentRun(run!.id, { status });
    return run!.id;
  }

  it('reaps a stalled non-terminal run but leaves a terminal pr_open run intact', async () => {
    const stalled = await mkRun('r-impl', 'implementing');
    const handed = await mkRun('r-pr', 'pr_open');

    // Drive "now" an hour into the future so the just-written rows look stale (deterministic clock).
    const reaped = await db.reapStaleRuns(60_000, "(now() + interval '1 hour')");

    expect(reaped).toContain(stalled);      // non-terminal + stale → reaped
    expect(reaped).not.toContain(handed);   // pr_open is terminal → never reaped

    expect((await db.getAgentRun(stalled))?.status).toBe('timed_out');
    const pr = await db.getAgentRun(handed);
    expect(pr?.status).toBe('pr_open');     // success/handoff preserved (B1)
  });

  it('does not reap fresh non-terminal runs', async () => {
    await mkRun('r-fresh', 'implementing');
    const reaped = await db.reapStaleRuns(60_000); // real now() — the row is seconds old
    expect(reaped).toHaveLength(0);
  });

  it('reaping releases the active claim so the proposal can be re-claimed', async () => {
    const stalled = await mkRun('r-claim', 'implementing');
    // While active, a second claim is refused (partial-unique index).
    expect(await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: 'r-claim', status: 'queued' })).toBeNull();
    await db.reapStaleRuns(60_000, "(now() + interval '1 hour')");
    // After reaping (stalled → timed_out, terminal), the claim is free again.
    const reclaim = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: 'r-claim', status: 'queued' });
    expect(reclaim).not.toBeNull();
    expect(reclaim!.id).not.toBe(stalled);
  });
});
