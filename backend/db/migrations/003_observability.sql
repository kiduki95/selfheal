-- drift(PSI) baseline 스냅샷. 런마다 분포(language/category/sentiment/spam)를 저장 → 다음 런이
-- 이전 스냅샷 대비 PSI를 계산해 분포 변화를 감지 (spec §8 "7일 baseline 대비 PSI"의 단순화 버전).
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label     text,
  distributions jsonb NOT NULL,   -- { language:{ko:n,...}, category:{...}, sentiment:{...}, spam:{...} }
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metric_snap_created ON metric_snapshots (created_at DESC);
