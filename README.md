# Ouroboros
Ingests user reviews, clusters them into themes, and opens PRs for the highest-impact ones.

설계 스펙: [`docs/processing-layer.md`](docs/processing-layer.md) (v0.5, 설계 동결) · [선행 사례](docs/processing-layer-prior-art.md)

---

## Processing Layer — Phase 1 + Phase 2 구현

스펙 §1.4의 **Phase 1(per-review 순수 파이프라인)** 전체 + **Phase 2(`aggregateSignal`, cross-review
증거 집계)**까지 구현했다. Phase 2의 async reconciliation은 인터페이스 + purity 메트릭만(merge/split
로직은 스펙대로 후속 — `src/pipeline/reconciliation.ts`).

### 빠른 시작

```bash
npm install
npm run db:up          # Docker로 Postgres 16 + pgvector 기동 (host:5433)
npm run db:migrate     # 스펙 §5 스키마 (14테이블 + HNSW 인덱스)
npm run seed           # feature_registry(SKOS) + code_artifact_registry 시드
npm run run:corpus     # 합성 코퍼스 처리 + funnel/결과 리포트
npm test               # 순수 stage 단위 테스트 (DB 불필요)
```

`npm run db:up` 후 한 번에: `npm run db:migrate && npm run seed && npm run run:corpus`.

### Graphify (코드 그래프 producer, P0)

대상 repo를 **TypeScript Compiler API**로 스캔해 `code_artifact_registry`(module/file/symbol)·`code_edges`
(contains/imports)·**code-derived grounded features**를 채운다 — 결정론적, Claude 토큰 0, 증분(content_hash) 토대.
`mapCodeArtifacts`가 매칭할 "실제 코드 지도"의 producer. selfheal 자체를 dogfooding:

```bash
npm run graphify:scan           # 현재 repo(src/) 스캔 → 모듈→기능 맵 출력
npm run graphify:scan <repo> <rootDir>
```

목표 그림: 코드에서 **모듈→기능**을 먼저 정리 → 리뷰가 들어오면 기능에 매핑(grounded) / 없으면 floating(gap)
→ Insight가 "어느 모듈에 어떻게 추가할지" 제안. 설계: `docs/graphify-layer.md`.

스캐너는 `.ts`/`.tsx` + 다중 소스루트(app/components/lib/hooks 등)를 지원하며 모듈→기능 description에
멤버 심볼명을 넣어 매핑 판단의 재료를 준다. 매핑 대상 codebase는 `TARGET_REPO`(기본
`tete-lab/automated-trading-system`), feature는 `repo`로 스코프되어 여러 codebase가 공존.

### 파이프라인 (구현된 11 stage)

```
RawReview
  → prefilter        (휴리스틱 drop + 애매구간만 cheap-LLM escalation)
  → normalize / detectLanguage / extractPII(regex+NER)   [LLM 0]
  → translate        (lang≠en 조건부)
  → embed            (text_redacted 임베딩; dedup/cache가 쓰므로 일찍 1회 계산해 재사용)
  → dedup            (SimHash 어휘 + 임베딩 ANN, 2-band: exact/near)
  → semanticCache    (과거 고신뢰 분류 재사용 → classify skip)
  → classifyExtractModerate  (단일 호출 + graduated escalation + defect 추출)
  → extractFeatureIds        (exact alias → embedding 2-band)
  → mapFeature (P1)          (Claude-as-judge: 타깃 codebase 기능에 매핑 → grounded/defective/gap.
                              gap = 미구현 요청 → floating(emergent feature) + Insight 큐)
  → mapCodeArtifacts         (grounded/defective feature → 모듈 코드 앵커)
  → persist          (processed_reviews + review_embeddings + stage_outputs, tx)

  [Phase 2: cross-review, stateful — persist 후]
  → aggregateSignal  (canonical error_signature 키 / representative cosine≥0.88 + code_artifact
                      교집합으로 signal_group 배정, rolling 집계, signal_group_events audit)
  → (reconciliation) async stub — purity 메트릭만, merge/split은 후속
```

### 교체 가능한 클라이언트 (현재 비용 0)

LLM/임베딩은 인터페이스 뒤에 있고 env로 stub↔real을 전환한다. **기본은 stub/local — API 키 불필요.**

| 컴포넌트 | 기본(stub) | 실제 (`.env`로 전환) |
|---|---|---|
| LLM | `StubLlmClient` (규칙 기반, 결정론적) | **`LLM_CLIENT=claude-cli`** → 구독 Claude(headless `claude -p`, 추가과금 0) · 또는 `LLM_CLIENT=anthropic` + `ANTHROPIC_API_KEY` → 충전식 API |
| 임베딩 | `LocalEmbeddingClient` (hashed char-ngram) | `EMBEDDING_CLIENT=cohere` + `COHERE_API_KEY` → embed-multilingual-v3 |

**개발 단계 권장: `claude-cli`** — PC에 로그인된 Claude Code **구독**으로 진짜 분류를 돌린다.
API 키/충전 불필요(구독 한도 소비). `claude` CLI가 PATH에 있어야 함.

```bash
$env:LLM_CLIENT="claude-cli"; npm run run:corpus    # PowerShell
LLM_CLIENT=claude-cli npm run run:corpus            # bash
```

> claude-cli는 호출당 CLI 프로세스를 띄워 ~10-16초/건. 검증엔 충분하지만 대량은 느림.
> 구조화 출력은 tool-use 대신 "JSON만 출력" 프롬프트 + zod 검증으로 받는다(spec §7).

버전 문자열(`config.pipelineVersions`)이 stub/real에 따라 달라지고 `input_hash`에 섞이므로,
전환하면 해당 stage 캐시가 자동 무효화되어 transitive 재처리된다(스펙 §4).

> ⚠️ 로컬 임베더는 의미 임베딩이 아니라 **어휘(char-ngram) 유사도**다. dedup/semanticCache 메커니즘
> 검증엔 충분하지만, 진짜 cross-lingual 의미 매칭은 Cohere로 전환 + §9 bake-off로 차원/임계 확정 필요.
> 그래서 유사도 임계값은 toy 임베더에 맞춰 보정돼 있다(`config.thresholds` 주석 참고).

### 검증 결과 (stub/local, 합성 17건)

`npm run run:corpus`가 매 분기를 실제로 태운다:
- **prefilter drop** 2건(단일문자 도배 / URL 폭격) · **dedup exact** 1건(완전중복)
- **dedup near + semanticCache HIT** 1건(`ps-006-cache`, cos≈0.97 → classify LLM skip)
- **bug→code grounding**: 결제 크래시 → `Sources/Payment/PaymentView.swift` (feature_link)
- **PII 마스킹**: EMAIL/PHONE/CARD(Luhn)/RRN/PERSON, 일반명사 오탐 없음
- **사람 검토 큐**: critical 3 · refund_legal 2
- **코드 risk tier**: 결제 크래시 → `PaymentView.swift [risk=critical]` (Insight 우선순위 가중용,
  bug-hunter triage 휴리스틱 이식 — `src/util/code-risk.ts`)
- **Phase 2 signal grouping**: 5개 그룹, 2개 corroborated ⭐ — `[crash]` 결제 크래시 2건(ios+android
  크로스플랫폼), `[hang]` 로그인 2건. canonical error_signature 키로 묶이고 `signal_group_events` audit.
- **재처리 결정성**: stage 캐시 hit + **LLM 0**, signal_group corroboration **2→2**(멱등, 안 부풀음)
- **관찰가능성(§8)**: funnel·confidence health(p10/p50/p90·escalation_rate)·cache hit rate·stage latency·
  defect code_map_rate·signal corroboration·vocab match_rate·PII compliance + **drift PSI**(런 분포를
  `metric_snapshots`에 저장, 직전 런 대비 PSI로 분포 변화 감지). `MetricsSink` 인터페이스 — OTel/Prometheus 스왑 가능.

### 구조

```
src/contracts/   RawReview · ProcessedReview(facts/inferences/versions) · Stage zod 스키마
src/clients/     llm/{stub,anthropic} · embedding/{local,cohere} (+ env 팩토리)
src/stages/      11개 per-review stage (순수 함수 시그니처, ctx 주입)
src/pipeline/    runner(version-aware input_hash 캐시) · phase1(오케스트레이션) · context
src/db/          Db (pg + pgvector 직렬화, 모든 쿼리)
db/migrations/   001_init.sql (§5 스키마)
corpus/          합성 리뷰 코퍼스
scripts/         migrate · seed-registries · run-corpus
```
