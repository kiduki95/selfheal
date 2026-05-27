import { Hono } from 'hono';
import { envelope, type ApiEnv, type AuditEvent } from '../contract.js';
import { toAuditEvent } from './_autodev-map.js';

const r = new Hono<ApiEnv>();

// GET /api/activity — the audit/activity feed. v1 source = agent_run_events (Auto-Dev progress).
// Other event sources (proposal decisions, ingestion, …) fold in here as those layers wire up.
r.get('/', async (c) => {
  const events = await c.var.db.listAgentRunEvents(c.var.repo, 300);
  const data: AuditEvent[] = events.map(toAuditEvent);
  const note = data.length ? 'source: Auto-Dev run events (other event sources fold in as layers wire up)' : 'no activity yet';
  return c.json(envelope(data, c.var.repo, 'live', note));
});

export default r;
