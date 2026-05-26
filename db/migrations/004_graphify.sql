-- Graphify: 코드베이스를 질의 가능한 아티팩트 그래프로 (graphify-layer.md §5).
-- code_artifact_registry를 graphify가 채우도록 확장 + code_edges/graphify_runs 신설.
-- feature_registry에 origin/status 추가 (code-derived grounded vs review-emergent gap).

ALTER TABLE code_artifact_registry
  ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'file',  -- 'module'|'file'|'symbol'
  ADD COLUMN IF NOT EXISTS content_hash text,                          -- 증분 재수집 키
  ADD COLUMN IF NOT EXISTS signature    text,                          -- 심볼 시그니처 (카드 재료)
  ADD COLUMN IF NOT EXISTS tenant_id    text NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_code_kind ON code_artifact_registry (repo, kind);

ALTER TABLE feature_registry
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',   -- 'code_derived'|'review_emergent'|'manual'
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'grounded'; -- 'grounded'|'gap'|'deprecated'
CREATE INDEX IF NOT EXISTS idx_feature_status ON feature_registry (status);

-- 구조 그래프 엣지
CREATE TABLE IF NOT EXISTS code_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo        text NOT NULL,
  src_id      uuid NOT NULL REFERENCES code_artifact_registry(id) ON DELETE CASCADE,
  dst_id      uuid NOT NULL REFERENCES code_artifact_registry(id) ON DELETE CASCADE,
  kind        text NOT NULL,            -- 'contains' | 'imports' | 'calls' | 'provides'
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src_id, dst_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_edge_src ON code_edges (src_id, kind);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON code_edges (dst_id, kind);

-- 수집 run (멱등성 · 관찰가능성)
CREATE TABLE IF NOT EXISTS graphify_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL DEFAULT 'default',
  repo          text NOT NULL,
  ref           text NOT NULL,
  status        text NOT NULL DEFAULT 'running',  -- running|done|failed
  nodes_total   integer,
  nodes_changed integer,
  nodes_deleted integer,
  edges_total   integer,
  features_total integer,
  llm_tokens    integer NOT NULL DEFAULT 0,
  enrich_mode   text NOT NULL DEFAULT 'stub',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_graphify_runs ON graphify_runs (repo, started_at DESC);
