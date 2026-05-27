import { Hono } from 'hono';
import { envelope, type ApiEnv, type RawReview } from '../contract.js';
import { toRelativeLong } from '../format.js';

const r = new Hono<ApiEnv>();

// classification.category enum -> the human label the UI shows. The mock carries
// richer domain labels (e.g. 'Transcription quality'); we map the coarse
// processing enum to its readable form. Spam is conveyed via `filtered`, not here.
const CATEGORY_LABEL: Record<string, string> = {
  bug: 'Bug',
  feature_request: 'Feature request',
  praise: 'Praise',
  complaint: 'Complaint',
  question: 'Question',
  other: 'Other',
};

// Raw DB projection — every column is typed (no `any`) so the mapping to RawReview
// below is checked by the compiler against the contract.
interface ReviewRow {
  id: string;
  src: string;
  lang: string | null;            // facts.language (ISO 639-1)
  rating: number | null;          // facts.rating
  sentiment: string | null;       // 'positive'|'neutral'|'negative'
  severity: string | null;        // 'low'|'medium'|'high'|'critical'
  category: string | null;
  confidence: number | null;      // classification.category_confidence
  text: string | null;            // facts.text_redacted
  text_en: string | null;         // inferences.text_en
  created_at: string | null;
  locale: string | null;          // facts.locale (BCP-47) — used to derive country
  fstate: string | null;          // feature_mapping.state
  mapped: string | null;          // feature_mapping.feature_id
  mapped_label: string | null;    // feature_registry.pref_label
  cluster: string | null;         // inferences.signal.signal_group_id
  is_spam: boolean | null;        // moderation.is_spam
}

// classification.sentiment -> frontend compact union. DB has no 'mixed', so 'mix'
// is unreachable from real data; it stays in the union to match the mock contract.
function toSentiment(s: string | null): RawReview['sentiment'] {
  switch (s) {
    case 'positive': return 'pos';
    case 'negative': return 'neg';
    default: return 'neu';
  }
}

// severity -> priority band (the mock uses P0..P3). No dedicated priority column yet.
function toPriority(severity: string | null): string {
  switch (severity) {
    case 'critical': return 'P0';
    case 'high': return 'P1';
    case 'medium': return 'P2';
    default: return 'P3';
  }
}

// Derive a display country from the BCP-47 locale region subtag (e.g. 'ko-KR' -> 'KR').
// TODO(ingestion): real reviewer country (not in the processing contract today).
function toCountry(locale: string | null): string {
  if (!locale) return '—';
  const region = locale.split(/[-_]/)[1];
  return region ? region.toUpperCase() : '—';
}

// GET /api/reviews — processed reviews projected to the frontend RawReview shape.
r.get('/', async (c) => {
  const rows = await c.var.db.query<ReviewRow>(
    `SELECT pr.id,
       pr.source AS src,
       pr.facts->>'language' AS lang,
       (pr.facts->>'rating')::int AS rating,
       pr.inferences->'classification'->>'sentiment' AS sentiment,
       pr.inferences->'classification'->>'severity' AS severity,
       pr.inferences->'classification'->>'category' AS category,
       (pr.inferences->'classification'->>'category_confidence')::float AS confidence,
       pr.facts->>'text_redacted' AS text,
       pr.inferences->>'text_en' AS text_en,
       pr.facts->>'created_at' AS created_at,
       pr.facts->>'locale' AS locale,
       pr.inferences->'extraction'->'feature_mapping'->>'state' AS fstate,
       pr.inferences->'extraction'->'feature_mapping'->>'feature_id' AS mapped,
       fr.pref_label AS mapped_label,
       pr.inferences->'signal'->>'signal_group_id' AS cluster,
       (pr.inferences->'moderation'->>'is_spam')::boolean AS is_spam
     FROM processed_reviews pr
     LEFT JOIN feature_registry fr ON fr.id = (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid
     ORDER BY pr.created_at DESC`,
  );

  const data: RawReview[] = rows.map((row) => {
    const isOrphan = row.fstate === 'gap';
    return {
      id: row.id,
      src: row.src,
      // TODO(ingestion): real author handle — redacted out of facts.text by PII stage; not stored.
      author: 'anonymous',
      country: toCountry(row.locale),
      lang: (row.lang ?? 'und').toUpperCase(),
      rating: row.rating,
      sentiment: toSentiment(row.sentiment),
      priority: toPriority(row.severity),
      // Pre-formatted relative label ('14 min ago'), matching the mock the UI renders verbatim.
      when: toRelativeLong(row.created_at),
      text: row.text ?? '',
      ...(row.text_en ? { text_en: row.text_en } : {}),
      category: CATEGORY_LABEL[row.category ?? 'other'] ?? 'Other',
      // Classifier category confidence as the row's confidence; 0 when absent.
      confidence: row.confidence ?? 0,
      mapped: row.mapped,
      mappedLabel: row.mapped_label ?? (isOrphan ? '(unmapped)' : '—'),
      cluster: row.cluster,
      tags: [], // TODO(ingestion): real per-review tags (entities / raw feature mentions)
      ...(isOrphan ? { isOrphan: true } : {}),
      ...(row.is_spam ? { filtered: true } : {}),
    };
  });

  return c.json(envelope(data, c.var.repo));
});

export default r;
