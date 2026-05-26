import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { envelope, type ApiEnv } from '../contract.js';

const r = new Hono<ApiEnv>();

// GET /api/proposals — Insight proposals, highest priority first.
r.get('/', async (c) => {
  const rows = await c.var.db.query<any>(
    `SELECT id, kind, title, priority, target_module, placement, body, evidence->>'verdict' AS verdict
     FROM proposals WHERE repo=$1 ORDER BY priority DESC`,
    [c.var.repo],
  );
  return c.json(envelope(rows, c.var.repo));
});

// --- CRUD scaffold: approve / reject (HITL) ---
// Routes + zod validation are wired here; persistence is intentionally a 501 stub.
// Why stub: clearProposals() regenerates the whole proposals table on every insight run, so a
// status column on that row would be wiped. Approval state needs a separate table keyed by a
// stable proposal identity — decision pending in docs/architecture.md §7.1 (proposal_reviews).
const decision = z.object({ note: z.string().max(2000).optional() });

r.post('/:id/approve', zValidator('json', decision), (c) =>
  c.json({ source: 'mock', repo: c.var.repo, data: { id: c.req.param('id') }, note: 'Approval persistence not built — pending architecture.md §7.1 (proposal_reviews table).' }, 501),
);

r.post('/:id/reject', zValidator('json', decision), (c) =>
  c.json({ source: 'mock', repo: c.var.repo, data: { id: c.req.param('id') }, note: 'Rejection persistence not built — pending architecture.md §7.1 (proposal_reviews table).' }, 501),
);

export default r;
