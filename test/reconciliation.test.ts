import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { groupComponents, runReconciliation, type ReconcileGroup } from '../src/processing/pipeline/reconciliation.js';
import { canConnect, setupTestDb, dropTestDb, truncateAll, makeTestCtx, review } from './helpers/testdb.js';
import { processReview } from '../src/processing/index.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import { randomUUID } from 'node:crypto';
import type { Db } from '../src/db/db.js';

const embedder = new LocalEmbeddingClient();

const g = (id: string, canonical: string | null, artifacts: string[]): ReconcileGroup => ({ id, canonical, artifacts, firstSeen: '2026-05-01' });

// #3 — the tricky bridging logic, pure (no DB).
describe('groupComponents (#3 union-find)', () => {
  it('artifact A and B bridged by a group holding both → one component', () => {
    const comps = groupComponents([g('1', 'crash', ['A']), g('2', 'crash', ['B']), g('3', 'crash', ['A', 'B'])]);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.map((x) => x.id).sort()).toEqual(['1', '2', '3']);
  });
  it('A and B with no bridge → two components', () => {
    const comps = groupComponents([g('1', 'crash', ['A']), g('2', 'crash', ['B'])]);
    expect(comps).toHaveLength(2);
  });
  it('empty artifacts act as a wildcard (merge within canonical)', () => {
    const comps = groupComponents([g('1', 'crash', []), g('2', 'crash', ['B'])]);
    expect(comps).toHaveLength(1);
  });
  it('different canonical never merges', () => {
    const comps = groupComponents([g('1', 'crash', ['A']), g('2', 'hang', ['A'])]);
    expect(comps).toHaveLength(2);
  });
  it('null canonical is never auto-merged', () => {
    expect(groupComponents([g('1', null, []), g('2', null, [])])).toHaveLength(0);
  });
});

const reachable = await canConnect();
describe.skipIf(!reachable)('grouping is order-independent after reconciliation (#3)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  // Same reviews, different processing orders → identical group signature after reconciliation.
  const corpus = [
    () => review('결제 강제종료', { source_id: 'c1', rating: 1, platform: 'ios' }),
    () => review('결제할 때 크래시', { source_id: 'c2', rating: 1, platform: 'android' }),
    () => review('차트가 멈춰요 freeze', { source_id: 'h1', rating: 2, platform: 'web' }),
  ];

  async function processInOrder(idx: number[]): Promise<string> {
    await truncateAll(db);
    const ctx = makeTestCtx(db);
    for (const i of idx) await processReview(corpus[i]!(), ctx);
    await runReconciliation(db);
    const rows = await db.query<{ c: number }>(`SELECT corroboration_count c FROM signal_groups WHERE status='open' ORDER BY c`);
    return rows.map((r) => r.c).join(',');
  }

  it('order [0,1,2] and [2,1,0] yield the same grouping', async () => {
    const a = await processInOrder([0, 1, 2]);
    const b = await processInOrder([2, 1, 0]);
    expect(a).toBe(b);
    expect(a).toBe('1,2'); // one hang (1) + one merged crash group (2)
  });

  // Directly exercises mergeSignalGroups (the inline canonical match in the test above never
  // actually triggers a merge — it caught a BLOCKER: signal_group_id is a GENERATED column).
  let n = 0;
  async function seedDefectGroup(canonical: string, artifacts: string[]): Promise<void> {
    const sid = `d${++n}`;
    const rr = await db.insertRawReview('app_store', sid, { text: sid }, '2026-05-20T00:00:00Z');
    const inf = { classification: { severity: 'high' }, extraction: { feature_mapping: { feature_id: null, state: 'defective' } }, defect: { error_signature: { canonical } } };
    const pr = await db.query<{ id: string }>(
      `INSERT INTO processed_reviews (id, source, source_id, raw_review_id, facts, inferences, versions, created_at, processed_at, llm_calls)
       VALUES (gen_random_uuid(),'app_store',$1,$2,$3,$4,'{}','2026-05-20T00:00:00Z','2026-05-20T00:00:00Z','[]') RETURNING id`,
      [sid, rr.id, JSON.stringify({ created_at: '2026-05-20T00:00:00Z', platform: 'ios' }), JSON.stringify(inf)],
    );
    const gid = await db.createSignalGroup({ repReviewId: pr[0]!.id, embedding: (await embedder.embed(canonical)).vector, canonical, artifactIds: artifacts, regressionHint: null, firstSeen: '2026-05-20T00:00:00Z' });
    await db.query(`UPDATE processed_reviews SET inferences = jsonb_set(inferences, '{signal}', $2::jsonb) WHERE id = $1`, [pr[0]!.id, JSON.stringify({ signal_group_id: gid })]);
  }

  it('merges same-canonical groups bridged by a shared artifact + reassigns members (no GENERATED-column error)', async () => {
    const A = randomUUID(), B = randomUUID();
    await seedDefectGroup('crash', [A]);
    await seedDefectGroup('crash', [B]);
    await seedDefectGroup('crash', [A, B]); // bridges A and B → all one component
    await runReconciliation(db);
    const open = await db.query<{ c: number }>(`SELECT corroboration_count::int c FROM signal_groups WHERE status='open'`);
    expect(open.length).toBe(1); // 3 groups → 1
    expect(open[0]!.c).toBe(3); // members reassigned via the generated column's JSON source + recounted
  });
});
