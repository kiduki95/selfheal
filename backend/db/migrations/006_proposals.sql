-- Insight & Proposal Layer 산출물 — Processing 신호를 우선순위 매겨 issue 초안으로.
-- 경계(spec §1.3): Insight는 제안/이슈 초안까지. 실제 PR 생성은 Auto-Dev.
CREATE TABLE IF NOT EXISTS proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo          text NOT NULL,
  kind          text NOT NULL,             -- 'bug_fix' | 'feature_gap' | 'enhancement'
  ref_id        text,                       -- signal_group_id 또는 feature_id
  title         text NOT NULL,
  body          text NOT NULL,              -- issue 본문(markdown)
  priority      real NOT NULL DEFAULT 0,    -- 정렬용 점수
  target_module text,                        -- gap: 추가할 모듈 (또는 신규)
  placement     text,                        -- 'existing_module' | 'new_module' | null
  evidence      jsonb NOT NULL DEFAULT '{}', -- corroboration/severity/demand 등
  status        text NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_repo ON proposals (repo, priority DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_kind ON proposals (kind);
