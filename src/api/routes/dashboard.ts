import { Hono } from 'hono';
import { envelope, type ApiEnv } from '../contract.js';

const r = new Hono<ApiEnv>();

// GET /api/dashboard — pipeline counts + category aggregate.
// activity feed awaits the audit layer (roadmap §8), so it returns empty for now.
r.get('/', async (c) => {
  const db = c.var.db, repo = c.var.repo;
  const cats = await db.query<{ name: string; count: string }>(
    `SELECT category AS name, count(*) AS count FROM processed_reviews GROUP BY category ORDER BY count DESC`,
  );
  const total = cats.reduce((s, x) => s + Number(x.count), 0) || 1;
  const categories = cats.map((x) => ({ name: x.name, count: Number(x.count), share: Math.round((Number(x.count) / total) * 1000) / 10, trend: 'flat' as const, pct: 0 }));
  const propCount = await db.scalar(`SELECT count(*) AS n FROM proposals WHERE repo=$1`, [repo]).catch(() => 0);
  const pipeline = [
    { num: '02', name: 'Processing', value: total, unit: 'classified', sub: repo, sparkData: [] },
    { num: '03', name: 'Insights', value: Number(propCount), unit: 'proposals', sub: 'current', sparkData: [] },
  ];
  return c.json(envelope({ pipeline, categories, activity: [] }, repo, 'live', 'activity awaits audit layer (roadmap §8)'));
});

export default r;
