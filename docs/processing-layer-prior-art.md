# Processing Layer — 선행 사례 리서치 & 비교

> 버전: v1 · 대상: Processing Layer 스펙(v0.2) 검증 및 v0.3 방향 결정
>
> 목적: 상용 feedback aggregation 제품, support-ticket triage 시스템, LLM 데이터 파이프라인 엔지니어링, dedup/taxonomy 기법의 선행 사례를 조사해 [processing-layer.md](./processing-layer.md) v0.2 스펙과 대조한다. 4개 도메인 병렬 리서치 종합.

---

## 0. 한 줄 결론

우리 v0.2 코어 설계 — **canonical `feature_registry` + alias/embedding 매칭 + 운영자 promote 후보 + SimHash/cosine dedup + staged materialized 파이프라인 + per-component versioning** — 은 가장 강한 상용 패턴(Enterpret, Thematic, Productboard)과 정합하고, "no-taxonomy" 벤더(Unwrap, Idiomatic)보다 **장기 trend 안정성에서 명백히 우월**하다. 시장이 하는데 우리 스펙에 빠졌거나 약한 지점은 명확히 정리됨(§3).

---

## 1. 도메인별 핵심 발견

### 1.1 상용 feedback aggregation 제품

| 제품 | taxonomy / dedup 방식 | 우리에게 주는 시사점 |
|---|---|---|
| **Enterpret** | 5단계 계층 + "Hierarchical Clustering(EHC)" + knowledge-base grounding + inline 교정→즉시 모델 반영 | 우리 2-tier(registry + reason 그룹) **강하게 검증**. 제품 docs/help-center로 registry **시드**, inline 교정을 1급 기능으로. |
| **Thematic** | canonical taxonomy + alias 매핑("사람이 말하는 법 ↔ 비즈니스 언어"), 명시적 taxonomy-owner, "taxonomy가 흔들리면 over-time trend 못 본다"고 경고 | `slug + aliases + embedding` 설계의 가장 강한 외부 검증. **trend 연속성**을 설계 불변식으로(merge 시 ID 승계). |
| **Productboard** | auto-link하되 **사람 검증 전까지 unverified**, 유사검색에서 이미 링크/아카이브 건 제외 | 매칭 state machine: `auto-matched(unverified) → verified \| rejected`. dedup 범위를 active/미해결 레코드로 한정. |
| **Unwrap.ai** | 순수 semantic clustering, "taxonomy 유지보수 0", <1일 anomaly 감지 | 반대 철학. clustering은 **후보 생성** 단계로만 쓰고 최종 taxonomy로 쓰지 말 것. anomaly 감지(미매칭 급증 알림)는 추가할 가치. |
| **Kraftful**(→Amplitude) | 30+ 소스 정규화/reconcile, **hallucination 감지**(특허출원), overnight batch | multi-source 정규화 = 초기 stage 검증. groundedness/citation 검증은 우리 갭. |
| **Dovetail** | AI가 **태그 description을 읽고** 적용 여부 결정, Magic Cluster | `feature_registry`에 **풍부한 자연어 description** 필드 추가 → embedding 생성 + LLM 매칭 disambiguation에 사용. |
| **Idiomatic / Viable** | pretrained, taxonomy 불필요 / 커스텀 taxonomy + 출처 인용 NL Q&A | category를 **비즈니스 결과(churn/escalation/revenue)에 연결**하면 descriptive → prioritization-ready. |

> 주의: 벤더 자료는 마케팅 grade라 임베딩/버저닝/스테이징 내부는 비공개. 이 자체가 신호 — **우리 스펙이 어떤 벤더 공개물보다 내부 구조에 명시적**이며, 직접 만들고 운영할 거라면 그게 맞다.

### 1.2 Support-ticket triage 시스템 (Zendesk / Intercom Fin / Gorgias / Einstein)

- **분류**: 전부 고정/큐레이트된 intent taxonomy + 리뷰 가능한 제안. 열린 LLM 분류는 drift 위험 → **enum 강제**(tool schema). Zendesk는 subject+첫 메시지로 분류, 고객 답변 시 재분류.
- **감성/심각도**: sentiment + priority/severity를 병렬 출력하고 routing에 사용. 어휘적 urgency cue("urgent/broken/refund/legal")로 강제 escalation.
- **spam prefilter**: 정석은 **2-stage** — 싼 1차 + *불확실 구간(uncertainty band)만* 비싼 2차. 우리 prefilter + cheap-LLM escalation과 정확히 일치(검증). 단, escalation은 *애매한 구간에서만* 발화해야(전부 miss가 아니라).
- **PII**: 정석은 **regex + ML/NER 하이브리드**(Presidio: spaCy NER + regex + checksum). regex는 구조적 PII(email/phone/card/RRN), NER은 비구조적(이름/주소). 추론 요청이 모델에 닿기 **전** 핸드셰이크에서 강제.
- **confidence escalation**: 전부 **tiered** — Einstein "자동화 정도가 높을수록 더 높은 confidence 요구". 단일 컷오프보다 graduated/action-specific. 비-confidence 트리거(사람 요청/분노/반복 루프)도 escalation.

### 1.3 LLM 데이터 파이프라인 엔지니어링

- **materialization 캐싱**: Dagster의 "data version = hash(code_version + upstream data versions)"가 우리 `input_hash` 패턴과 동일. **개선: `input_hash`에 component/prompt 버전을 명시적으로 포함** → prompt bump가 downstream까지 transitive 무효화.
- **batch + caching**: Anthropic Message Batches 50% off, 보통 <1hr/하드 24hr; cache-read ~90% off → 캐시된 system 토큰에 ~95% 복합 할인. 단 **cache_control breakpoint 오배치 시 조용히 full-price** → cache hit를 1급 metric으로 측정·알림. 프롬프트는 static-prefix-first 배치.
- **구조화 출력**: tool-use는 *모양*만 보장. 경량 post-validation(Pydantic) + bounded retry 유지. 최고볼륨 stage는 native constrained decoding 검토.
- **idempotency**: LLM은 토큰 결정성이 깨지므로 idempotency는 **워크플로 속성**. transient 재시도(캐시 재사용) vs sampling 재시도(재생성 강제) 구분 명문화.
- **drift 관측**: KL은 희귀/신규 카테고리(신규 KO/EN 토큰)에 과민 → **vocab/drift는 PSI(bucketed) 권장**. "drift ≠ action" — 재처리는 confidence-health 확인 후 tiered(auto/HITL/escalate).

### 1.4 dedup & taxonomy 기법

- **SimHash vs 임베딩 cosine**: SimHash/MinHash는 **어휘적** — paraphrase/번역 중복은 후보로조차 안 잡힌다. SemDeDup(NeMo Curator)의 cluster-then-verify가 우리 2-stage를 검증하나, **후보 생성을 임베딩 ANN top-k로도** 해야 의미 중복을 잡는다.
- **임계값**: cosine ≥0.90 = near-dup 통념, ≥0.95 = strict 진짜 중복. 우리 0.95는 보수적(정밀↑, paraphrase 누락↑).
- **Postgres**: pgvector ≥0.7.0이 `bit` 벡터 + `hamming_distance`/`jaccard_distance` 네이티브 인덱싱 → SimHash 지문을 pgvector에 직접 저장·검색 가능(검증). `pg_trgm`은 SimHash 후보 생성에 부적합.
- **taxonomy**: vocabulary explosion은 명명된 연구 문제(CESI 등). 정석 처방 = 우리의 exact-alias→embedding 2-tier. **SKOS 모델 채택 권장**: 1 concept = `prefLabel` + 다수 `altLabel`(KO/EN 표면형) + `broader`/`narrower`(계층). 미매칭 후보는 **클러스터링 후** 검토 + 재발 빈도 임계로 promote.
- **pgvector 인덱스**: 리뷰는 insert-heavy/성장형 → ivfflat은 build 시점 클러스터링이 **시간이 지나며 recall 저하**. **HNSW(`m=16, ef_construction=200`)로 전환 권장.**
- **KO/EN 임베딩 타겟**: **원문 임베딩** 권장. translate-first는 MT 에러/지연/lossy pivot만 추가(개선 근거 없음), concat은 토큰 많은 언어로 편향. 강한 multilingual 모델로 원문을, golden-set A/B로 검증.

---

## 2. 우리 스펙이 잘한 것 (외부 검증됨)

| 스펙 요소 | 검증 출처 |
|---|---|
| canonical `feature_registry` + aliases + embedding 매칭 | Enterpret, Thematic 수렴 |
| `unmatched_feature_candidates` 운영자 promote 루프 | Productboard, TaxoCom 문헌 |
| SimHash + cosine 2-stage dedup | SemDeDup / NeMo Curator |
| staged 파이프라인 + materialized 중간결과 + `input_hash` 캐시 | Dagster data-version 패턴 |
| per-component 버저닝 (부분 backfill) | 문헌상 "가장 흔한 실패(prompt provenance)"를 선제 해결 — 평균 practice보다 앞섬 |
| 결정론적 `prefilter` + cheap-LLM escalation | 정석 2-stage spam 필터 |
| PII redaction을 LLM **및 vector DB** 전에 | "intercept before inference" 원칙, 벤더 norm보다 앞섬 |
| Batch API 기본 + ephemeral prompt caching | Anthropic/OpenAI 표준 비용 레버 |
| drift/confidence/vocab/PII metric + `golden_reviews`/`review_annotations` HITL 스텁 | tiered drift + golden-set + HITL 표준 |

---

## 3. 갭 & 개선안 (수렴된 권고)

우선순위순. 각 항목은 적용할 스펙 섹션 표기.

1. **[§4.3 PII] PERSON/NAME 추가 + NER 백스톱.** 현재 목록(URL/EMAIL/PHONE/CARD/RRN/ADDR/ORDER)은 전부 구조적 PII = regex 강점. 그러나 **이름/주소 같은 비구조적 PII는 regex가 놓친다.** Presidio/GLiNER급 경량 NER을 regex 뒤에 backstop으로. (compliance 갭)
2. **[§4.4 dedup] 임베딩 ANN 후보 경로 추가.** SimHash 단독은 어휘적이라 paraphrase/번역 중복을 후보로조차 못 만든다. cosine top-k 후보 + 기존 ≥0.95 검증 게이트 병행. + 0.90–0.95 "near-dup" 밴드 도입.
3. **[§4/§5 캐시] `input_hash`에 component+prompt 버전 포함.** `hash(input + component_version + prompt_version)` → prompt/모델 bump가 해당 stage와 downstream을 transitive 무효화 → 깨끗한 부분 backfill. (현재 최대 레버리지 갭)
4. **[§5 index] review_embeddings를 ivfflat(lists=100) → HNSW로.** 리뷰는 insert-heavy/성장형이라 ivfflat은 recall이 조용히 저하되고 주기적 REINDEX 필요. `m=16, ef_construction=200`, `ef_search` 튜닝. ivfflat 유지 시 최소한 현재 row 수로 `lists` 재계산 + 정기 재빌드.
5. **[§4.6/§7 escalation] 단일 0.6 컷오프 → graduated/action-specific 임계 + 비-confidence 트리거.** auto-act > human-suggest > escalate-to-bigger-model 각각 별도 bar(Einstein). 분노/사람 요청/반복 루프는 confidence 무관 escalation(Fin). uncertainty 기반 캘리브레이션.
6. **[§4.7 매칭] feature canonicalization 2-band.** ≥~0.90 auto-attach, 0.80–0.90 human 큐, <0.80 신규 후보. 단일 0.85보다 false merge·bloat 동시 감소. + 매칭은 Productboard식 `unverified → verified|rejected` state machine, reject은 negative signal.
7. **[신규 stage] semantic cache (redaction 후 / LLM 전).** 리뷰/지원 트래픽은 반복적 → 가장 ROI 높은 비용 절감. redacted 텍스트 키로.
8. **[§5 registry] SKOS 모델 + 자연어 description.** 1 concept = prefLabel + altLabel(KO/EN 표면형) + broader/narrower. Dovetail식 description 필드를 embedding·LLM 매칭에 사용. **merge 시 ID 승계**로 trend 연속성 보존(불변식).
9. **[§8 metric] vocab/drift를 KL → PSI(bucketed)로.** 신규 KO/EN 토큰의 false alarm 방지. 재처리는 confidence-health 확인 후 tiered.
10. **[§5/운영] `unmatched_feature_candidates` 클러스터링 후 검토 + 재발 빈도 임계 promote.** promote 시 클러스터 표면형을 altLabel로 자동 흡수. 미매칭 급증 = 아직 canonical 안 된 feature 조기 경보(Unwrap anomaly).
11. **[cross-cutting] cache hit를 1급 metric으로.** `cache_read`/`cache_creation` 토큰 per-call 기록 + 회귀 알림(캐시는 조용히 실패). 프롬프트 static-prefix-first.
12. **[Insight Layer 경계] groundedness/citation 검증.** 생성 요약/카테고리가 출처 레코드를 인용하도록. Processing보다 Insight Layer 책임에 가깝지만 명시 필요.

---

## 4. §9 열린 결정 사항 — 리서치 해소

| §9 항목 | 리서치 결론 |
|---|---|
| **임베딩 타겟 텍스트 (원문/번역/concat)** | ✅ **원문 임베딩으로 결정.** translate-first는 이득 근거 없이 MT 에러/지연/lossy pivot 추가, concat은 언어 편향. 강한 multilingual 모델로 원문을 임베딩. golden-set으로 cluster purity A/B(원문이 이겨야 할 prior). |
| **임베딩 모델 픽** | OpenAI text-embedding-3-large는 **탈락**(MIRACL 다국어 최약). 후보: **Cohere embed-multilingual-v3**(cross-lingual MIRACL 최강 +11% vs OpenAI, 최저가, int8/binary) vs **voyage-3-large**(영어/종합 최강, 최고 storage 경제) vs **KO-tuned multilingual-e5**(dragonkue 등, 한국어 +0.8~1.5 NDCG). **권고: Cohere 기본, voyage/e5를 challenger로 `golden_reviews` bake-off.** ⚠️ 차원이 모델마다 다름(Cohere 1024, voyage 1024/2048) → 스펙의 `vector(1536)` 가정 **재검토 필요**. |
| **classify+extract+moderate 단일 vs 분리** | ✅ **단일 호출 유지.** 현대적·검증됨. category enum을 tool schema에 강제해 label drift 방지. |
| **Batch API SLA 적합성** | ✅ 보통 <1hr, 하드 24hr → 비동기 리뷰 처리에 적합. classify뿐 아니라 extractor/moderator도 batch 검토. |
| **DLQ 설계 깊이** | 미해소 — 별도 리서치/결정 필요. |
| **prefilter LLM escalation 정책** | ✅ **애매한 구간(uncertainty band)에서만** 발화(전부 miss가 아니라). 2-stage 정석. |

---

## 5. 다음 단계

1. 위 §3 갭 중 **1~6번을 v0.3 스펙에 반영** (PII NER, dedup ANN, version-aware hash, HNSW, graduated escalation, 2-band 매칭).
2. **임베딩 bake-off 설계**: KO/EN 혼용 ~100건 `golden_reviews` 슬라이스로 Cohere v3 vs voyage-3-large vs e5-ko의 cluster purity/silhouette 비교 → 모델 + 차원 확정 → `vector(N)` fix.
3. `feature_registry` 스키마를 SKOS형으로 재설계(prefLabel/altLabel/broader/narrower/description).
4. DLQ 설계 깊이 별도 결정(§9 미해소 항목).

---

## 부록: 주요 출처

**feedback aggregation**: [Enterpret Adaptive Taxonomy](https://www.enterpret.com/platform/adaptive-taxonomy) · [Thematic taxonomy](https://getthematic.com/insights/how-to-build-a-customer-feedback-taxonomy) · [Productboard AI auto-link](https://support.productboard.com/hc/en-us/articles/26949590820627) · [Unwrap ML](https://www.unwrap.ai/post/unwraps-machine-learning) · [Dovetail taxonomy](https://dovetail.com/blog/four-taxonomy-best-practices/)

**ticket triage**: [Zendesk intent/sentiment](https://support.zendesk.com/hc/en-us/articles/4550640560538) · [Intercom Fin engine](https://www.intercom.com/help/en/articles/9929230) · [Einstein Case Classification](https://trailhead.salesforce.com/content/learn/modules/service_case_class) · [PII detection for LLM pipelines](https://predictionguard.com/blog/pii-detection-redaction-llm-pipelines-regulated-industries) · [LLM routing/cascades](https://tianpan.co/blog/2025-11-03-llm-routing-model-cascades)

**LLM pipeline**: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [Dagster asset versioning](https://docs.dagster.io/guides/build/assets/asset-versioning-and-caching) · [Idempotency in LLM pipelines](https://tianpan.co/blog/2026-04-20-idempotency-llm-pipelines) · [voyage-3-large](https://blog.voyageai.com/2025/01/07/voyage-3-large/) · [Cohere Embed v3 benchmarks](https://ucstrategies.com/news/cohere-embed-v3-multilingual-embedding-model-specs-benchmarks-2026/) · [drift: KL/PSI](https://link.springer.com/article/10.1007/s42488-024-00119-y)

**dedup/taxonomy**: [In Defense of MinHash Over SimHash](https://arxiv.org/abs/1407.4416) · [SemDeDup / NeMo Curator](https://docs.nvidia.com/nemo-framework/user-guide/24.09/datacuration/semdedup.html) · [pgvector README](https://github.com/pgvector/pgvector) · [IVFFlat vs HNSW](https://bigdataboutique.com/blog/hnsw-vs-ivfflat-how-to-choose-the-right-vector-index) · [SKOS Reference](https://www.w3.org/TR/skos-reference/) · [Korean-English Cross-Lingual Retrieval](https://arxiv.org/html/2507.08480)
