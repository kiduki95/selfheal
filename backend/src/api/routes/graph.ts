import { Hono } from 'hono';
import { envelope, type ApiEnv, type GraphData, type GraphReview, type RepoModule } from '../contract.js';
import { toRelativeCompact } from '../format.js';
import type { Db } from '../../db/db.js';

// Synthetic repo-root node id. The DB has no root row — feature_registry's
// top-level rows are MODULES (parent_id IS NULL). The frontend (mock +
// processing.tsx buildGraph) assumes exactly one 'repo' node with id 'root'
// and special-cases it (heat normalization excludes id === 'root'), so we
// prepend one here and reparent top-level modules under it.
const ROOT_ID = 'root';

// Cap of sampled reviews attached per feature node (keeps the payload bounded —
// the side panel only shows a handful; full lists live behind /api/reviews).
const REVIEWS_PER_FEATURE = 5;

// Row shapes coming back from the two registry/reviews queries (typed, not `any`,
// so the projection below is checked against the contract).
interface FeatureRow { id: string; label: string; parent_id: string | null; status: string; heat: string; }
interface ReviewSampleRow {
  feature_id: string;
  src: string | null;
  sentiment: string | null;   // 'positive'|'neutral'|'negative'
  rating: number | null;
  lang: string | null;        // ISO 639-1
  text: string | null;
  created_at: string | null;
}

// Map the processing-layer sentiment enum -> the frontend's compact union.
// The DB has no 'mixed' state, so 'mix' is unreachable from real data for now;
// it stays in the union to match the mock contract.
function toSentiment(s: string | null): GraphReview['sentiment'] {
  switch (s) {
    case 'positive': return 'pos';
    case 'negative': return 'neg';
    default: return 'neu';
  }
}

// Display the language code the way the mock does (uppercase ISO-ish tag).
function toLangTag(lang: string | null): string {
  if (!lang) return '—';
  return lang.toUpperCase();
}

// GET /api/graph — Processing graph as DOMAIN data (docs/web-architecture.md §5.1 S2):
// { modules: RepoModule[]; reviews: Record<moduleId, GraphReview[]> }. NO layout here —
// processing.tsx buildGraph derives ReactFlow nodes/edges + dagre on the client.
async function buildGraph(db: Db, repo: string): Promise<GraphData> {
  // All grounded features + the floating gaps for this repo, each with its mapped-review
  // count (heat). One row -> one RepoModule.
  const rows = await db.query<FeatureRow>(
    `SELECT f.id, f.pref_label AS label, f.parent_id, f.status,
       (SELECT count(*) FROM processed_reviews pr
          WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text) AS heat
     FROM feature_registry f
     WHERE f.repo = $1 AND f.status IN ('grounded','gap') AND f.merged_into IS NULL
     ORDER BY f.pref_label`,
    [repo],
  );

  // Depth within the grounded tree (gaps are excluded — they have no parent edge).
  // The DB top level (parent_id IS NULL) is a module, so: depth 0 -> 'module',
  // depth >= 1 -> 'feature'. The single 'repo' node is the synthetic root below.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    let d = 0;
    // Walk up parent_id links that resolve within this repo's grounded set.
    if (row?.parent_id && byId.has(row.parent_id)) d = depthOf(row.parent_id) + 1;
    depthCache.set(id, d);
    return d;
  };

  // Synthetic single root: parent of every top-level module. Label = repo's last
  // path segment (e.g. 'owner/loop-app' -> 'loop-app'). heat 0 (UI ignores root's).
  const repoLabel = repo.includes('/') ? repo.slice(repo.lastIndexOf('/') + 1) : repo;
  const modules: RepoModule[] = [{ id: ROOT_ID, parent: null, label: repoLabel, kind: 'repo', heat: 0 }];
  for (const r of rows) {
    const heat = Number(r.heat);
    if (r.status === 'gap') {
      // Gap = review-emergent unmapped cluster: floats free (no parent), kind 'gap'.
      modules.push({ id: r.id, parent: null, label: r.label, kind: 'gap', heat, isOrphan: true });
      continue;
    }
    const depth = depthOf(r.id);
    modules.push({
      id: r.id,
      // Top-level modules hang off the synthetic root; deeper rows keep their parent.
      parent: r.parent_id ?? ROOT_ID,
      label: r.label,
      kind: depth === 0 ? 'module' : 'feature',
      heat,
    });
  }

  // Sampled reviews per node: top-N mapped processed_reviews projected to GraphReview.
  // ROW_NUMBER caps each feature at REVIEWS_PER_FEATURE without N round-trips.
  const samples = await db.query<ReviewSampleRow>(
    `SELECT feature_id, src, sentiment, rating, lang, text, created_at FROM (
       SELECT (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') AS feature_id,
              pr.source AS src,
              pr.inferences->'classification'->>'sentiment' AS sentiment,
              (pr.facts->>'rating')::int AS rating,
              pr.facts->>'language' AS lang,
              pr.facts->>'text_redacted' AS text,
              pr.facts->>'created_at' AS created_at,
              row_number() OVER (
                PARTITION BY (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')
                ORDER BY pr.created_at DESC
              ) AS rn
       FROM processed_reviews pr
       JOIN feature_registry f ON f.id = (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid
       WHERE f.repo = $1 AND f.merged_into IS NULL
     ) t WHERE rn <= $2`,
    [repo, REVIEWS_PER_FEATURE],
  );

  const reviews: Record<string, GraphReview[]> = {};
  for (const s of samples) {
    if (!s.feature_id) continue;
    (reviews[s.feature_id] ??= []).push({
      src: s.src ?? 'web',
      sentiment: toSentiment(s.sentiment),
      rating: s.rating,
      lang: toLangTag(s.lang),
      text: s.text ?? '',
      tags: [], // TODO(ingestion): real per-review tag source (entities/feature mentions)
      date: toRelativeCompact(s.created_at), // '2h' style, matching the mock
    });
  }

  return { modules, reviews };
}

const r = new Hono<ApiEnv>();
r.get('/', async (c) => c.json(envelope(await buildGraph(c.var.db, c.var.repo), c.var.repo)));
export default r;
