-- HITL approval gate (architecture.md §7.1). The Insight layer regenerates the proposals
-- table on every run (clearProposals → re-insert), so the human decision must be keyed on the
-- STABLE identity (repo, kind, ref_id) — signal_group_id for bugs, feature_id for gap/enhancement —
-- not the regenerated proposals.id. Read path LEFT JOINs this in. Only 'approved' flows to Auto-Dev.
CREATE TABLE IF NOT EXISTS proposal_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo        text NOT NULL,
  kind        text NOT NULL,              -- 'bug_fix' | 'feature_gap' | 'enhancement'
  ref_id      text NOT NULL,              -- stable: signal_group_id or feature_id
  decision    text NOT NULL,              -- 'approved' | 'rejected' | 'in_dev' | 'merged'
  note        text,
  decided_by  text,
  title_snap  text,                       -- proposal title at decision time (audit; proposal regenerates)
  decided_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_proposal_reviews ON proposal_reviews (repo, decision);
