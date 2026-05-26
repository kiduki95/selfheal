import { Hono } from 'hono';
import { envelope, type ApiEnv } from '../contract.js';

const r = new Hono<ApiEnv>();

// GET /api/reviews — processed reviews with their feature mapping + signal badges.
r.get('/', async (c) => {
  const rows = await c.var.db.query<any>(
    `SELECT pr.id, pr.source_id AS src, pr.category,
       pr.inferences->'classification'->>'sentiment' AS sentiment,
       pr.inferences->'classification'->>'severity' AS severity,
       pr.facts->>'lang' AS lang,
       pr.facts->>'text_redacted' AS text,
       pr.inferences->'extraction'->'feature_mapping'->>'state' AS fstate,
       fr.pref_label AS feature
     FROM processed_reviews pr
     LEFT JOIN feature_registry fr ON fr.id = (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid
     ORDER BY pr.category, pr.source_id`,
  );
  return c.json(envelope(rows, c.var.repo));
});

export default r;
