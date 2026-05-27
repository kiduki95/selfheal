import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { envelope, type ApiEnv, type Proposal } from '../contract.js';
import { proposalsStale } from '../../insight/insight.js';
import { queryProposals, toProposal } from './_proposal-map.js';

const r = new Hono<ApiEnv>();

// GET /api/proposals — Insight proposals, highest priority first, mapped to the frontend
// `Proposal` contract with the HITL decision joined in (see _proposal-map.ts for the mapping).
// Flags staleness (#2): if reviews were processed after the last insight run, the note warns to re-run.
r.get('/', async (c) => {
  const rows = await queryProposals(c.var.db, c.var.repo);
  const data: Proposal[] = rows.map(toProposal);
  const { lastProcessed, lastProposal } = await c.var.db.processingStamps(c.var.repo);
  const note = proposalsStale(lastProcessed, lastProposal) ? 'stale: reviews processed since last insight run — re-run insight (or npm run pipeline)' : undefined;
  return c.json(envelope(data, c.var.repo, 'live', note));
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
