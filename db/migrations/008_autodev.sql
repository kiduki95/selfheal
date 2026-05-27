-- Auto-Dev Layer (layer 5) — execution unit for approved proposals (autodev-layer.md §7).
-- Couples to upstream layers only via table contracts: input proposals + proposal_reviews
-- (approved), output agent_runs + agent_run_events. No code coupling.

-- An execution unit. One ACTIVE run per proposal (claimed via the partial-unique index below).
CREATE TABLE IF NOT EXISTS agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo           text NOT NULL,
  kind           text NOT NULL,             -- bug_fix | feature_gap | enhancement
  ref_id         text NOT NULL,             -- same stable key as proposal_reviews (signal_group_id / feature_id)
  branch         text,                      -- selfheal/<kind>-<ref8>
  base_sha       text,                      -- mirror HEAD pinned at claim time → reproducible, well-defined diff
  status         text NOT NULL,             -- §2 state machine
  attempt        int  NOT NULL DEFAULT 0,
  workspace_path text,
  pr_url         text,                      -- dry-run: local artifact path (patch + PR body), never a pushed URL
  verdict        jsonb,                     -- verify result (per-gate pass/fail + reasons)
  tokens         int,
  error          text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz
);

-- Prevent double-dispatch of the same proposal: at most one NON-terminal run per (repo, kind, ref_id).
-- The orchestrator claims by INSERT … ON CONFLICT DO NOTHING against this partial-unique index. This
-- predicate MUST stay identical to createAgentRun's ON CONFLICT WHERE and TERMINAL_RUN_STATUSES in
-- src/db/db.ts (both derived from that constant). 'pr_open' is the dry-run success/handoff terminal,
-- so it's excluded here too (its claim releases on handoff; re-dispatch is gated by activeRunFor +
-- the proposal flipping to in_dev).
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_active ON agent_runs (repo, kind, ref_id)
  WHERE status NOT IN ('pr_open', 'succeeded', 'failed', 'timed_out', 'rejected_by_verifier', 'canceled');

-- Progress stream / audit (the Activity page's source once wired in v1-c).
CREATE TABLE IF NOT EXISTS agent_run_events (
  id      bigserial PRIMARY KEY,
  run_id  uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ts      timestamptz NOT NULL DEFAULT now(),
  phase   text NOT NULL,             -- preparing | planning | implementing | verifying | …
  message text,
  payload jsonb
);
CREATE INDEX IF NOT EXISTS agent_run_events_run ON agent_run_events (run_id, ts);
