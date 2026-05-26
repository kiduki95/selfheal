import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { processReview } from '../src/processing/index.js';
import { canConnect, setupTestDb, dropTestDb, truncateAll, makeTestCtx, review } from './helpers/testdb.js';
import type { Db } from '../src/db/db.js';

// Integration harness baseline (regression gate). Deterministic: stub LLM + local embedder + isolated DB.
const reachable = await canConnect();
if (!reachable) console.warn('⚠️  pipeline.test: no Postgres at DATABASE_URL — integration tests skipped (run `npm run db:up`).');

describe.skipIf(!reachable)('pipeline integration (harness baseline)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  it('funnel: classifies a bug, dedups an exact copy, drops spam', async () => {
    const ctx = makeTestCtx(db);
    const a = await processReview(review('앱이 자꾸 튕겨요 강제종료됩니다', { source_id: 'a1', rating: 1, platform: 'ios', app_version: '2.4.0' }), ctx);
    expect(a.status).toBe('classified');
    expect(a.processed_review?.inferences.classification.category).toBe('bug');

    const dup = await processReview(review('앱이 자꾸 튕겨요 강제종료됩니다', { source_id: 'a1-copy', rating: 1, platform: 'ios', app_version: '2.4.0' }), ctx);
    expect(dup.status).toBe('duplicate');

    const spam = await processReview(review('aaaaaaaaaaaaaaaaaaaaaaaa'), ctx);
    expect(spam.status).toBe('dropped_prefilter');
  });

  it('Phase 2: two same-error bugs corroborate into one signal group', async () => {
    const ctx = makeTestCtx(db);
    const r1 = await processReview(review('결제 화면에서 강제종료됩니다', { source_id: 'g1', rating: 1, platform: 'ios', app_version: '2.4.0' }), ctx);
    const r2 = await processReview(review('결제할 때 앱이 튕기고 크래시가 납니다', { source_id: 'g2', rating: 1, platform: 'android', app_version: '2.4.1' }), ctx);
    expect(r1.signal?.corroboration).toBe(1);
    expect(r2.signal?.corroboration).toBe(2);
    expect(r2.signal?.created_group).toBe(false); // joined r1's group, not a new one
  });

  it('reprocessing is idempotent (corroboration does not inflate)', async () => {
    const ctx = makeTestCtx(db);
    await processReview(review('결제 강제종료', { source_id: 'i1', rating: 1, platform: 'ios' }), ctx);
    const first = await processReview(review('결제할 때 크래시', { source_id: 'i2', rating: 1, platform: 'android' }), ctx);
    expect(first.signal?.corroboration).toBe(2);
    // re-run the same review → cache hits, no new member
    const again = await processReview(review('결제할 때 크래시', { source_id: 'i2', rating: 1, platform: 'android' }), ctx);
    expect(again.signal?.corroboration).toBe(2);
  });
});
