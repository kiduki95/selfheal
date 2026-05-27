import { Hono } from 'hono';
import { envelope, type ApiEnv, type AgentRun } from '../contract.js';
import { toAgentRun } from './_autodev-map.js';

const r = new Hono<ApiEnv>();

// GET /api/agents — Auto-Dev runs (newest first) mapped to the frontend `AgentRun` contract.
// Steps are reconstructed from agent_run_events (the run's phase timeline). One events query for
// the whole repo, grouped by run_id in memory (few runs in practice → no N+1).
r.get('/', async (c) => {
  const runs = await c.var.db.listAgentRuns(c.var.repo);
  const events = await c.var.db.listAgentRunEvents(c.var.repo);
  const byRun = new Map<string, typeof events>();
  for (const e of events) (byRun.get(e.run_id) ?? byRun.set(e.run_id, []).get(e.run_id)!).push(e);
  const data: AgentRun[] = runs.map((run) => toAgentRun(run, byRun.get(run.id) ?? []));
  const note = data.length ? undefined : 'no Auto-Dev runs yet — approve a proposal and run `npm run autodev`';
  return c.json(envelope(data, c.var.repo, 'live', note));
});

export default r;
