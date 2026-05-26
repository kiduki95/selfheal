import { Hono } from 'hono';
import { envelope, type ApiEnv } from '../contract.js';
import type { Db } from '../../db/db.js';

// GET /api/graph — Processing graph: feature_registry tree (module->component->sub) + floating gaps.
// Ported from scripts/ui-server.ts buildGraph (React Flow nodes/edges).
async function buildGraph(db: Db, repo: string) {
  const rows = await db.query<{ id: string; label: string; parent_id: string | null; reviews: string; defective: string }>(
    `SELECT f.id, f.pref_label AS label, f.parent_id,
       (SELECT count(*) FROM processed_reviews pr WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text) AS reviews,
       (SELECT count(*) FROM processed_reviews pr WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text
          AND pr.inferences->'extraction'->'feature_mapping'->>'state' = 'defective') AS defective
     FROM feature_registry f WHERE f.repo=$1 AND f.status='grounded' ORDER BY f.pref_label`,
    [repo],
  );
  const gaps = await db.query<{ pref_label: string }>(
    `SELECT pref_label FROM feature_registry WHERE status='gap' AND repo=$1 AND merged_into IS NULL ORDER BY pref_label`, [repo]);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) (children.get(r.parent_id) ?? children.set(r.parent_id, []).get(r.parent_id)!).push(r.id);
    else roots.push(r.id);
  }
  const COL = 330, ROW = 58;
  const nodes: any[] = [];
  const edges: any[] = [];
  let y = 0;
  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    let myY: number;
    if (kids.length === 0) { myY = y * ROW; y++; }
    else { const ys = kids.map((k) => place(k, depth + 1)); myY = (ys[0]! + ys[ys.length - 1]!) / 2; }
    const r = byId.get(id)!;
    const rv = Number(r.reviews), df = Number(r.defective);
    const isLeaf = kids.length === 0;
    const style = depth === 0
      ? { background: '#0b3a52', color: '#7dd3fc', border: '1px solid #155e75', fontFamily: 'monospace', width: 190 }
      : { background: df > 0 ? '#3a1d22' : rv > 0 ? '#1e2a23' : isLeaf ? '#1d2230' : '#161a24', color: '#e6e6e6', border: `1px solid ${df > 0 ? '#ef4444' : rv > 0 ? '#3f6f55' : '#39414f'}`, width: depth === 1 ? 220 : 210 };
    nodes.push({ id: 'f:' + id, position: { x: depth * COL, y: myY }, data: { label: `${r.label}${rv ? `  ·  reviews ${rv}${df ? ` 🔴${df}` : ''}` : ''}` }, style: { ...style, borderRadius: 8, fontSize: 12, padding: 8 } });
    for (const k of kids) edges.push({ id: `e:${id}:${k}`, source: 'f:' + id, target: 'f:' + k, style: { stroke: '#39414f' } });
    return myY;
  };
  for (const root of roots) place(root, 0);
  // Floating gaps — placed off to the right with no parent edge (Insight proposes placement).
  const gapX = 3 * COL + 60;
  gaps.forEach((g, i) => nodes.push({ id: 'g:' + i, position: { x: gapX, y: i * ROW + 20 }, data: { label: `🟡 ${g.pref_label}` }, style: { background: '#2a230c', color: '#fde68a', border: '1px dashed #a16207', borderRadius: 8, fontSize: 12, width: 200, padding: 8 } }));
  return { nodes, edges };
}

const r = new Hono<ApiEnv>();
r.get('/', async (c) => c.json(envelope(await buildGraph(c.var.db, c.var.repo), c.var.repo)));
export default r;
