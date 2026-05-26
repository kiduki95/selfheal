# Processing Layer 스펙

> 버전: v0.5 (draft, **설계 동결**) · 대상 독자: Ingestion / Insight & Proposal Layer / Auto-Dev Layer 개발자
>
> v0.4 → v0.5 변경 요약은 [§14](#14-v04--v05-변경-요약) 참고. **이번 원칙**: "지금 안 잡으면 영영 복구 못 하는" 비가역적 데이터 캡처만 추가하고 로직은 defer. 새 stage 추가 없음, 대부분 필드/테이블/정책 수준. 이후 설계 동결 → Phase A(결정론 인프라) 구현으로.
>
> **시스템 단위 전환**: 이제 단위는 review가 아니라 `signal_group`(= incident). review는 incident에 붙는 evidence. incident는 생성/병합/분할/해소되는 생명주기를 갖는다.
>
> v0.3 → v0.4는 [§13](#13-v03--v04-변경-요약) · v0.2 → v0.3은 [§12](#12-v02--v03-변경-요약) · v0.1 → v0.2는 [§11](#11-v01--v02-변경-요약).

## 1. 목적과 책임

Processing Layer는 다양한 소스(App Store, Play Store, Slack, Reddit, ...)에서 들어온 raw review를, 다운스트림이 일관되게 소비할 수 있는 `ProcessedReview` 레코드로 변환한다.

### 1.1 차별화 — "분석"이 아니라 "코드 행동 신호"

> 상용 feedback aggregation 제품(Enterpret, Thematic, Dovetail…)은 전부 **analytics 제품**이다. 출력은 사람 PM이 읽는 대시보드. 우리(selfheal)의 출력은 대시보드가 아니라 **Auto-Dev 에이전트가 PR을 만들기 위해 먹는 신호**다. 이 한 가지가 Processing Layer가 추출해야 하는 것을 바꾼다.

따라서 우리는 "버그 카테고리입니다"에서 멈추지 않고 **코드로 행동 가능한 신호**까지 추출한다:
- **(A) 코드-grounded defect 추출** — 영향 컴포넌트 → repo 모듈/경로/오너, 에러 시그니처, 재현 단서, 회귀 버전.
- **(C) 증거 집계** — 단일 리뷰는 약한 신호. 동일 defect로 묶어 corroboration(N건·M버전·추세)을 부착해 행동 가능한 신호로 강화.

### 1.2 책임
- 소스별 raw payload → 정규화된 `ProcessedReview`
- 명백한 spam/노이즈/중복 제거 (LLM 비용 보호)
- PII 마스킹 (regex + NER)
- 언어 감지, (필요시) 번역
- 분류 / 감성 / 심각도 / 기능 / 엔티티 추출
- **(A) defect 추출 + 코드 아티팩트 매핑** ← v0.4
- **(C) signal group 배정 + corroboration rolling 집계** ← v0.4
- 임베딩 생성 및 저장
- **중간 단계(stage) 결과 보존** — 일부 component만 재처리 가능하도록
- 멱등성, 재시도, 관찰가능성 보장

### 1.3 책임이 아닌 것 (경계)
- 리뷰 수집 → Ingestion Layer
- **우선순위 / 제안 생성 / PR 사양 결정 → Insight & Proposal Layer**
- PR 생성 → Auto-Dev Layer
- ⚠️ 클러스터링 경계(v0.4): Processing은 **signal group 멤버십 배정 + rolling 집계**까지. *prioritization·proposal*은 Insight Layer. (즉 "누가 같은 문제인가"는 여기서, "무엇부터 고칠까"는 위에서)

위/아래 레이어는 두 컨트랙트(`RawReview`, `ProcessedReview`)에만 의존.

### 1.4 처리 플로우 (한눈에)

전처리의 본질은 **funnel** — 어디서 걸러지고, 어디서 사람/큰 모델로 빠지고, 어디서 통과하는가. 2-phase 구조:

```
                          ┌─────────────── PHASE 1: per-review (순수·캐시·materialized) ───────────────┐

 RawReview
    │
    ▼
 [prefilter] ───────────────▶ DROP  명백한 spam/노이즈                    (LLM 0)
    │ kept
    ▼
 normalize → detectLanguage → extractPII(regex+NER, redact)
    │
    ▼
 [dedup] ───────────────────▶ LINK→원본, DROP  완전중복                   (embed 0)
    │ unique                └▶ near-dup(0.90~0.95) = 클러스터 힌트만 부착
    ▼
 translate (lang≠en일 때만)
    │
    ▼
 [semanticCache] ───────────▶ REUSE  과거 분류 결과 재사용               (LLM 0) ──┐
    │ miss                                                                          │
    ▼                                                                               │
 classifyExtractModerate (Sonnet, 단일 호출)                                       │
    │   └ +defect 추출(A): error_signature / repro / 회귀버전 / 영향영역           │
    ├─ conf<0.6 ──────────────▶ Opus escalation                                    │
    ├─ critical/환불/반복 ─────▶ HUMAN QUEUE                                        │
    │ ok                                                                            │
    ▼                                                                               │
 extractFeatureIds (2-band) ─▶ 0.80~0.90 = HUMAN REVIEW                            │
    │ auto                                                                          │
    ▼                                                                               │
 mapCodeArtifacts (A) ───────  feature/영향영역 → repo 모듈·경로·오너              │
    │                                                                               │
    ▼                                                                               │
 embed ◀────────────────────────────────────────────────────────────────────────┘
    │
    └────────────────────────────────────────────────────────────────────────────┘

                          ┌─────────────── PHASE 2: cross-review (stateful·증분) ──────────────────────┐
    │
    ▼
 aggregateSignal (C) ──  embedding으로 signal_group 배정 + rolling 집계
    │                    (corroboration_count, affected_versions[], platforms[], trend, 회귀 감지)
    ▼
 persist ──▶ ProcessedReview (+ signal_group_id) ──▶ Insight & Proposal Layer ──▶ Auto-Dev
```

**funnel 직관**: 100건 유입 → prefilter/dedup/semanticCache가 LLM 비용을 깎고 → 실제 Sonnet 분류는 소수만 → 그 소수에서 코드-grounded defect를 뽑고 → Phase 2가 같은 defect끼리 묶어 증거를 누적. 단계별 통과율은 §8 funnel metric으로 관측.

**Phase 경계가 핵심**: Phase 1은 리뷰 1건의 순수 함수(캐시·부분 재처리 가능). Phase 2는 **여러 리뷰·시간축에 걸친 stateful 집계**라 순수 함수가 아니다 — group 집계가 source of truth이고, 리뷰별 `signal` 블록은 persist 시점 스냅샷일 뿐. downstream은 최신 수치를 group에서 읽는다.

---

## 2. 입력 컨트랙트: `RawReview`

```ts
interface RawReview {
  source: 'app_store' | 'play_store' | 'slack' | 'reddit' | string;
  source_id: string;              // 소스 내 unique ID — 멱등성 키
  text: string;                   // 원문 (최소 1자)
  title?: string;
  rating?: number;                // 1~5
  locale?: string;                // BCP 47
  author?: { id?: string; name?: string };
  app_version?: string;
  platform?: 'ios' | 'android' | 'web' | string;
  created_at: string;             // ISO 8601 — 작성 시각
  ingested_at: string;            // ISO 8601 — 수집 시각
  raw_payload: Record<string, unknown>;
}
```

**불변식**
- `(source, source_id)` 시스템 전체에서 유일
- `text` 비어있지 않음 (빈 리뷰는 Ingestion에서 거름)
- `created_at <= ingested_at`

---

## 3. 출력 컨트랙트: `ProcessedReview`

**Fact / Inference 분리**가 핵심 변경. fact는 소스에서 결정된 사실(재처리해도 안 변함), inference는 모델 결과(재처리로 갱신 가능). per-component 버전을 분리해 부분 재처리를 가능하게 함.

```ts
interface ProcessedReview {
  id: string;                            // UUID v7
  source: string;
  source_id: string;
  raw_review_id: string;

  // === FACTS — 결정론적, 재처리 불변 ===
  facts: {
    text_original: string;
    text_normalized: string;             // NFC + 공백/제어문자 정리
    text_redacted: string;               // PII 마스킹 후 — 모든 downstream LLM/embed 입력
    language: string;                    // ISO 639-1, 'unknown' 가능
    language_confidence: number;
    rating: number | null;
    app_version: string | null;
    platform: string | null;
    locale: string | null;
    created_at: string;                  // 원본 작성 시각
  };

  // === INFERENCES — 모델 결과, 재처리 가능 ===
  inferences: {
    text_en: string | null;              // 영어 번역 (language !== 'en'일 때)

    classification: {
      category: 'bug' | 'feature_request' | 'praise' | 'complaint' | 'question' | 'other';
      category_confidence: number;       // 0~1
      sentiment: 'positive' | 'neutral' | 'negative';
      sentiment_score: number;           // -1 ~ +1
      severity: 'low' | 'medium' | 'high' | 'critical';
      // v0.5(#5): negative evidence 캡처 — "이제 잘 돼요/고쳐짐" 신호. 해소 로직은 후속이지만
      // 신호 자체를 지금부터 버리지 않고 잡아둔다 (안 그러면 signal_group이 영원히 산다).
      is_resolution_report: boolean;     // 과거 문제의 해소를 보고하는 리뷰인가
    };

    extraction: {
      feature_ids: string[];             // feature_registry FK (canonical, verified 매칭만)
      // 2-band 매칭 결과 — auto-attach(>=0.90)는 feature_ids로, 0.80~0.90은 human 큐로
      feature_matches: {
        feature_id: string;
        score: number;                   // cosine 유사도
        status: 'auto_verified' | 'pending_review' | 'rejected';
      }[];
      raw_feature_mentions: string[];    // LLM이 추출한 원문 (canonicalization 추적용)
      entities: { type: string; value: string }[];
    };

    moderation: {
      is_spam: boolean;
      spam_score: number;                // 0~1
      pii_redacted: boolean;             // PII가 발견되어 마스킹됐는지
      pii_types: string[];               // 마스킹된 PII 유형 (compliance 감사용)
      quality_score: number;             // 0~1 — downstream 가중치
    };

    // === (A) 코드-grounded defect — category가 bug일 때만 (Auto-Dev 입력) ===
    defect: {
      affected_area: string | null;      // 자연어 영역 ("결제 화면 결제 버튼")
      // v0.5(#4): bare id 배열 금지 — downstream이 "매핑=진실"로 오신뢰. provenance 필수.
      artifact_matches: {
        artifact_id: string;             // code_artifact_registry FK
        score: number;                   // 0~1
        source: 'feature_link' | 'semantic_match' | 'historical_signature';
        reason: string | null;           // 매칭 근거 (디버깅/검토용)
      }[];
      // v0.5(#3): bare string 금지 — NPE/NullPointerException/nil 동일 처리 위해 계층 구조
      error_signature: {
        raw: string;                     // 원문 그대로
        canonical: string | null;        // 정규화 (정규화 엔진은 후속 — 지금은 null 허용)
        family: string | null;           // 'null_deref' | 'http_5xx' 등 패밀리 (후속)
        stacktrace_fingerprint: string | null;
      } | null;
      reproduction_steps: string[];      // 있으면 추출
      expected_behavior: string | null;
      actual_behavior: string | null;
      // v0.5(#6): "version" 아니라 "hint" — 리뷰는 sparse/delayed라 first_seen≠도입버전.
      // 제대로 된 attribution은 release/deploy 스트림 join 필요 (§9 open).
      regression_version_hint: string | null;
    } | null;

    // === (C) 증거 집계 — persist 시점 스냅샷 (최신값은 signal_groups가 source of truth) ===
    signal: {
      signal_group_id: string;           // 동일 defect로 묶인 그룹
      corroboration_count: number;       // 그룹 내 리뷰 수 (스냅샷)
      affected_versions: string[];
      affected_platforms: string[];
      trend: 'new' | 'rising' | 'stable' | 'declining';
      first_seen: string;
      last_seen: string;
    } | null;

    // derived (저장 시 계산):
    //   classification.category in {bug, feature_request} && !moderation.is_spam
    is_actionable: boolean;
  };

  // === VERSIONING — per-component (fine-grained reprocess) ===
  versions: {
    pipeline: string;                    // 'v0.4.0' — 스키마/구조 호환성
    pii: string;                         // 'regex-v2+ner-v1' — regex + NER 백스톱 하이브리드
    translator: string;                  // 'haiku-4.5/prompt-v1'
    classifier: string;                  // 'sonnet-4.6/classify-v1' (defect 추출 포함)
    extractor: string;                   // 'sonnet-4.6/extract-v1'
    moderator: string;                   // 'sonnet-4.6/moderate-v1' (또는 'heuristic/v1')
    code_mapper: string;                 // 'code-registry/v1' — defect → repo 아티팩트 매핑
    aggregator: string;                  // 'signal-cluster/v1' — signal group 배정 정책
    embedder: string;                    // 'cohere-embed-multilingual-v3/v1' (§9 bake-off로 확정)
  };

  processed_at: string;
  llm_calls: LlmCallRecord[];
}

interface LlmCallRecord {
  stage: 'translate' | 'classify_extract_moderate' | 'embed' | 'prefilter_escalation';
  model: string;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  duration_ms: number;
}
```

**불변식**
- `inferences`의 모든 필드는 `versions.{...}`로 재계산 가능. 어느 component만 invalidate해도 부분 재처리.
- `is_actionable === (classification.category in {bug, feature_request} && !moderation.is_spam)` — generated column으로 저장(인덱스용).
- `facts.text_redacted`는 모든 LLM/embed 입력의 기반. raw `text_normalized`는 DB에만 보존하고 vector DB로 절대 안 나감.

---

## 4. 파이프라인 단계

**Phase 1 (4.0~4.8: per-review)** stage는 **순수 함수** 시그니처 — 리뷰 1건만의 함수라 캐시·부분 재처리 가능. DB/LLM은 명시적 DI.
**Phase 2 (4.8b aggregateSignal: cross-review)** 는 여러 리뷰·시간축에 걸친 **stateful 집계**라 순수 함수가 아니다(§1.4 경계 참고).

```ts
type Stage<In, Out> = (input: In, ctx: PipelineCtx) => Promise<StageResult<Out>>;

interface StageResult<T> {
  raw_review_id: string;
  stage_name: string;
  stage_version: string;
  input_hash: string;                    // hash(input_payload + stage_version + prompt_version)
  output: T;
  llm_call?: LlmCallRecord;
  duration_ms: number;
}
```

각 stage 결과는 `review_stage_outputs`에 저장되어 **다음 stage의 입력 + 부분 재처리 시 캐시 소스**가 된다.

**version-aware 캐시 (v0.3)**: `input_hash`는 입력 payload뿐 아니라 **stage/prompt 버전을 함께 해싱**한다 (Dagster의 `data version = hash(code_version + upstream)` 패턴). 따라서 prompt/모델 버전을 bump하면 해당 stage 캐시가 자동 무효화되고, 그 출력을 입력으로 받는 downstream stage들도 input_hash가 달라져 **transitive하게** 재처리된다 → 깨끗한 부분 backfill.

### 4.0 `prefilter` — deterministic + (옵션) cheap LLM
- **목적**: LLM 호출 전에 명백한 spam/노이즈를 제거 → 비용 보호
- **input**: `RawReview`
- **output**: `{ kept: boolean; reason?: string; spam_score?: number }`
- **방법**
  - 길이 휴리스틱 (1자 미만 / 너무 김)
  - 반복 문자 / URL 폭격 / 비속어 폭격 regex
  - per-author rate limit (동일 author 단시간 다발 post)
  - (옵션) 의심 케이스만 Haiku 1줄 prompt로 escalation
- **fallback**: 의심스러우면 `kept=true` (false positive 방지 — 비용보다 누락이 더 비쌈)

### 4.1 `normalize` — deterministic
- **input**: `RawReview`
- **output**: `{ text_normalized: string }`
- 유니코드 NFC, 공백/줄바꿈 정리, zero-width 제거
- LLM 호출 없음

### 4.2 `detectLanguage` — deterministic
- **input**: `{ text_normalized }`
- **output**: `{ language, language_confidence }`
- `franc` / `cld3` 같은 결정론적 detector
- 실패 시 `{ language: 'unknown', confidence: 0 }`

### 4.3 `extractPII` — hybrid regex + NER (v0.3 확장)
- **input**: `{ text_normalized }`
- **output**: `{ text_redacted: string; pii_found: { type: string; count: number }[] }`
- **2-pass 구조** (Presidio/GLiNER 패턴): regex가 *구조적* PII를 결정론적·sub-ms로 잡고, NER이 *비구조적* PII를 backstop.
- **Pass 1 — regex (구조적, checksum)**
  - URL → `<URL>`
  - EMAIL → `<EMAIL>`
  - PHONE (한/미/EU 패턴) → `<PHONE>`
  - 카드번호 (16자리 + Luhn) → `<CARD>`
  - 한국 주민등록번호 패턴 → `<RRN>`
  - 주문번호 (앱별 prefix 패턴, 설정 가능) → `<ORDER>`
- **Pass 2 — NER backstop (비구조적)** ← v0.3 신규
  - PERSON / NAME → `<PERSON>` (regex로 못 잡는 가장 흔한 식별자)
  - ADDRESS → `<ADDR>` (휴리스틱 + NER, 보수적 — false positive 감수)
  - 경량 로컬 NER (Presidio + spaCy, 또는 GLiNER zero-shot). LLM 호출 없음.
- **중요**: `text_redacted`가 이후 모든 LLM stage / embed의 입력. 원본 텍스트는 vector DB로 나가지 않는다 (compliance). 마스킹된 유형은 `inferences.moderation.pii_types`에 기록 (감사 추적).

### 4.4 `dedup` — 2-source candidate + cosine 검증 (v0.3 확장)
- **input**: `{ text_redacted }` (+ embed 이후 재방문 시 vector)
- **output**: `{ is_duplicate: boolean; duplicate_of?: string; near_duplicates: string[]; band: 'exact'|'near'|'none' }`
- **후보 생성 (둘 다)**
  - **(a) SimHash** — 어휘적 정확/근사 중복. pgvector ≥0.7.0 `bit` 벡터 + `hamming_distance`로 in-DB 검색 (Google 기준 Hamming ≤ 3).
  - **(b) 임베딩 ANN top-k** ← v0.3 신규. SimHash는 어휘적이라 **paraphrase/번역 중복을 후보로조차 못 잡는다.** cosine top-k 이웃도 후보로 추가해 의미 중복을 잡는다. (활성/미해결 레코드로만 범위 한정 — 이미 dup/promote된 건 제외)
- **검증 (2-band)**
  - cosine ≥ **0.95** → `is_duplicate=true` (strict 진짜 중복)
  - **0.90 ≤ cosine < 0.95** → `near_duplicate` (dedup하지 않고 Insight Layer 클러스터링 힌트로 표시)
- **정책**: `is_duplicate=true`이면 ProcessedReview는 만들지 않음. `raw_reviews.duplicate_of = $original_id` 기록 + classify/embed skip.
- ⚠️ KO↔EN cross-lingual cosine은 same-language보다 낮게 나오므로 임계값은 §9 bake-off에서 언어별/교차언어별로 캘리브레이션.

### 4.5 `translate` — LLM, conditional
- **input**: `{ text_redacted, language }`
- **output**: `{ text_en: string | null }`
- 조건: `language !== 'en'`
- 모델: **Haiku 4.5** (`claude-haiku-4-5-20251001`)
- prompt caching: 시스템 프롬프트 ephemeral

### 4.5b `semanticCache` — deterministic lookup (v0.3 신규)
- **목적**: classify LLM 호출 *전*에 의미적으로 동일한 과거 처리 결과를 재사용 → 최고 ROI 비용 절감. 리뷰 트래픽은 반복적("앱 자꾸 튕겨요" 등)이라 적중률이 높다.
- **input**: `{ text_redacted, text_en }` (PII 제거 텍스트만)
- **output**: `{ hit: boolean; cached_inferences?: Inferences }`
- **방법**: redacted 텍스트의 embedding으로 과거 ProcessedReview에 cosine ≥ 0.97 매칭 시 inferences 재사용 (classifier 버전 동일할 때만). miss면 4.6으로 진행.
- LLM 호출 없음. `is_duplicate`(4.4)와는 구분 — 여기선 별개 리뷰지만 분류 결과를 재사용.
- **poisoning 방어** (v0.5, #7): 잘못된 초기 분류가 캐시로 증폭(question→bug 오분류가 유사 리뷰에 전파)되는 걸 막는다.
  - **캐시 적재 자격**: `category_confidence ≥ 0.85` && escalation 없이 통과한 결과만 캐시 소스로 사용 (low-conf/escalated 결과는 재사용 금지).
  - **TTL**: 캐시 엔트리에 만료. classifier_version bump 시 전체 무효(이미 version 바인딩).
  - **sampled revalidation**: hit의 일부(예: 1~5%)는 무시하고 실제 classify 후 결과 비교 → 캐시 정확도 metric화, 괴리 시 알림.

### 4.6 `classifyExtractModerate` — LLM, single call / 3 logical results
- **input**: `{ text_redacted, text_en, rating, app_version }`
- **output**: `{ classification; extraction; moderation; defect }`
- **API 호출**: 단일 (Sonnet 4.6, tool use로 structured output 강제) — 비용/지연 최소
- **category enum 강제** (v0.3): tool schema에서 category를 고정 enum으로 제약 → 열린 LLM 분류의 label drift 방지 (Zendesk/Gorgias 큐레이트 intent 패턴).
- **defect 추출** (v0.4, A): `category=bug`이면 같은 tool 호출에서 `affected_area / error_signature / reproduction_steps / expected_behavior / actual_behavior / regression_version_hint`를 함께 추출 (추가 LLM 호출 없음 — tool schema 확장). `error_signature`는 정규화해 Phase 2 그룹핑 키로도 사용.
- **내부 분리**: 응답을 3개 result type으로 split해서 stage_outputs에 **별도 row로 저장** → tool spec 일부만 바뀔 때 영향 추적 + 후에 호출 분리도 쉬움
- **Batch API** 우선 (50% 할인, 24h SLA) — extractor/moderator도 동일 batch에 포함
- **Graduated escalation** (v0.3, 단일 0.6 컷오프 대체): action별로 confidence bar를 분리.
  - `category_confidence ≥ 0.85` → 그대로 채택
  - `0.6 ≤ confidence < 0.85` → 채택하되 low-confidence 플래그 (analytics에서 격리, §8)
  - `confidence < 0.6` → **Opus 4.7** 재호출 후 갱신, `versions.classifier`에 escalation 표기
- **비-confidence escalation 트리거** (v0.3): confidence 무관하게 **사람 검토 큐로** 보냄 — `severity=critical`, 법률/환불/안전 키워드("legal", "refund", "환불", "lawsuit"), 동일 author 반복 루프. (Fin 패턴)

### 4.7 `extractFeatureIds` — deterministic + vector lookup (v0.3: 2-band)
- **input**: `{ raw_feature_mentions: string[] }` (4.6 결과)
- **output**: `{ feature_matches: { feature_id; score; status }[]; unmatched: string[] }`
- **매칭 순서**
  1. `feature_registry.altLabel`(alias)와 exact match (대소문자/공백 정규화 후) → `auto_verified`
  2. embedding 유사도로 **2-band 판정** (단일 0.85 컷오프 대체):
     - **≥ 0.90** → `auto_verified` (feature_ids에 반영)
     - **0.80 ≤ score < 0.90** → `pending_review` (사람 검토 큐, 자동 반영 안 함)
     - **< 0.80** → 매칭 실패
  3. 매칭 실패분은 `unmatched_feature_candidates`에 누적
- **검증 state machine** (Productboard 패턴): `pending_review` → 운영자가 `verified` | `rejected`. reject은 negative signal로 보존.
- LLM 호출 없음 (이미 embed된 registry vector만 사용)
- ⚠️ 단일 0.85는 "battery life" vs "charging speed" 같은 인접 feature를 잘못 병합할 위험 → 2-band로 false merge·vocab bloat 동시 감소.

### 4.7b `mapCodeArtifacts` — deterministic + vector lookup (v0.4 신규, A)
- **목적**: defect를 **실제 코드 위치에 grounding**. Auto-Dev 에이전트가 "어디를 고칠지" 출발점.
- **input**: `{ feature_ids, defect.affected_area, defect.error_signature }`
- **output**: `{ code_artifact_ids: string[]; owners: string[]; confidence: number }`
- **매칭 순서**
  1. `feature_id` → `code_artifact_registry`의 직접 링크 (feature ↔ 코드 모듈 매핑이 등록돼 있으면)
  2. `affected_area` 임베딩 ↔ code_artifact_registry 임베딩 유사도 (모듈 설명/경로/심볼 임베딩)
  3. `error_signature` ↔ 과거 동일 시그니처가 매핑된 아티팩트 (재발 버그의 코드 위치 재사용)
- **registry 시드**: 대상 repo 구조 + `CODEOWNERS` + (선택) 심볼 인덱스에서 생성. selfheal은 특정 제품 코드베이스를 고치므로 이 매핑이 가능.
- LLM 호출 없음. 매칭 실패 시 `code_artifact_ids=[]` + affected_area만 보존(Insight/Auto-Dev가 사람 라우팅).

### 4.8b `aggregateSignal` — DB + vector (Phase 2) · **inline은 멍청하게, 똑똑함은 비동기로** (v0.5 재설계, #2)
- **목적**: 단일 리뷰(약한 신호)를 동일 defect로 묶어 **corroboration**를 누적. dedup이 "같은 글"을 지우는 거라면, 여기선 "같은 문제"를 모은다.
- **왜 분리?**: 핫패스에서 정교한 online clustering을 하면 **chaining collapse**(A~B~C~D → 거대 단일 그룹)와 centroid drift에 직격당한다. 그래서 inline 배정은 **보수적·provisional**로 두고, merge/split/recompute는 별도 reconciliation job이 한다.
- **input**: `{ embedding, error_signature.canonical, code_artifact_ids, app_version, platform, created_at }`
- **(1) inline 배정 (provisional)**
  - `error_signature.canonical` 일치 → 강한 동일 그룹 신호 (가장 신뢰)
  - 아니면 **그룹 representative(medoid)와 직접** cosine ≥ 0.88 **그리고 max-radius 제약** 내일 때만 배정 (centroid 평균이 아니라 representative 기준 = complete-linkage 근사 → drift/collapse 완화). 없으면 새 그룹.
  - 그룹 범위는 `code_artifact_ids` 교집합으로 제약 (의미 비슷해도 다른 모듈이면 분리).
  - 애매하면 **새 그룹**으로 (잘못 붙이는 것보다 나중에 merge가 안전).
- **(2) rolling 집계** (그룹 row 갱신): count는 멤버 수에서 파생, versions/platforms 합집합, `trend` 재계산, `regression_version_hint` 보강.
- **(3) async reconciliation job** (별도, stub): 주기적으로 그룹 purity 점검 → **merge/split/representative 재선정/regression 재계산**. 모든 변경은 audit event로 기록(§5 `signal_group_events`). ← 로직은 후속, 인터페이스/이벤트만 v0.5에 고정.
- **stateful**: 순수 함수 아님. 동시성은 그룹 row advisory lock 또는 upsert로 직렬화. 리뷰별 `signal` 블록은 이 시점 스냅샷.

### 4.8 `embed` — external API
- **input**: `text_redacted` — **원문(PII 제거)을 그대로 임베딩** (v0.3 결정, §9). translate-first/concat은 이득 근거 없이 MT 에러·편향만 추가하므로 강한 multilingual 모델로 원문을 임베딩한다.
- **output**: `{ vector: number[]; model: string; dim: number }`
- 모델: §9 bake-off로 확정 (Cohere embed-multilingual-v3 기본, voyage-3-large/e5-ko challenger). **차원이 모델마다 다름** → `vector(N)` 확정 전제.
- 재시도: exp backoff 3회

### 4.9 `persist` — DB
- **input**: ProcessedReview + vector + stage_outputs + signal_group 갱신
- **output**: `void`
- **트랜잭션**: `processed_reviews` upsert + `review_embeddings` upsert + `signal_groups` upsert(Phase 2 결과) + 모든 stage 결과 `review_stage_outputs` upsert를 한 tx로
- 멱등성: `(source, source_id)` unique + `ON CONFLICT DO UPDATE`. 재처리 시 signal_group 집계 **중복 가산 방지** — 멤버십을 review→group 매핑으로 관리하고 count는 멤버 수에서 파생(가산 누적 아님).

---

## 5. 데이터 모델 (Postgres + pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 원본 보존 + 처리 상태 추적
CREATE TABLE raw_reviews (
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

  UNIQUE (source, source_id)
);
CREATE INDEX ON raw_reviews (processed_at)
  WHERE processed_at IS NULL AND NOT is_filtered AND duplicate_of IS NULL;

-- 중간 stage 결과 보존 — 부분 재처리 가능
CREATE TABLE review_stage_outputs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_review_id   uuid NOT NULL REFERENCES raw_reviews(id) ON DELETE CASCADE,
  stage_name      text NOT NULL,             -- 'normalize'|'detectLanguage'|'extractPII'|'dedup'|'translate'|'classify'|'extract'|'moderate'|'embed'
  stage_version   text NOT NULL,             -- 'haiku-4.5/prompt-v1', 'regex-pii/v2' 등
  input_hash      text NOT NULL,             -- 같은 input + version → cache hit
  output          jsonb NOT NULL,
  llm_call        jsonb,                     -- LlmCallRecord
  duration_ms     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (raw_review_id, stage_name, stage_version)
);
CREATE INDEX ON review_stage_outputs (raw_review_id, stage_name);
CREATE INDEX ON review_stage_outputs (stage_name, stage_version);

-- 최종 처리 결과 (facts/inferences/versions를 jsonb로 분리)
CREATE TABLE processed_reviews (
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
  created_at            timestamptz GENERATED ALWAYS AS ((facts->>'created_at')::timestamptz) STORED,
  -- v0.4: 코드/신호 그룹 promote
  signal_group_id       uuid    GENERATED ALWAYS AS ((inferences->'signal'->>'signal_group_id')::uuid) STORED,
  error_sig_canonical   text    GENERATED ALWAYS AS (inferences->'defect'->'error_signature'->>'canonical') STORED,

  processed_at          timestamptz NOT NULL DEFAULT now(),
  llm_calls             jsonb NOT NULL DEFAULT '[]',

  UNIQUE (source, source_id)
);
CREATE INDEX idx_pr_actionable     ON processed_reviews (created_at DESC) WHERE is_actionable;
CREATE INDEX idx_pr_category       ON processed_reviews (category);
CREATE INDEX idx_pr_classifier_ver ON processed_reviews (classifier_version);
CREATE INDEX idx_pr_embedder_ver   ON processed_reviews (embedder_version);
CREATE INDEX idx_pr_features_gin   ON processed_reviews USING gin ((inferences->'extraction'->'feature_ids'));
CREATE INDEX idx_pr_signal_group   ON processed_reviews (signal_group_id);
CREATE INDEX idx_pr_code_gin       ON processed_reviews USING gin ((inferences->'defect'->'code_artifact_ids'));

-- 임베딩 분리 (메타 조회 가벼움)
CREATE TABLE review_embeddings (
  processed_review_id  uuid PRIMARY KEY REFERENCES processed_reviews(id) ON DELETE CASCADE,
  embedding            vector(1536) NOT NULL,
  model                text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
-- HNSW (v0.3): 리뷰는 insert-heavy/성장형 → ivfflat은 build 시점 클러스터링이라 recall이
-- 조용히 저하되고 주기적 REINDEX 필요. HNSW는 graph가 insert를 흡수.
CREATE INDEX ON review_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Feature canonical registry — vocabulary explosion 방지 (v0.3: SKOS 모델)
-- 1 concept = pref_label(prefLabel) + alt_labels(altLabel, KO/EN 표면형) + parent(broader/narrower)
CREATE TABLE feature_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_slug  text NOT NULL UNIQUE,      -- 'login', 'push_notifications'
  pref_label      text NOT NULL,             -- SKOS prefLabel — 대표 표시명
  alt_labels      text[] NOT NULL DEFAULT '{}',  -- SKOS altLabel: ['log-in','signin','로그인','로그인하기']
  description     text,                       -- 자연어 정의 — embedding 생성 + LLM 매칭 disambiguation에 사용 (Dovetail 패턴)
  embedding       vector(1536),              -- description+labels 기반, 유사기능 매칭용 (차원은 §9 확정)
  parent_id       uuid REFERENCES feature_registry(id),  -- SKOS broader: 'oauth_login' parent='login'
  merged_into     uuid REFERENCES feature_registry(id),  -- merge 시 ID 승계 (trend 연속성 보존, 불변식)
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON feature_registry USING gin (alt_labels);
CREATE INDEX ON feature_registry USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- (A) 코드 아티팩트 레지스트리 — defect를 repo 위치에 grounding (v0.4)
-- repo 구조 + CODEOWNERS + (선택)심볼 인덱스에서 시드
CREATE TABLE code_artifact_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo            text NOT NULL,             -- 'org/app-ios'
  path            text NOT NULL,             -- 'Sources/Payment/PaymentView.swift'
  module          text,                      -- 'Payment'
  symbol          text,                      -- (선택) 'PaymentView.submit()'
  owners          text[] NOT NULL DEFAULT '{}',  -- CODEOWNERS 팀/사람
  feature_ids     uuid[] NOT NULL DEFAULT '{}',  -- feature_registry 역링크 (feature ↔ 코드)
  description     text,                      -- 모듈 책임 설명 (매칭 임베딩 소스)
  embedding       vector(1536),              -- path+module+symbol+description 기반
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo, path, symbol)
);
CREATE INDEX ON code_artifact_registry USING gin (feature_ids);
CREATE INDEX ON code_artifact_registry USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- (C) signal group — 동일 defect로 묶인 증거 집계의 source of truth (v0.4, Phase 2)
CREATE TABLE signal_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_review_id uuid REFERENCES processed_reviews(id),  -- medoid, 배정 기준 (v0.5: centroid 아님)
  representative_embedding vector(1536),         -- representative의 임베딩 (배정 거리 계산)
  centroid            vector(1536),              -- purity metric 용 (배정엔 안 씀)
  max_radius          real,                      -- complete-linkage 근사: 멤버 최대 거리 제약
  error_signature     text,                      -- canonical 시그니처 (강한 그룹 키)
  code_artifact_ids   uuid[] NOT NULL DEFAULT '{}',

  -- rolling 집계 (aggregateSignal이 갱신)
  corroboration_count integer NOT NULL DEFAULT 1,
  affected_versions   text[] NOT NULL DEFAULT '{}',
  affected_platforms  text[] NOT NULL DEFAULT '{}',
  regression_version_hint text,                  -- #6: hint일 뿐 — release 스트림 join 전엔 약함
  trend               text NOT NULL DEFAULT 'new',  -- 'new'|'rising'|'stable'|'declining'
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now(),

  -- #5: resolution / negative evidence
  resolution_count    integer NOT NULL DEFAULT 0,    -- "고쳐짐/이제 돼요" 신호 누적
  resolved_at         timestamptz,
  status              text NOT NULL DEFAULT 'open',  -- 'open'|'handed_off'|'resolving'|'resolved'  (Insight/Auto-Dev/resolution이 전이)
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON signal_groups USING hnsw (representative_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
CREATE INDEX ON signal_groups (corroboration_count DESC) WHERE status = 'open';
CREATE INDEX ON signal_groups (error_signature);

-- #5: resolution evidence — signal_group이 영원히 사는 것 방지. 로직은 후속, 캡처는 지금.
CREATE TABLE resolution_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id     uuid NOT NULL REFERENCES signal_groups(id) ON DELETE CASCADE,
  processed_review_id uuid NOT NULL REFERENCES processed_reviews(id),
  app_version         text,                      -- 해소가 보고된 버전 (post-release sentiment shift 단서)
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON resolution_signals (signal_group_id);

-- #1: audit event 로그 — state는 truth, event는 history (full event-sourcing 아님).
-- "왜 이 group/feature/mapping이 이렇게 됐나"를 사후 추적. 캡처만, replay 로직은 후속.
CREATE TABLE signal_group_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id uuid NOT NULL,                 -- (FK 생략 — split/merge로 사라진 group도 history 보존)
  event_type    text NOT NULL,                   -- 'CREATED'|'MEMBER_ADDED'|'MERGED'|'SPLIT'|'MEMBER_REASSIGNED'|'REGRESSION_RECALCULATED'|'STATUS_CHANGED'|'RESOLVED'
  payload       jsonb NOT NULL,                  -- {from, to, member_id, reason, actor, ...}
  actor         text NOT NULL,                   -- 'aggregateSignal'|'reconciliation'|'operator:<id>'
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON signal_group_events (signal_group_id, created_at);

CREATE TABLE feature_registry_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id    uuid NOT NULL,
  event_type    text NOT NULL,                   -- 'CREATED'|'ALIAS_ADDED'|'MERGED'|'PROMOTED'|'DEACTIVATED'
  payload       jsonb NOT NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON feature_registry_events (feature_id, created_at);

CREATE TABLE artifact_mapping_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_group_id uuid,
  artifact_id   uuid NOT NULL,
  event_type    text NOT NULL,                   -- 'MAPPED'|'REMAPPED'|'UNMAPPED'|'CONFIRMED'|'REJECTED'
  payload       jsonb NOT NULL,                  -- {score, source, reason, actor}
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON artifact_mapping_events (artifact_id, created_at);

-- 매칭 안 된 후보 — 주기적으로 운영자가 promote/reject
CREATE TABLE unmatched_feature_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_mention         text NOT NULL,
  normalized          text NOT NULL,
  embedding           vector(1536),
  cluster_id          uuid,                 -- v0.3: 검토 전 클러스터링 — 운영자가 그룹 단위로 promote
  occurrence_count    integer NOT NULL DEFAULT 1,
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now(),
  example_review_ids  uuid[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'pending',  -- 'pending'|'merged'|'rejected'|'promoted'
  UNIQUE (normalized)
);
-- promote 정책 (v0.3): 단건 검토 대신 cluster_id로 묶어 검토 + 재발 빈도/기간 임계 초과 시 promote.
-- promote 시 클러스터 표면형을 새 concept의 alt_labels로 자동 흡수. unmatched 급증 = 미canonical feature 조기경보(§8).

-- HITL 스텁 — 로직은 v0.2+에서, 스키마는 v0.1부터 (백필 회피)
CREATE TABLE review_annotations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processed_review_id   uuid NOT NULL REFERENCES processed_reviews(id) ON DELETE CASCADE,
  field_path            text NOT NULL,       -- 'inferences.classification.category' 등
  original_value        jsonb NOT NULL,
  corrected_value       jsonb NOT NULL,
  annotator             text NOT NULL,
  reason                text,
  annotated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON review_annotations (processed_review_id);
CREATE INDEX ON review_annotations (annotated_at DESC);

-- Golden dataset — annotation 누적 → 평가셋
CREATE TABLE golden_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_review_id       uuid NOT NULL REFERENCES raw_reviews(id),
  expected_facts      jsonb NOT NULL,
  expected_inferences jsonb NOT NULL,
  tags                text[] NOT NULL DEFAULT '{}',     -- 'multilingual', 'edge_case_spam' 등
  curator             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

> `vector(1536)`은 임베딩 모델 결정(§9) 후 확정. 차원이 모델마다 다르면 `review_embeddings`를 모델별 partitioned table로 운용.

---

## 6. 에러 처리 & 재시도

| 단계 | 실패 정책 |
|---|---|
| prefilter | 실패 시 `kept=true` (false positive 회피) |
| normalize | 결정론적. 실패 시 코드 버그 → throw + DLQ |
| detectLanguage | 실패 시 `language='unknown'`로 진행 |
| extractPII (regex) | 실패 시 `text_redacted = text_normalized` + 경고. metric에 기록 (compliance 추적). 영구 실패는 raw_review를 처리하지 않고 skip. |
| extractPII (NER) | NER 실패는 regex 결과로 진행(degrade) + 경고 metric. compliance상 NER 누락은 추적 대상. |
| dedup | 실패 시 `is_duplicate=false`로 진행 (best-effort) |
| translate | exp backoff 3회. 실패 시 `text_en=null`로 진행 |
| semanticCache | 실패 시 `hit=false`로 간주하고 classify로 진행 (best-effort, 비용만 손해) |
| classifyExtractModerate | exp backoff 3회. 실패 시 `processing_error` 기록 + `retry_count++` → DLQ |
| extractFeatureIds | 실패 시 `feature_ids=[]`, `raw_feature_mentions`만 보존 |
| embed | exp backoff 3회. 실패 시 ProcessedReview는 저장하되 embedding은 비움 + 재시도 큐 |
| persist | tx 롤백 + `processing_error` |

**Reprocess granularity** — stage materialization의 가장 큰 가치:

```sql
-- 예 1: classifier prompt만 v2로 교체했을 때
SELECT raw_review_id FROM processed_reviews
WHERE classifier_version != 'sonnet-4.6/classify-v2';
-- 이 review들만 classify stage부터 다시 (normalize/translate/embed는 캐시 hit)

-- 예 2: 임베딩 모델만 교체
SELECT raw_review_id FROM processed_reviews
WHERE embedder_version != 'voyage-3/v1';
-- embed stage만 다시
```

**전체 마이그레이션**은 `versions.pipeline` bump + 백그라운드 잡으로 진행.

---

## 7. LLM 호출 전략

- **Batch API**: `classifyExtractModerate`(+ extractor/moderator)는 기본 batch. 보통 <1h, 하드 24h SLA → 비동기 리뷰 처리에 적합(§9 확인). 50% 할인이 cache-read(~90% off)와 복합되면 캐시된 토큰에 ~95% 할인.
- **Prompt caching**: 시스템 프롬프트 + 카테고리 정의 + few-shot 예시는 `cache_control: ephemeral`. 프롬프트는 **static-prefix-first**(고정부 먼저, per-review 가변부 나중)로 캐시 가능 prefix 최대화.
  - ⚠️ `cache_control` breakpoint 오배치 시 **조용히 full-price**로 degrade → cache hit를 **1급 metric**으로 측정·알림 (§8).
- **모델 선택**
  - prefilter escalation (선택) → **Haiku 4.5** (`claude-haiku-4-5-20251001`)
  - translate → **Haiku 4.5**
  - classifyExtractModerate → **Sonnet 4.6** (`claude-sonnet-4-6`)
  - escalation (낮은 confidence) → **Opus 4.7** (`claude-opus-4-7`)
  - embed → **Cohere embed-multilingual-v3** 기본 (§9 bake-off 확정 전 잠정)
- **Structured output**: tool use(`extract_review_signals` tool spec)로 JSON 스키마 강제 (category는 enum). tool use는 *모양*만 보장 → 경량 post-validation(zod) + bounded retry 유지.
- **Token observability**: `llm_calls`에 단계별 `tokens_in / tokens_out / cached_tokens / cache_creation_tokens / duration_ms` 누적. cache hit rate 회귀 알림.
- **재시도 구분**: transient 실패 → 캐시 재사용. validation 실패(스키마 위반) → 재시도 키에 attempt/error hash를 섞어 **재생성 강제** (idempotency는 워크플로 속성).

---

## 8. 관찰가능성

### 비용 / 처리량 metric (기존)
- `pipeline.stage.{prefilter|normalize|detect|pii|dedup|translate|classify|extract|moderate|embed|persist}.duration_ms` (histogram)
- `pipeline.stage.*.error_count` (counter)
- `pipeline.cost.tokens_in / tokens_out / cached_tokens` (counter)
- `pipeline.batch.queue_depth` (gauge)
- `pipeline.throughput.reviews_per_min` (gauge)

### 데이터 품질 metric (신규)

**Drift detection** (7일 baseline 대비 **PSI**, bucketed — KL은 신규 KO/EN 토큰/카테고리에 과민해 false alarm):
- `pipeline.drift.language_distribution`
- `pipeline.drift.category_distribution`
- `pipeline.drift.sentiment_distribution`
- `pipeline.drift.spam_ratio`

> drift 알림은 그 자체로 재처리 트리거가 아니다 ("drift ≠ action"). confidence-health 확인 후 tiered 대응(auto / HITL / escalate).

**Confidence health**:
- `pipeline.confidence.{classifier|language|extractor}.mean / p10 / p50 / p90`
- `pipeline.confidence.classifier.escalation_rate` (Opus 호출 비율)
- `pipeline.confidence.unknown_language_ratio`

**Vocabulary growth**:
- `pipeline.features.registry_size`
- `pipeline.features.unmatched_candidates_size`
- `pipeline.features.new_candidates_per_day`
- `pipeline.features.match_rate` (raw_mention 중 feature_id 매칭 비율)

**Pipeline health**:
- `pipeline.prefilter.filter_ratio`
- `pipeline.dedup.duplicate_ratio`
- `pipeline.embed.missing_ratio`
- `pipeline.reprocess.rate` (재처리 트래픽 비중)

**Cost / cache health** (v0.3):
- `pipeline.cache.prompt_hit_rate` — `cached_tokens / tokens_in`. 회귀 시 알림 (breakpoint 오배치 조기 감지).
- `pipeline.cache.semantic_hit_rate` — semanticCache(4.5b) 적중률.
- `pipeline.confidence.low_confidence_ratio` — `0.6 ≤ conf < 0.85` 비율 (analytics에서 격리, downstream 신뢰 금지).
- `pipeline.escalation.human_queue_rate` — 비-confidence 트리거로 사람 큐에 들어간 비율.

**Funnel pass-through** (v0.4 — "전처리가 어떻게 흘러가나"의 정량화):
- `pipeline.funnel.prefilter_pass` / `dedup_pass` / `cache_miss` / `classify_in` / `actionable_out` (각 단계 통과 건수·비율)
- 한 줄로: 유입 → (prefilter) → (dedup) → (cache) → classify → actionable. 어느 단계가 비용/누락을 지배하는지 한눈에.

**Code-grounded & signal (v0.4, 차별화 축 관측)**:
- `pipeline.defect.code_map_rate` — bug 중 artifact_matches 매핑 성공 비율 (낮으면 code_registry 보강 필요)
- `pipeline.defect.error_signature_rate` — 에러 시그니처 추출 비율
- `pipeline.signal.new_group_rate` / `signal.mean_corroboration` — 신규 그룹 생성률 / 그룹당 평균 증거 수
- `pipeline.signal.regression_detected` — 회귀 hint가 식별된 그룹 수 (Auto-Dev 우선 후보)

**Cluster 품질 (v0.5, #2 — 없으면 cluster degradation 감지 불가)**:
- `pipeline.cluster.intra_group_cosine_variance` — 그룹 내 응집도 (높아지면 chaining collapse 의심)
- `pipeline.cluster.cross_group_separation` — 그룹 간 분리도
- `pipeline.cluster.group_entropy` / `cluster.giant_component_ratio` — 거대 단일 그룹 형성 조기경보
- `pipeline.cache.semantic_revalidation_mismatch` — semanticCache sampled revalidation 괴리율 (#7, poisoning 조기감지)

**PII compliance**:
- `pipeline.pii.detection_count` (by type)
- `pipeline.pii.extraction_error_rate`

### Trace
- 한 RawReview의 처리 전체 = 하나의 trace. 각 stage 실행 = 1 span. `review_stage_outputs` row 1개당 1 span.

---

## 9. 열린 결정 사항

리서치([prior-art](./processing-layer-prior-art.md))로 **해소된 항목** (v0.3 반영):
- [x] **임베딩 타겟 텍스트 전략** → **원문(`text_redacted`) 임베딩**. translate-first/concat은 이득 근거 없이 MT 에러·언어 편향만 추가. (§4.8)
- [x] **classify+extract+moderate 단일 vs 분리** → **단일 유지** + category enum 강제. (§4.6)
- [x] **Batch API SLA** → 보통 <1h, 하드 24h → 비동기 처리에 적합. (§7)
- [x] **prefilter LLM escalation 정책** → **애매한 구간(uncertainty band)에서만** 발화 (전부 miss가 아니라). (§4.0)

**남은 결정**:
- [ ] **임베딩 모델 픽 + 차원** — Cohere `embed-multilingual-v3`(cross-lingual MIRACL 최강, 최저가) 기본 vs `voyage-3-large`(영어/종합·storage) vs `multilingual-e5-ko`. **`golden_reviews` ~100건 KO/EN bake-off로 cluster purity 비교 후 확정.** OpenAI `text-embedding-3-large`는 다국어 약해 탈락. ⚠️ 차원이 모델마다 달라(`vector(N)`) 스키마 전제 — 이 결정이 마이그레이션 선행.
- [ ] **유사도 임계 캘리브레이션** — dedup 0.95/0.90, feature 매칭 0.90/0.80을 언어별·교차언어별로 보정 (cross-lingual cosine이 same-language보다 낮음).
- [ ] **DLQ 설계 깊이** — `raw_reviews.processing_error + retry_count`로 충분한지, 별도 `dead_letter_reviews(failed_stage, error_type, retryable, payload_snapshot, stacktrace)` 테이블 필요한지.
- [ ] **동기/비동기 처리 SLA** — Insight Layer freshness 요구(실시간 / 5분 / 시간 / 하루)에 따라 queue/worker 설계 결정.
- [ ] **feature_registry 시드 전략** — 빈 registry + unmatched promote vs 제품 docs/help-center grounding 시드(Enterpret 패턴).
- [ ] **groundedness/citation 검증 위치** — 생성 결과의 출처 인용 검증을 Processing에 둘지 Insight Layer 책임으로 둘지 (경계 결정).
- [ ] **회귀 attribution = cross-stream join** (#6) — `regression_version_hint`는 리뷰만으론 약함(sparse/delayed). 제대로 하려면 **release/deploy 타임라인 스트림**과 결합(change-point detection). Ingestion이 release timeline을 공급해야 가능 → 레이어 경계 결정 필요. Processing 단독으로 똑똑하게 만들지 않는다.
- [ ] **eval/learning loop 자동화 깊이** (#8, =pillar E) — 현재 `review_annotations`/`golden_reviews`는 캡처용 스텁. human correction → prompt 개선 / threshold 재캘리브레이션 / benchmark replay 루프는 **의도적으로 defer**. defect+signal 신뢰도(Phase C) 안정화 후 착수. 자동화 전까지는 수동 eval-replay로 운용.
- [ ] **async reconciliation job 설계** (#2) — signal_group merge/split/representative 재선정/regression 재계산 로직. v0.5는 인터페이스 + `signal_group_events`만 고정, 알고리즘은 cluster purity metric 데이터 쌓인 뒤 결정.

---

## 10. 다음 단계

> **설계 동결.** v0.5 이후로는 설계를 더 쌓지 않는다. 아래 페이즈 순서대로 **검증·하드닝**으로 내려간다. grounding precision이 낮은데 Auto-Dev로 가면 wrong module → wrong PR → catastrophic이므로, **Auto-Dev는 맨 마지막**. (리뷰 #9 — scope explosion 방어)

**구현 페이즈 (순서 = 신뢰도 의존성)**
- **Phase A — 결정론 인프라 (먼저 반드시 안정화)**: materialization, version-aware reprocessing, observability, cache correctness, PII safety, audit event 캡처.
- **Phase B — semantic 신뢰도**: feature_registry, dedup 품질, clustering 품질(purity metric), confidence calibration.
- **Phase C — code grounding 신뢰도**: artifact 매핑 정밀도, error_signature 정규화, regression(cross-stream).
- **마지막 — Auto-Dev 루프** (Phase C 정밀도 검증 후에만).

**선행 작업**
0. **임베딩 bake-off** — `golden_reviews` KO/EN ~100건으로 Cohere v3 / voyage-3-large / e5-ko cluster purity 비교 → **모델 + 차원(`vector(N)`) 확정** (마이그레이션 전제).
1. zod 스키마 — `RawReview`, `ProcessedReview` (facts/inferences/versions, feature_matches, artifact_matches, 구조화 error_signature 포함)
2. Postgres 마이그레이션 — **14개 테이블** (기존 10 + `resolution_signals`, `signal_group_events`, `feature_registry_events`, `artifact_mapping_events`) + HNSW 인덱스
3. Stage runner — `Stage<In,Out>` / `StageResult<T>` / version-aware input_hash 캐시 / transitive invalidation / **Phase 1·2 분리** (Phase 2 = inline provisional + async reconciliation)
4. (A 인프라) Deterministic stages (LLM 0): `normalize`, `detectLanguage`, `extractPII`(regex+NER), `dedup`(SimHash+ANN), `prefilter`, `semanticCache`(+poisoning 방어)
5. (B) `classifyExtractModerate` sync → batch (graduated escalation + defect + is_resolution_report)
6. (B) `extractFeatureIds`(2-band) + feature_registry 시드
7. (C) `code_artifact_registry` 시드(repo+CODEOWNERS) + `mapCodeArtifacts`(provenance)
8. (C) `aggregateSignal` inline provisional + signal_group_events 캡처. **reconciliation 알고리즘은 purity 데이터 후 결정.**
9. e2e: 한국어 App Store 버그 리뷰 1건 → defect+artifact_matches+signal_group+event까지

---

## 11. v0.1 → v0.2 변경 요약

| # | 변경 | 위치 | 동기 |
|---|---|---|---|
| 1 | Stage materialization (`review_stage_outputs`) — 부분 재처리 가능 | §4, §5 | classifier/embedder만 교체 시 전체 재처리 회피 |
| 2 | `ProcessedReview`를 facts / inferences / versions 3분할 | §3 | fact와 inference 섞임 → drift / migration 추적 어려움 |
| 3 | per-component 버전 (pii/translator/classifier/extractor/moderator/embedder) | §3 versions | `pipeline_version` 단일은 너무 coarse |
| 4 | `prefilter` stage 추가 | §4.0 | spam에 Sonnet 토큰 태우지 않기 |
| 5 | `dedup` stage 추가 (SimHash + cosine) | §4.4 | 중복으로 embedding 비용/cluster noise 폭증 방지 |
| 6 | `extractPII` 확장 (PHONE/RRN/CARD/ADDR/ORDER) + vector DB로 PII 유출 차단 | §4.3 | compliance |
| 7 | `classifyExtractModerate` 내부 3-result split (단일 API 유지) | §4.6 | tool spec 부분 변경 영향 추적 + 후속 분리 용이 |
| 8 | `feature_registry` + `unmatched_feature_candidates` + `extractFeatureIds` stage | §4.7, §5 | feature slug vocabulary explosion 방지 |
| 9 | `review_annotations` + `golden_reviews` 테이블 스텁 | §5 | HITL 로직은 후속, 스키마 백필 회피 |
| 10 | Data quality / drift / vocab / PII compliance metric 추가 | §8 | LLM 비용 외 품질 가시화 |
| 11 | open question에 #3/#4/#8/#9 + #6/#7 추가 | §9 | 명시적으로 결정 보류 |

---

## 12. v0.2 → v0.3 변경 요약

선행 사례 리서치([processing-layer-prior-art.md](./processing-layer-prior-art.md)) 반영.

| # | 변경 | 위치 | 동기 (출처) |
|---|---|---|---|
| 1 | `extractPII`에 **NER 백스톱(PERSON/ADDR)** 추가 — regex + NER 하이브리드 | §4.3 | regex는 비구조적 PII(이름/주소)를 놓침 (Presidio/GLiNER) |
| 2 | `dedup`에 **임베딩 ANN 후보 경로** + near-dup band(0.90~0.95) | §4.4 | SimHash는 어휘적이라 paraphrase/번역 중복 누락 (SemDeDup) |
| 3 | **version-aware `input_hash`** = hash(input + stage_version + prompt_version) | §4 | prompt bump가 downstream까지 transitive 무효화 (Dagster data-version) |
| 4 | **`semanticCache` stage** 신규 (redaction 후 / LLM 전) | §4.5b | 반복 트래픽에 최고 ROI 비용 절감 (cascade router 패턴) |
| 5 | classify **graduated escalation** + 비-confidence 트리거 + category enum | §4.6 | 단일 0.6 컷오프는 coarse (Einstein/Fin/Zendesk) |
| 6 | feature 매칭 **2-band**(0.90/0.80) + 검증 state machine | §4.7 | 단일 0.85는 인접 feature 오병합 (Productboard) |
| 7 | embed 입력을 **원문(`text_redacted`)으로 확정** | §4.8, §9 | translate-first/concat 이득 근거 없음 (cross-lingual 연구) |
| 8 | review_embeddings/registry 인덱스 **ivfflat → HNSW** | §5 | 리뷰는 insert-heavy → ivfflat recall 저하 (pgvector) |
| 9 | `feature_registry` **SKOS 모델**(prefLabel/altLabel/broader) + description + merged_into | §5 | vocabulary explosion 표준 처방 + trend 연속성 (SKOS/Thematic) |
| 10 | `unmatched_feature_candidates` **클러스터링 + 빈도 임계 promote** | §5 | 단건 검토 비효율, emerging-issue 조기경보 (Unwrap) |
| 11 | vocab/drift metric **KL → PSI(bucketed)** + "drift ≠ action" | §8 | KL은 신규 KO/EN 토큰에 과민 |
| 12 | **cache/escalation metric** (prompt/semantic hit rate, low-conf ratio) | §7, §8 | prompt-cache breakpoint는 조용히 실패 |
| 13 | §9 임베딩 타겟·단일호출·Batch·prefilter escalation **결정 해소** | §9 | 리서치로 확정 |

---

## 13. v0.3 → v0.4 변경 요약

**차별화 재설계**: 출력이 사람용 대시보드가 아니라 Auto-Dev 에이전트가 먹는 코드 행동 신호. (상용 analytics 제품과의 결정적 차이)

| # | 변경 | 위치 | 동기 |
|---|---|---|---|
| 1 | **포지셔닝 재정의** — "분석"이 아니라 "코드 행동 신호" | §1.1 | 출력 소비자가 사람이 아니라 Auto-Dev 에이전트 |
| 2 | **한눈에 보는 처리 플로우(funnel + 분기 + 2-phase)** 다이어그램 | §1.4 | "전처리가 어떻게 흘러가나"가 stage 나열로는 안 보임 |
| 3 | **2-phase 파이프라인** — Phase 1 per-review(순수), Phase 2 cross-review(stateful) | §1.4, §4 | 증거 집계는 cross-review·시간축이라 순수함수 모델로 안 됨 |
| 4 | **(A) defect 블록** — affected_area/code_artifact_ids/error_signature/repro/회귀버전 | §3, §4.6 | 코드로 행동 가능한 신호 추출 (Auto-Dev 입력) |
| 5 | **(A) `mapCodeArtifacts` stage + `code_artifact_registry`** | §4.7b, §5 | defect를 실제 repo 위치(경로/모듈/오너)에 grounding |
| 6 | **(C) signal 블록 + `aggregateSignal` stage + `signal_groups`** | §3, §4.8b, §5 | 약한 단일 리뷰를 corroboration(N건·M버전·추세)으로 강화 |
| 7 | **회귀 감지** — signal group 최초 출현 버전 = 회귀 후보 | §4.8b, §5 | Auto-Dev 우선순위 신호 |
| 8 | **funnel + code/signal metric** 추가 | §8 | 전처리 통과율·차별화 축 관측 |
| 9 | 경계 명문화 — Processing은 group 멤버십+집계, prioritization은 Insight | §1.3 | 클러스터링 책임 분할 |

**아직 안 한 것 (의도적)**: fix-readiness 등급화(B), 파이프라인 self-heal 메타 루프(E)는 이번 범위에서 제외. defect+signal이 안정화되면 B는 자연스러운 다음 단계(이미 추출한 reproducibility/specificity/corroboration이 입력).

---

## 14. v0.4 → v0.5 변경 요약

**원칙**: 아키텍처 리뷰 9개 우려를 "**지금 안 잡으면 영영 복구 못 하는 비가역적 데이터 캡처**"만 반영(now), 로직은 defer. 새 stage 0개. scope explosion(리뷰 #9) 방어 — 이후 설계 동결.

| 리뷰 # | 변경 | 위치 | 티어 |
|---|---|---|---|
| #4 | `code_artifact_ids: string[]` → **`artifact_matches[]`** (score/source/reason provenance) — downstream "매핑=진실" 오신뢰 방지 | §3, §4.7b | **now** |
| #3 | `error_signature: string` → **구조화** `{raw, canonical?, family?, stacktrace_fingerprint?}` | §3 | **now** (구조), 정규화 defer |
| #1 | **audit event 테이블 3종** (`signal_group_events`/`feature_registry_events`/`artifact_mapping_events`) — state+history. **full event-sourcing 아님** | §5 | **now** (캡처), replay defer |
| #5 | **negative/resolution evidence** — `is_resolution_report` + `resolution_signals` + group `resolved` 경로 | §3, §5 | **now** (캡처), 해소 로직 defer |
| #7 | semanticCache **poisoning 방어** — 고신뢰만 적재 / TTL / sampled revalidation | §4.5b | **now** (정책) |
| #2 | Phase 2 재설계 — **inline provisional + async reconciliation**, centroid→**representative+max-radius**(complete-linkage 근사), **cluster purity metric** | §4.8b, §5, §8 | metric/구조 **now**, reconciliation 로직 defer |
| #6 | `regression_version` → **`regression_version_hint`** 정직한 재명명 + cross-stream join open question | §3, §5, §9 | **now** (명명), 로직 defer |
| #8 | eval/learning loop(=pillar E) **명시적 defer** + 수동 eval-replay 운용 | §9 | stub |
| #9 | **설계 동결** + Phase A→B→C→Auto-Dev 순서 명문화 | §10 | 원칙 |

**시스템 단위 전환**: review → `signal_group`(incident). incident는 생성/병합/분할/해소 생명주기를 갖는 엔티티, review는 그 위 evidence. (리뷰의 "pipeline → knowledge graph + event system" 통찰 수용)

**다음**: 설계 동결. Phase A(결정론 인프라) 구현 착수.
