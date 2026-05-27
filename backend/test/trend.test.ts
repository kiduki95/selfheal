import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { deriveTrend } from '../src/util/trend.js';
import { canConnect, setupTestDb, dropTestDb, truncateAll, makeTestCtx, review } from './helpers/testdb.js';
import { processReview } from '../src/processing/index.js';
import type { Db } from '../src/db/db.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-05-26T00:00:00Z');
const ago = (d: number) => now - d * DAY;

// #4 — pure trend policy (no DB).
describe('deriveTrend (#4)', () => {
  it('0–1 reports → new', () => {
    expect(deriveTrend([], now)).toBe('new');
    expect(deriveTrend([ago(1)], now)).toBe('new');
  });
  it('burst in recent window → rising', () => {
    expect(deriveTrend([ago(1), ago(2), ago(3)], now)).toBe('rising');
  });
  it('no activity in recent window → declining', () => {
    expect(deriveTrend([ago(40), ago(45), ago(50)], now)).toBe('declining');
  });
  it('more recent than prior → rising; fewer → declining', () => {
    expect(deriveTrend([ago(1), ago(2), ago(20)], now)).toBe('rising'); // recent 2 > prior 1
    expect(deriveTrend([ago(2), ago(18), ago(20)], now)).toBe('declining'); // recent 1 < prior 2
  });
  it('balanced across windows → stable', () => {
    expect(deriveTrend([ago(2), ago(5), ago(18), ago(22)], now)).toBe('stable'); // recent 2 == prior 2
  });
});

const reachable = await canConnect();
describe.skipIf(!reachable)('trend recompute (#4 integration)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  it('a group of old reports recomputes to declining at a later now', async () => {
    const ctx = makeTestCtx(db);
    const old = '2026-01-01T00:00:00Z'; // ~5 months before now
    await processReview(review('결제 강제종료', { source_id: 't1', rating: 1, platform: 'ios', created_at: old }), ctx);
    await processReview(review('결제할 때 크래시', { source_id: 't2', rating: 1, platform: 'android', created_at: old }), ctx);
    await db.recomputeTrends(new Date('2026-05-26T00:00:00Z'));
    const rows = await db.query<{ trend: string }>(`SELECT trend FROM signal_groups WHERE status='open'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.trend === 'declining')).toBe(true);
  });
});
