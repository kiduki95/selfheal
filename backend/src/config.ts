// 중앙 설정 — 버전 문자열은 input_hash에 섞여 캐시 무효화를 좌우한다 (spec §4).
// stub→real 교체 시 이 버전을 bump하면 해당 stage 캐시가 자동 무효화된다.

export const EMBED_DIM = 1536; // spec §9 bake-off 전 잠정. migration의 vector(1536)과 일치해야 함.

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://ouroboros:ouroboros@localhost:5433/ouroboros',
  // stub=규칙기반(키0) · claude-cli=구독 Claude(headless, 추가과금0) · anthropic=API(충전식)
  llmClient: (process.env.LLM_CLIENT ?? 'stub') as 'stub' | 'claude-cli' | 'anthropic',
  embeddingClient: (process.env.EMBEDDING_CLIENT ?? 'local') as 'local' | 'cohere',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  cohereApiKey: process.env.COHERE_API_KEY,
  // 이 selfheal 인스턴스가 매핑 대상으로 삼는 product codebase (codeflow가 채운 repo).
  targetRepo: process.env.TARGET_REPO ?? 'tete-lab/automated-trading-system',
  // Auto-Dev coding-agent driver (layer 5). stub=LLM-free 결정론(키0) · claude-cli=구독 Claude(v2) ·
  // anthropic=Agent SDK(구독 소진 후). 기본 stub — makeLlmClient 패턴과 동일한 DI 스위치.
  agentDriver: (process.env.AGENT_DRIVER ?? 'stub') as 'stub' | 'claude-cli' | 'anthropic',
  // Landing-zone gate (code-health P3, Preparatory Refactoring): when a bug/feature lands on a toxic
  // module, Insight links a prerequisite refactor and Auto-Dev holds the proposal until that refactor
  // is in progress/done — order enforcement, not a permanent block. OFF for teams that won't refactor
  // legacy code. Default ON. (LANDING_ZONE_GATE=off|0|false to disable.)
  landingZoneGate: !['off', '0', 'false'].includes((process.env.LANDING_ZONE_GATE ?? 'on').toLowerCase()),
};

// per-component 버전 (spec §3 versions). 클라이언트 종류에 따라 동적으로 결정해
// "어떤 구현으로 만든 결과인지"가 캐시 키/감사 추적에 박히도록 한다.
export function pipelineVersions() {
  const llm = config.llmClient; // 'stub' | 'claude-cli' | 'anthropic'
  const emb = config.embeddingClient; // 'local' | 'cohere'
  // 버전 prefix가 input_hash에 섞여 캐시를 구분 — stub/구독/API 결과가 서로 섞이지 않게.
  const tag = llm === 'anthropic' ? 'sonnet-4.6' : llm === 'claude-cli' ? 'claude-cli' : 'stub';
  const trTag = llm === 'anthropic' ? 'haiku-4.5' : llm === 'claude-cli' ? 'claude-cli' : 'stub';
  return {
    pipeline: 'v0.5.0',
    pii: 'regex-v2+ner-stub-v1',
    translator: `${trTag}/translate-v1`,
    classifier: `${tag}/classify-v1`,
    extractor: `${tag}/extract-v1`,
    moderator: `${tag}/moderate-v1`,
    code_mapper: 'code-registry/v1',
    aggregator: 'signal-cluster/v1', // Phase 2 — 다음 레이어
    embedder: emb === 'cohere' ? 'cohere-embed-multilingual-v3/v1' : 'local-hash/v1',
  } as const;
}

// 유사도 임계값 (spec §4). §9 "유사도 임계 캘리브레이션"은 열린 항목 — 여기선 stage 순서상
// 충돌(dedup가 cache보다 먼저 발화)을 피하도록 보정: dedup_exact > semanticCache > near.
// (완전중복=거의 동일 → 저장 안 함, cache 재사용=같은 의미 → 저장하되 분류 재사용)
export const thresholds = {
  dedupExact: 0.985, // cosine ≥ → 완전 중복 (ProcessedReview 안 만듦)
  dedupNear: 0.9, // 0.90~0.985 → near-dup 힌트
  simhashHamming: 3, // SimHash Hamming ≤ → 어휘적 중복 후보
  semanticCache: 0.95, // 과거 분류 결과 재사용 (dedup 통과분 중)
  featureAuto: 0.9, // feature 매칭 auto_verified
  featurePending: 0.8, // 0.80~0.90 → pending_review
  codeMatch: 0.78, // affected_area ↔ code artifact
  // classify graduated escalation (spec §4.6)
  classifyAccept: 0.85, // ≥ → 채택
  classifyLowConf: 0.6, // 0.6~0.85 → low-confidence 플래그, < 0.6 → escalation
  // semanticCache poisoning 방어 (#7): 캐시 적재 자격
  cacheEligibleConf: 0.85,
  // P1 feature mapping: max candidates sent to the Claude judge. Bounds LLM payload regardless of
  // repo size — candidates are pre-ranked by embedding ANN (review ↔ feature) and capped at K.
  featureShortlistK: 30,
};
