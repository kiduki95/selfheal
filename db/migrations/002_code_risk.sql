-- code_artifact_registry에 경로 기반 risk tier 추가.
-- defect가 매핑되는 코드 모듈의 위험도 → Insight 우선순위 가중(결제/인증 크래시 > 설정화면 크래시).
-- 리스크 사전은 codexstar69/bug-hunter triage.cjs(MIT)의 경로 휴리스틱을 이식. src/util/code-risk.ts 참고.

ALTER TABLE code_artifact_registry
  ADD COLUMN IF NOT EXISTS risk_tier  text,   -- 'critical'|'high'|'medium'|'low'
  ADD COLUMN IF NOT EXISTS risk_score integer; -- 정렬용 (critical=90 ... low=10)

CREATE INDEX IF NOT EXISTS idx_code_risk ON code_artifact_registry (risk_tier);
