import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { proposalsStale, runInsight } from '../src/insight/index.js';
import { processReview } from '../src/processing/index.js';
import { StubLlmClient } from '../src/clients/llm/stub.js';
import { config } from '../src/config.js';
import { canConnect, setupTestDb, dropTestDb, truncateAll, makeTestCtx, review } from './helpers/testdb.js';
import type { Db } from '../src/db/db.js';

// #2 — proposals drift stale relative to processing. Pure policy + freshness wiring.
describe('proposalsStale (#2)', () => {
  it('nothing processed → not stale', () => expect(proposalsStale(null, null)).toBe(false));
  it('processed but no proposals yet → stale', () => expect(proposalsStale('2026-05-26T10:00:00Z', null)).toBe(true));
  it('reviews processed after last insight → stale', () => expect(proposalsStale('2026-05-26T11:00:00Z', '2026-05-26T10:00:00Z')).toBe(true));
  it('proposals newer than processing → fresh', () => expect(proposalsStale('2026-05-26T10:00:00Z', '2026-05-26T11:00:00Z')).toBe(false));
});

const reachable = await canConnect();
describe.skipIf(!reachable)('freshness wiring (#2 integration)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  it('stale after processing with no insight; fresh once insight runs', async () => {
    const ctx = makeTestCtx(db);
    await processReview(review('결제 강제종료 크래시', { source_id: 'f1', rating: 1, platform: 'ios' }), ctx);

    let s = await db.processingStamps(config.targetRepo);
    expect(proposalsStale(s.lastProcessed, s.lastProposal)).toBe(true); // processed, no proposals

    await runInsight(db, new StubLlmClient(), config.targetRepo);
    s = await db.processingStamps(config.targetRepo);
    expect(proposalsStale(s.lastProcessed, s.lastProposal)).toBe(false); // proposals now exist
  });
});
