// Shared proposal query + DB-row -> contract `Proposal` mapper.
// Both GET /api/proposals and GET /api/dashboard surface the proposal queue, so the
// SQL projection and the row->Proposal mapping live here once and are reused.
//
// Design: pure SQL -> JSON shaping (no LLM). Every field the frontend `Proposal`
// declares is produced here; fields with no real DB source yet are defaulted and
// flagged with TODO so the contract stays satisfied without fabricating data.
import type { Db } from '../../db/db.js';
import type { Proposal } from '../contract.js';

// --- DB projection -----------------------------------------------------------
// One row per proposal, with the HITL decision LEFT JOINed in and the cluster
// context (error signature / corroboration for bugs, demand for gap/enh) and the
// per-source review counts pre-aggregated in SQL. Every column is typed (no `any`).
export interface ProposalRow {
  id: string;
  kind: 'bug_fix' | 'feature_gap' | 'enhancement';
  title: string;
  body: string;
  priority: number;                    // unified 0-100 impact score
  target_module: string | null;
  ref_id: string | null;               // stable identity: signal_group id (bug) or feature_id (gap/enh)
  // evidence JSON fields (insight.ts writes these) — only the ones we surface:
  band: string | null;                 // 'critical'|'high'|'medium'|'low'
  effort: string | null;               // size label e.g. 'S'|'M'|'L'
  effort_weeks: string | null;         // e.g. '2-3 wks'
  verdict: string | null;              // gap grounding: 'grounded'|'partial'|'ungrounded'
  demand: number | null;               // gap/enhancement demand from evidence
  corroboration: number | null;        // bug corroboration from evidence
  // joined context:
  error_signature: string | null;      // signal_groups.error_signature (bug cluster label)
  group_corroboration: number | null;  // signal_groups.corroboration_count (bug impacted)
  feature_label: string | null;        // feature_registry.pref_label for the ref'd feature/gap
  feature_demand: number | null;       // distinct-author demand for the ref'd feature/gap
  sources: Record<string, number> | null; // per-source review counts for this cluster
  // HITL decision:
  decision: string;                    // 'pending'|'approved'|'rejected'|'in_dev'|'merged'
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

// Single source of the projection. Reused by both routes; ORDER BY priority DESC so
// the highest-impact proposals come first (matches the insight layer's own sort).
const SELECT = `
  SELECT p.id, p.kind, p.title, p.body, p.priority, p.target_module, p.ref_id,
         p.evidence->>'band'         AS band,
         p.evidence->>'effort'       AS effort,
         p.evidence->>'effort_weeks' AS effort_weeks,
         p.evidence->>'verdict'      AS verdict,
         (p.evidence->>'demand')::int        AS demand,
         (p.evidence->>'corroboration')::int AS corroboration,
         sg.error_signature                  AS error_signature,
         sg.corroboration_count              AS group_corroboration,
         fr.pref_label                        AS feature_label,
         -- distinct-author demand for the ref'd feature/gap (incl. merged members), gap/enh only
         (SELECT count(DISTINCT COALESCE(rr.payload->'author'->>'id', rr.payload->'author'->>'name', pr.source_id))
            FROM processed_reviews pr JOIN raw_reviews rr ON rr.id = pr.raw_review_id
            WHERE p.kind <> 'bug_fix'
              AND (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid IN
                  (SELECT p.ref_id::uuid UNION SELECT m.id FROM feature_registry m WHERE m.merged_into = p.ref_id::uuid)
         ) AS feature_demand,
         -- per-source review counts backing this proposal's cluster, as a JSON object:
         --   bug    -> reviews whose signal_group_id = ref_id
         --   gap/enh -> reviews mapped to the feature (incl. merged-away members)
         (SELECT COALESCE(jsonb_object_agg(s.source, s.n), '{}'::jsonb)
            FROM (
              SELECT pr.source AS source, count(*)::int AS n
              FROM processed_reviews pr
              LEFT JOIN raw_reviews rr ON rr.id = pr.raw_review_id
              WHERE (p.kind = 'bug_fix'  AND pr.signal_group_id = p.ref_id::uuid)
                 OR (p.kind <> 'bug_fix' AND (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid IN
                       (SELECT p.ref_id::uuid UNION SELECT m.id FROM feature_registry m WHERE m.merged_into = p.ref_id::uuid))
              GROUP BY pr.source
            ) s
         ) AS sources,
         COALESCE(rv.decision, 'pending') AS decision,
         rv.decided_by, rv.decided_at::text AS decided_at, rv.note AS decision_note
  FROM proposals p
  LEFT JOIN proposal_reviews rv ON rv.repo = p.repo AND rv.kind = p.kind AND rv.ref_id = p.ref_id
  -- bug cluster context: ref_id is a signal_group id
  LEFT JOIN signal_groups sg ON p.kind = 'bug_fix' AND sg.id = p.ref_id::uuid
  -- gap/enh feature context: ref_id is a feature_registry id
  LEFT JOIN feature_registry fr ON p.kind <> 'bug_fix' AND fr.id = p.ref_id::uuid
  WHERE p.repo = $1`;

export async function queryProposals(db: Db, repo: string, limit?: number): Promise<ProposalRow[]> {
  const sql = `${SELECT} ORDER BY p.priority DESC` + (limit ? ` LIMIT ${Number(limit)}` : '');
  return db.query<ProposalRow>(sql, [repo]);
}

// --- band -> pri rank --------------------------------------------------------
// The frontend `pri` is a small integer rank (0 = most urgent). We map the impact
// band: critical=0, high=1, medium=2, low=3 (4 = unknown band). Lower = higher priority.
const BAND_PRI: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
function bandToPri(band: string | null): number {
  return band != null && band in BAND_PRI ? BAND_PRI[band]! : 4; // TODO(insight): bands always set today; 4 guards future kinds
}

// --- kind -> skill -----------------------------------------------------------
// Derived label the UI shows as the proposed remediation skill. Auto-Dev isn't
// built, so this is a static map from proposal kind, NOT a real assigned agent skill.
const KIND_SKILL: Record<ProposalRow['kind'], string> = {
  bug_fix: 'debugging',
  feature_gap: 'feature-dev',
  enhancement: 'enhancement',
};

// --- decision -> column ------------------------------------------------------
// HITL decision enum -> the frontend kanban column. 'in_dev' and 'merged' both land
// in the 'in-dev' column (the board has no separate merged lane). Default 'pending'.
function decisionToColumn(decision: string): Proposal['column'] {
  switch (decision) {
    case 'approved': return 'approved';
    case 'rejected': return 'rejected';
    case 'in_dev':
    case 'merged': return 'in-dev';
    default: return 'pending';
  }
}

// --- confidence --------------------------------------------------------------
// Frontend `confidence` is 0..1. Mirror the impact model's confidence factor
// (impact.ts): bugs/enhancements are concrete (1.0); gaps are discounted by how
// grounded the request is against the code graph (grounded/partial/ungrounded).
const VERDICT_CONFIDENCE: Record<string, number> = { grounded: 1.0, partial: 0.7, ungrounded: 0.4 };
function deriveConfidence(row: ProposalRow): number {
  if (row.kind === 'feature_gap') return row.verdict != null ? (VERDICT_CONFIDENCE[row.verdict] ?? 0) : 0;
  if (row.kind === 'bug_fix' || row.kind === 'enhancement') return 1.0;
  return 0; // TODO(insight): unknown kind — no confidence basis
}

// --- problem / proposal split ------------------------------------------------
// `body` is issue markdown. The insight layer writes a leading "## 버그 신호" /
// "## 개선 요청" section then a body. We don't have a stable problem/proposal split,
// so put the whole body in `proposal` and omit `problem`.
// TODO(insight): emit a structured problem/proposal split in proposals.body to populate both.
function splitBody(body: string): { problem?: string; proposal?: string } {
  return body ? { proposal: body } : {};
}

// Map one DB row to the frontend `Proposal` contract.
export function toProposal(row: ProposalRow): Proposal {
  const isBug = row.kind === 'bug_fix';
  // cluster: human label for the originating signal cluster — error signature for bugs,
  // feature label for gap/enhancement; fall back to the ref_id, then the title.
  const cluster =
    (isBug ? row.error_signature : row.feature_label) ?? row.ref_id ?? row.title;
  // impacted: corroboration count (bug) or distinct-author demand (gap/enh).
  const impacted = isBug
    ? (row.group_corroboration ?? row.corroboration ?? 0)
    : (row.feature_demand ?? row.demand ?? 0);
  // targetLabel: the raw target_module string (bug = code path, gap/enh = module
  // label), else em dash. (No feature-id join: bug targets are paths, not uuids.)
  const targetLabel = row.target_module ?? '—';

  const base: Proposal = {
    id: row.id,
    title: row.title,
    cluster,
    impacted,
    // effort: prefer the human "weeks" label, fall back to the size band, else em dash.
    effort: row.effort_weeks ?? row.effort ?? '—',
    pri: bandToPri(row.band),
    confidence: deriveConfidence(row),
    column: decisionToColumn(row.decision),
    target: row.target_module ?? '', // TODO(insight): bug target is a code path, gap/enh is a label
    targetLabel,
    skill: KIND_SKILL[row.kind] ?? 'unknown', // derived from kind (Auto-Dev not built)
    impactScore: Math.round(row.priority), // priority IS the 0-100 unified impact score
    sources: row.sources ?? {},            // per-source review counts (SQL-aggregated); {} when none
    ...splitBody(row.body),
    // expectedImpact / similar / agent: Auto-Dev + similarity not built -> omitted (undefined).
  };

  // approver / rejector / rejectReason from the HITL decision. No fabricated PII:
  // use the recorded decided_by, falling back to 'unknown'. `at` uses decided_at as-is.
  if (row.decision === 'approved') {
    base.approver = { name: row.decided_by ?? 'unknown', at: row.decided_at ?? '' };
  } else if (row.decision === 'rejected') {
    base.rejector = { name: row.decided_by ?? 'unknown', at: row.decided_at ?? '' };
    if (row.decision_note) base.rejectReason = row.decision_note;
  }
  return base;
}
