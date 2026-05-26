import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { envelope, type ApiEnv } from '../contract.js';
import { proposalsStale } from '../../insight/insight.js';

const r = new Hono<ApiEnv>();

// GET /api/proposals — Insight proposals, highest priority first, with HITL decision joined in.
// Flags staleness (#2): if reviews were processed after the last insight run, the note warns to re-run.
r.get('/', async (c) => {
  const rows = await c.var.db.query<any>(
    `SELECT p.id, p.kind, p.title, p.priority, p.target_module, p.placement, p.body,
            p.evidence->>'verdict' AS verdict,
            COALESCE(pr.decision, 'pending') AS decision, pr.note AS decision_note, pr.decided_at
     FROM proposals p
     LEFT JOIN proposal_reviews pr ON pr.repo = p.repo AND pr.kind = p.kind AND pr.ref_id = p.ref_id
     WHERE p.repo = $1 ORDER BY p.priority DESC`,
    [c.var.repo],
  );
  const { lastProcessed, lastProposal } = await c.var.db.processingStamps(c.var.repo);
  const note = proposalsStale(lastProcessed, lastProposal) ? 'stale: reviews processed since last insight run — re-run insight (or npm run pipeline)' : undefined;
  return c.json(envelope(rows, c.var.repo, 'live', note));
});

// --- HITL gate: approve / reject ---
// Decision is keyed on the proposal's STABLE identity (repo, kind, ref_id), not the regenerated
// proposals.id — so it survives Insight re-runs (docs/architecture.md §7.1). Only 'approved' → Auto-Dev.
const decisionBody = z.object({ note: z.string().max(2000).optional(), by: z.string().max(120).optional() });

async function decide(c: any, decision: 'approved' | 'rejected') {
  const id = c.req.param('id');
  const ref = await c.var.db.getProposalRef(id);
  if (!ref) return c.json({ error: 'proposal not found or has no stable ref_id', id }, 404);
  const { note, by } = c.req.valid('json');
  await c.var.db.decideProposal({ ...ref, decision, note, by });
  return c.json(envelope({ id, kind: ref.kind, ref_id: ref.ref_id, decision }, c.var.repo, 'live', `proposal ${decision}`));
}

r.post('/:id/approve', zValidator('json', decisionBody), (c) => decide(c, 'approved'));
r.post('/:id/reject', zValidator('json', decisionBody), (c) => decide(c, 'rejected'));

export default r;
