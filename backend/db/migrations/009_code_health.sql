-- Code-Health layer P1 (codeflow-layer.md / code-health design): supply-side "code as 2nd reviewer".
-- Enrich code_artifact_registry with deterministic per-artifact metrics + a code_smells table.
-- All metrics are deterministic (no LLM). Recomputed each scan (persist rebuilds repo-scoped).

ALTER TABLE code_artifact_registry
  ADD COLUMN IF NOT EXISTS loc           integer,   -- lines of code (file: total; symbol: own span)
  ADD COLUMN IF NOT EXISTS cyclomatic    integer,   -- cyclomatic complexity (symbol: own; file: Σ)
  ADD COLUMN IF NOT EXISTS fan_in        integer,   -- distinct callers (calls edges in)
  ADD COLUMN IF NOT EXISTS fan_out       integer,   -- distinct intra-repo calls/imports out
  ADD COLUMN IF NOT EXISTS churn_commits integer,   -- commits touching this file in the churn window
  ADD COLUMN IF NOT EXISTS churn_days    integer,   -- distinct days with a commit in the window
  ADD COLUMN IF NOT EXISTS has_test      boolean,   -- a sibling/covering test file exists
  ADD COLUMN IF NOT EXISTS health_score  integer;   -- 0-100, lower = unhealthier (file/module)

-- Detected code smells (one row per smell occurrence on an artifact). Repo-scoped rebuild like edges.
CREATE TABLE IF NOT EXISTS code_smells (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo        text NOT NULL,
  artifact_id uuid NOT NULL REFERENCES code_artifact_registry(id) ON DELETE CASCADE,
  kind        text NOT NULL,            -- 'god_file' | 'complex_function' | 'untested_hotspot'
  severity    text NOT NULL,            -- 'low' | 'medium' | 'high' | 'critical'
  score       integer NOT NULL,         -- 0-100 debt magnitude (drives refactor proposal impact later)
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb, -- {loc,cyclomatic,fan_in,churn,...} for the card
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smells_repo ON code_smells (repo, score DESC);
CREATE INDEX IF NOT EXISTS idx_smells_artifact ON code_smells (artifact_id);
