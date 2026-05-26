import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import { runInsight } from '../src/insight/index.js';
import { StubLlmClient } from '../src/clients/llm/stub.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import type { Db } from '../src/db/db.js';

// Coverage for ③ (author-dedup) and ⑤ (bug↔enhancement cross-ref) — the independent review flagged
// both as inert/untested on the synthetic corpus. We seed rows directly to exercise their real purpose.
const reachable = await canConnect();
const REPO = 'test/cov';
const embedder = new LocalEmbeddingClient();

async function feature(db: Db, label: string, status: 'gap' | 'grounded'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO feature_registry (canonical_slug, pref_label, origin, status, repo)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [`${REPO}#${label}`, label, status === 'gap' ? 'review_emergent' : 'code_derived', status, REPO],
  );
  return r[0]!.id;
}

// Seed a raw_review + processed_review mapped to `featureId` with a given author + state.
async function seedReview(db: Db, o: { sid: string; author: string | null; featureId: string; state: string; severity?: string; groupId?: string }): Promise<string> {
  const rr = await db.insertRawReview('app_store', o.sid, { author: o.author ? { id: o.author } : undefined, text: o.sid }, '2026-05-20T00:00:00Z');
  // signal_group_id is a GENERATED column derived from inferences.signal.signal_group_id — set it there.
  const inferences: any = { classification: { severity: o.severity ?? 'high' }, extraction: { feature_mapping: { feature_id: o.featureId, state: o.state } } };
  if (o.groupId) inferences.signal = { signal_group_id: o.groupId };
  const rows = await db.query<{ id: string }>(
    `INSERT INTO processed_reviews (id, source, source_id, raw_review_id, facts, inferences, versions, created_at, processed_at, llm_calls)
     VALUES (gen_random_uuid(),'app_store',$1,$2,$3,$4,'{}','2026-05-20T00:00:00Z','2026-05-20T00:00:00Z','[]') RETURNING id`,
    [o.sid, rr.id, JSON.stringify({ created_at: '2026-05-20T00:00:00Z', app_version: null, platform: 'ios' }), JSON.stringify(inferences)],
  );
  return rows[0]!.id;
}

describe.skipIf(!reachable)('Insight coverage: ③ author-dedup + ⑤ cross-ref', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  const demandOf = (rows: any[], id: string) => Number(rows.find((r) => r.id === id)!.demand);

  it('③ demand counts DISTINCT authors, not raw reviews', async () => {
    const g = await feature(db, 'dark-mode-gap', 'gap');
    await seedReview(db, { sid: 'r1', author: 'u1', featureId: g, state: 'gap' });
    await seedReview(db, { sid: 'r2', author: 'u1', featureId: g, state: 'gap' }); // same author → should NOT add
    expect(demandOf(await db.gapFeatures2(REPO), g)).toBe(1); // 2 reviews, 1 author

    await seedReview(db, { sid: 'r3', author: 'u2', featureId: g, state: 'gap' }); // different author → +1
    expect(demandOf(await db.gapFeatures2(REPO), g)).toBe(2);
  });

  it('③ falls back to per-review counting when author is absent', async () => {
    const g = await feature(db, 'no-author-gap', 'gap');
    await seedReview(db, { sid: 'n1', author: null, featureId: g, state: 'gap' });
    await seedReview(db, { sid: 'n2', author: null, featureId: g, state: 'gap' });
    expect(demandOf(await db.gapFeatures2(REPO), g)).toBe(2); // no author → source_id fallback → counted separately
  });

  it('⑤ enhancement on a feature that also has an open bug is cross-referenced', async () => {
    const fe = await feature(db, 'login', 'grounded');
    await seedReview(db, { sid: 'enh1', author: 'a', featureId: fe, state: 'enhancement' }); // enhancement request
    // an open bug signal group whose member maps to the SAME feature (member must exist first → FK)
    const bugPr = await seedReview(db, { sid: 'bug1', author: 'b', featureId: fe, state: 'defective', severity: 'high' });
    const groupId = await db.createSignalGroup({ repReviewId: bugPr, embedding: (await embedder.embed('login crash')).vector, canonical: 'crash', artifactIds: [], regressionHint: null, firstSeen: '2026-05-20T00:00:00Z' });
    await db.query(`UPDATE processed_reviews SET inferences = jsonb_set(inferences, '{signal}', $2::jsonb) WHERE id = $1`, [bugPr, JSON.stringify({ signal_group_id: groupId })]);

    await runInsight(db, new StubLlmClient(), REPO);
    const enh = await db.query<any>(`SELECT evidence->>'related_bug' AS related FROM proposals WHERE repo=$1 AND kind='enhancement'`, [REPO]);
    expect(enh.length).toBe(1);
    expect(enh[0]!.related).toBe('true'); // cross-ref fired
  });
});
