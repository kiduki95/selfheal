-- Ouroboros Processing Layer — schema v0.5 (spec §5)
-- 14 tables + HNSW indexes. Embedding dim is parameterized at the app layer (config.EMBED_DIM)
-- but Postgres needs a literal; we use 1536 (spec default, swap on embedding bake-off §9).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 원본 보존 + 처리 상태 추적
CREATE TABLE IF NOT EXISTS raw_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,
  source_id         text NOT NULL,
  payload           jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  processing_error  text,
  retry_count       smallint NOT NULL DEFAULT 0,

  -- prefilter / dedup tracking
  duplicate_of      uuid REFERENCES raw_reviews(id),
  is_filtered       boolean NOT NULL DEFAULT false,
  filter_reason     text,

  -- SimHash fingerprint for lexical dedup candidate generation (bit(64))
  simhash           bit(64),

  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_unprocessed ON raw_reviews (processed_at)
  WHERE processed_at IS NULL AND NOT is_filtered AND duplicate_of IS NULL;

-- 중간 stage 결과 보존 — 부분 재처리 가능 (version-aware input_hash 캐시 소스)
CREATE TABLE IF NOT EXISTS review_stage_outputs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_review_id   uuid NOT NULL REFERENCES raw_reviews(id) ON DELETE CASCADE,
  stage_name      text NOT NULL,
  stage_version   text NOT NULL,
  input_hash      text NOT NULL,
  output          jsonb NOT NULL,
  llm_call        jsonb,
  duration_ms     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (raw_review_id, stage_name, stage_version)
);
CREATE INDEX IF NOT EXISTS idx_stage_review ON review_stage_outputs (raw_review_id, stage_name);
CREATE INDEX IF NOT EXISTS idx_stage_version ON review_stage_outputs (stage_name, stage_version);

-- 최종 처리 결과 (facts/inferences/versions를 jsonb로 분리)
CREATE TABLE IF NOT EXISTS processed_reviews (
  id                    uuid PRIMARY KEY,
  source                text NOT NULL,
  source_id             text NOT NULL,
  raw_review_id         uuid NOT NULL REFERENCES raw_reviews(id),

  facts                 jsonb NOT NULL,
  inferences            jsonb NOT NULL,
  versions              jsonb NOT NULL,

  -- 자주 조회되는 필드는 generated column으로 promote (인덱스용)
  category              text    GENERATED ALWAYS AS (inferences->'classification'->>'category') STORED,
  is_actionable         boolean GENERATED ALWAYS AS ((inferences->>'is_actionable')::boolean) STORED,
  is_spam               boolean GENERATED ALWAYS AS ((inferences->'moderation'->>'is_spam')::boolean) STORED,
  classifier_version    text    GENERATED ALWAYS AS (versions->>'classifier') STORED,
  embedder_version      text    GENERATED ALWAYS AS (versions->>'embedder') STORED,
  language              text    GENERATED ALWAYS AS (facts->>'language') STORED,
  -- created_at: facts->>'created_at'(text→timestamptz) 캐스트는 immutable이 아니라 generated 불가.
  -- insert 시점에 앱이 채운다 (facts.created_at과 동일).
  created_at            timestamptz NOT NULL,
  signal_group_id       uuid    GENERATED ALWAYS AS ((inferences->'signal'->>'signal_group_id')::uuid) STORED,
  error_sig_canonical   text    GENERATED ALWAYS AS (inferences->'defect'->'error_signature'->>'canonical') STORED,

  processed_at          timestamptz NOT NULL DEFAULT now(),
  llm_calls             jsonb NOT NULL DEFAULT '[]',

  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_actionable     ON processed_reviews (created_at DESC) WHERE is_actionable;
CREATE INDEX IF NOT EXISTS idx_pr_category       ON processed_reviews (category);
CREATE INDEX IF NOT EXISTS idx_pr_classifier_ver ON processed_reviews (classifier_version);
CREATE INDEX IF NOT EXISTS idx_pr_embedder_ver   ON processed_reviews (embedder_version);
CREATE INDEX IF NOT EXISTS idx_pr_features_gin   ON processed_reviews USING gin ((inferences->'extraction'->'feature_ids'));
CREATE INDEX IF NOT EXISTS idx_pr_signal_group   ON processed_reviews (signal_group_id);

-- 임베딩 분리 (메타 조회 가벼움)
CREATE TABLE IF NOT EXISTS review_embeddings (
  processed_review_id  uuid PRIMARY KEY REFERENCES processed_reviews(id) ON DELETE CASCADE,
  embedding            vector(1536) NOT NULL,
  model                text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_emb_hnsw ON review_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Feature canonical registry (SKOS 모델)
CREATE TABLE IF NOT EXISTS feature_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_slug  text NOT NULL UNIQUE,
  pref_label      text NOT NULL,
  alt_labels      text[] NOT NULL DEFAULT '{}',
  description     text,
  embedding       vector(1536),
  parent_id       uuid REFERENCES feature_registry(id),
  merged_into     uuid REFERENCES feature_registry(id),
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feature_alt ON feature_registry USING gin (alt_labels);
CREATE INDEX IF NOT EXISTS idx_feature_emb_hnsw ON feature_registry USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- (A) 코드 아티팩트 레지스트리 — defect를 repo 위치에 grounding
CREATE TABLE IF NOT EXISTS code_artifact_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo            text NOT NULL,
  path            text NOT NULL,
  module          text,
  symbol          text,
  owners          text[] NOT NULL DEFAULT '{}',
  feature_ids     uuid[] NOT NULL DEFAULT '{}',
  description     text,
  embedding       vector(1536),
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo, path, symbol)
);
CREATE INDEX IF NOT EXISTS idx_code_features ON code_artifact_registry USING gin (feature_ids);
CREATE INDEX IF NOT EXISTS idx_code_emb_hnsw ON code_artifact_registry USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- (C) signal group — Phase 2 source of truth. 테이블은 v0.5에 고정, 집계 로직은 다음 레이어.
CREATE TABLE IF NOT EXISTS signal_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_review_id uuid REFERENCES processed_reviews(id),
  representative_embedding vector(1536),
  centroid            vector(1536),
  max_radius          real,
  error_signature     text,
  code_artifact_ids   uuid[] NOT NULL DEFAULT '{}',

  corroboration_count integer NOT NULL DEFAULT 1,
  affected_versions   text[] NOT NULL DEFAULT '{}',
  affected_platforms  text[] NOT NULL DEFAULT '{}',
  regression_version_hint text,
  trend               text NOT NULL DEFAULT 'new',
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now(),

  resolution_count    integer NOT NULL DEFAULT 0,
  resolved_at         timestamptz,
  status              text NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_emb_hnsw ON signal_groups USING hnsw (representative_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
CREATE INDEX IF NOT EXISTS idx_sg_corrob ON signal_groups (corroboration_count DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sg_errsig ON signal_groups (error_signature);

-- resolution evidence (#5) — 캡처만, 해소 로직은 후속
CREATE TABLE IF NOT EXISTS resolution_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id     uuid NOT NULL REFERENCES signal_groups(id) ON DELETE CASCADE,
  processed_review_id uuid NOT NULL REFERENCES processed_reviews(id),
  app_version         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resolution_sg ON resolution_signals (signal_group_id);

-- audit event 로그 3종 (#1) — 캡처만, replay 로직은 후속
CREATE TABLE IF NOT EXISTS signal_group_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id uuid NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sge_sg ON signal_group_events (signal_group_id, created_at);

CREATE TABLE IF NOT EXISTS feature_registry_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id    uuid NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fre_fid ON feature_registry_events (feature_id, created_at);

CREATE TABLE IF NOT EXISTS artifact_mapping_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id uuid,
  artifact_id   uuid NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ame_aid ON artifact_mapping_events (artifact_id, created_at);

-- 매칭 안 된 feature 후보 — 운영자 promote/reject
CREATE TABLE IF NOT EXISTS unmatched_feature_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_mention         text NOT NULL,
  normalized          text NOT NULL,
  embedding           vector(1536),
  cluster_id          uuid,
  occurrence_count    integer NOT NULL DEFAULT 1,
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now(),
  example_review_ids  uuid[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'pending',
  UNIQUE (normalized)
);

-- HITL 스텁
CREATE TABLE IF NOT EXISTS review_annotations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processed_review_id   uuid NOT NULL REFERENCES processed_reviews(id) ON DELETE CASCADE,
  field_path            text NOT NULL,
  original_value        jsonb NOT NULL,
  corrected_value       jsonb NOT NULL,
  annotator             text NOT NULL,
  reason                text,
  annotated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annot_pr ON review_annotations (processed_review_id);
CREATE INDEX IF NOT EXISTS idx_annot_at ON review_annotations (annotated_at DESC);

-- Golden dataset
CREATE TABLE IF NOT EXISTS golden_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_review_id       uuid NOT NULL REFERENCES raw_reviews(id),
  expected_facts      jsonb NOT NULL,
  expected_inferences jsonb NOT NULL,
  tags                text[] NOT NULL DEFAULT '{}',
  curator             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 사람 검토 큐 (classify의 비-confidence escalation + feature pending_review 라우팅 대상)
CREATE TABLE IF NOT EXISTS human_review_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_review_id       uuid NOT NULL REFERENCES raw_reviews(id) ON DELETE CASCADE,
  reason              text NOT NULL,        -- 'low_confidence'|'critical'|'refund_legal'|'feature_pending_review'|'author_loop'
  payload             jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'pending',  -- 'pending'|'resolved'
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrq_status ON human_review_queue (status, created_at);
