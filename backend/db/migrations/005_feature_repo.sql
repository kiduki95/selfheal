-- feature_registry를 repo로 스코프 — 한 selfheal 인스턴스는 하나의 타깃 product codebase를 본다.
-- code-derived feature는 그 repo의 모듈에서 나오고, review-emergent gap도 그 타깃에 귀속.
ALTER TABLE feature_registry ADD COLUMN IF NOT EXISTS repo text;
CREATE INDEX IF NOT EXISTS idx_feature_repo ON feature_registry (repo);
