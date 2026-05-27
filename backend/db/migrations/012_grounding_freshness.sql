-- Grounding freshness: a proposal's "where" (target file) is derived from a CodeFlow scan snapshot and
-- goes stale when the code moves (e.g. after a refactor PR merges + the repo is re-scanned). Stamp the
-- target file's content_hash at grounding time; Auto-Dev holds a proposal whose target hash no longer
-- matches the current scan (→ needs re-scan + re-Insight). Null for non-file-targeted proposals.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS grounded_hash text; -- content_hash of the target file when this proposal was generated
