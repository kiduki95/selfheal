import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { processReview } from '../src/processing/index.js';
import { canConnect, setupTestDb, dropTestDb, truncateAll, makeTestCtx, review } from './helpers/testdb.js';
import type { Db } from '../src/db/db.js';

// #5 — a semantic-cache HIT must still enqueue gap/enhancement to the human queue
// (previously that logic lived only in the cache-MISS branch).
const reachable = await canConnect();

// Calibrated for the local hash embedder: cosine ≈ 0.9524 → passes dedup (<0.985), hits cache (≥0.95).
const T1 = '다크모드 기능을 추가해주시면 정말 좋겠습니다 야간에 눈이 너무 부셔서 앱을 쓰기가 많이 불편합니다 꼭 부탁드려요';
const T2 = '다크모드 기능을 추가해주시면 정말 좋겠습니다 야간에 눈이 너무 부셔서 앱을 쓰기가 많이 불편합니다 꼭 부탁드립니다';

describe.skipIf(!reachable)('semantic cache hit enqueues gap/enhancement (#5)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  it('a cache-hit feature_request (gap, empty registry) is still queued for human review', async () => {
    const ctx = makeTestCtx(db);
    const first = await processReview(review(T1, { source_id: 's1', rating: 2 }), ctx);
    expect(first.status).toBe('classified');
    expect(first.human_review_reasons).toContain('feature_gap'); // miss path (baseline)

    const second = await processReview(review(T2, { source_id: 's2', rating: 2 }), ctx);
    expect(second.status).toBe('cache_hit'); // exercised the cache-hit branch
    expect(second.human_review_reasons).toContain('feature_gap'); // the fix: hit path also enqueues

    // and it actually landed in the queue table
    const q = await db.query<{ n: string }>(`SELECT count(*) n FROM human_review_queue WHERE reason='feature_gap'`);
    expect(Number(q[0]!.n)).toBe(2);
    // The same unified post-branch block now also recomputes escalation reasons (critical/refund_legal/
    // low_confidence) from the finalized inferences, so a cache hit no longer drops them. The reasons
    // themselves are unit-tested in escalation.test.ts; this test guards that the block runs on cache hits.
  });
});
