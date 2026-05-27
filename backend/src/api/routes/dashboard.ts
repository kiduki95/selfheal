import { Hono } from 'hono';
import { envelope, type ApiEnv, type DashboardData, type Category, type PipelineStage } from '../contract.js';
import { queryProposals, toProposal } from './_proposal-map.js';

const r = new Hono<ApiEnv>();

// Cap the proposal queue surfaced inline on the dashboard. _proposal-map orders by
// priority DESC, so this is the top-N highest-impact proposals (full list lives at /api/proposals).
const DASHBOARD_PROPOSAL_LIMIT = 12;

// GET /api/dashboard — pipeline counts + category aggregate + proposal queue + agent runs.
// activity feed awaits the audit layer (roadmap §8); agents await the Auto-Dev layer (roadmap §7).
r.get('/', async (c) => {
  const db = c.var.db, repo = c.var.repo;
  const cats = await db.query<{ name: string; count: string }>(
    `SELECT category AS name, count(*) AS count FROM processed_reviews GROUP BY category ORDER BY count DESC`,
  );
  const total = cats.reduce((s, x) => s + Number(x.count), 0) || 1;
  // TODO(observability): real trend/pct await metric_snapshots history; flat/0 until then.
  const categories: Category[] = cats.map((x) => ({ name: x.name, count: Number(x.count), share: Math.round((Number(x.count) / total) * 1000) / 10, trend: 'flat', pct: 0 }));
  const propCount = await db.scalar(`SELECT count(*) AS n FROM proposals WHERE repo=$1`, [repo]).catch(() => 0);
  const pipeline: PipelineStage[] = [
    { num: '02', name: 'Processing', value: total, unit: 'classified', sub: repo, sparkData: [] },
    { num: '03', name: 'Insights', value: Number(propCount), unit: 'proposals', sub: 'current', sparkData: [] },
  ];
  // Reuse the shared proposal mapper so the dashboard queue matches /api/proposals exactly.
  const proposals = (await queryProposals(db, repo, DASHBOARD_PROPOSAL_LIMIT)).map(toProposal);
  // agents: [] — Auto-Dev agent_runs not built (roadmap §7), same posture as `activity`.
  const data: DashboardData = { pipeline, categories, activity: [], proposals, agents: [] };
  return c.json(envelope(data, repo, 'live', 'activity awaits audit layer (roadmap §8); agents await Auto-Dev (roadmap §7)'));
});

export default r;
