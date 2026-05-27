-- Code-health: change coupling (co-change) from git history (Tornhill's logical/evolutionary coupling).
-- Directed file pairs with support/confidence, flagged where they reveal HIDDEN deps (no structural edge)
-- or cross module boundaries. Repo-scoped rebuild like the rest of the CodeFlow graph.
CREATE TABLE IF NOT EXISTS code_cochange (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo         text NOT NULL,
  src_path     text NOT NULL,            -- file A (the "when A changes…" side)
  dst_path     text NOT NULL,            -- file B ("…B changes too")
  support      integer NOT NULL,         -- commits where both changed
  confidence   real NOT NULL,            -- support / changes(A) ∈ (0,1]
  hidden       boolean NOT NULL DEFAULT false,  -- co-change but NO import/call edge → implicit dependency
  cross_module boolean NOT NULL DEFAULT false,  -- partner in a different module → boundary-spanning
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cochange_repo_src ON code_cochange (repo, src_path, confidence DESC);
