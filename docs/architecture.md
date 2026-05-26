# selfheal (Ouroboros) — 시스템 아키텍처

> 버전: v0.1 (draft, **논의용 — 동결 아님**) · 대상 독자: 전 레이어 개발자 + UI
>
> 이 문서는 **우산(umbrella) 문서**다. 각 레이어의 상세 스펙은 별도 문서가 가진다([processing-layer.md](./processing-layer.md), [graphify-layer.md](./graphify-layer.md)). 여기서는 (1) 레이어가 어떻게 맞물리는지, (2) 공유 데이터 모델, (3) **UI ↔ 백엔드 컨트랙트**, (4) 디렉터리 구조와 빌드/배선 순서를 정의한다.
>
> **한 줄 정의**: selfheal은 앱스토어/커뮤니티 리뷰를 먹어, 대상 제품의 **코드 지도 위에 신호를 얹고**, 임팩트 높은 이슈에 대해 **PR 초안까지 자동 생성**하는 self-improving 루프다. 출력은 사람이 읽는 대시보드가 아니라 **에이전트가 먹는 신호** — 단, 사람은 UI로 *승인/거절*에서 루프에 개입한다(HITL).

---

## 0. 큰 그림 — Ouroboros 루프

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                      selfheal loop                        │
                    ▼                                                           │
  [1 Ingestion] ──reviews──▶ [2 Processing] ──signals──▶ [4 Insight] ──proposals──▶ [5 Auto-Dev] ──PR──▶ (제품 repo)
                                   │                          ▲                         │
                                   │ map onto                 │ ground on               │ reads/writes
                                   ▼                          │                         ▼
                              [3 Graphify] ── code map (module→feature→artifact) ───────┘
                                   ▲
                                   └── 대상 제품 repo를 스캔 (read-only)

  사람(HITL): [4]의 proposal을 Slack/UI에서 승인/거절 → 승인분만 [5]로.
  PR 머지 → 제품 변경 → 새 리뷰 → 루프 반복 (= Ouroboros, 자기 꼬리를 무는 뱀).
```

레이어 간 결합은 **공유 테이블(컨트랙트)로만** 한다 — 코드 결합 아님. 한 레이어를 stub→real로 갈아끼워도 다른 레이어는 모른다.

---

## 1. 레이어 책임 + 현재 구현 상태

| # | 레이어 | 책임 (한 줄) | 산출 테이블 | 상태 | 코드 |
|---|--------|------|------|------|------|
| 1 | **Ingestion** | 소스(App/Play Store, Reddit, Intercom…) → raw review 적재 | `sources`, `raw_reviews`(예정) | 🔴 미구현 — 지금은 `corpus/*.ts` 손코딩 코퍼스가 대역 | `corpus/` |
| 2 | **Processing** | raw review → 코드-grounded `ProcessedReview` (분류·PII·번역·feature/code 매핑·신호 집계) | `processed_reviews`, `signal_groups` | 🟢 Phase1·2 + 관찰가능성 완료 | `src/processing/` (stages + pipeline) |
| 3 | **Graphify** | 대상 repo → module→feature→artifact 코드 지도 (리뷰가 착지할 곳) | `code_artifact_registry`, `code_edges`, `feature_registry` | 🟢 결정론 스캔 + sub-feature 분해 동작 | `src/graphify/` |
| 4 | **Insight & Proposal** | 신호를 우선순위 매겨 issue 초안 (bug/gap/enhancement) + gap 클러스터링·코드그래프 검증 | `proposals` | 🟢 v1 동작 | `src/insight/` |
| 5 | **Auto-Dev** | 승인된 proposal → 브랜치·코드·테스트·PR | `agent_runs`(예정) | 🔴 미구현 | — |

> **경계 원칙** (각 레이어 스펙의 §1.3 합집합): "누가 같은 문제인가"는 Processing, "무엇부터 고칠까"는 Insight, "어떻게 고칠까/PR"은 Auto-Dev, "어디에 고칠까(코드 위치)"는 Graphify가 깐 지도. Ingestion·Graphify는 **읽기 전용**(제품 repo에 쓰지 않음).

---

## 2. 공유 데이터 모델 (현재 14+ 테이블, 마이그레이션 001~006)

레이어를 잇는 핵심 테이블만:

- **`processed_reviews`** — Processing 산출. `facts`(정규화 원문/redacted), `inferences`(classification·extraction·**feature_mapping**), `signal_group_id`, `category`. Reviews/Dashboard/Processing 페이지의 원천.
- **`signal_groups`** — incident 단위. `error_signature`, `corroboration_count`, `affected_platforms/versions`, `trend`, `code_artifact_ids`. Insight 우선순위의 입력.
- **`feature_registry`** (repo-scoped) — Graphify가 깐 module→feature→sub-feature 트리. `status` ∈ {grounded, gap}, `parent_id`(SKOS), `merged_into`(gap 클러스터링), `pref_label`. Processing 그래프 + gap floating의 원천.
- **`code_artifact_registry` / `code_edges`** — 파일·심볼 노드 + contains/imports 엣지. Auto-Dev의 "어디를 건드리면 무엇이 영향받나" 입력.
- **`proposals`** (repo-scoped) — Insight 산출. `kind` ∈ {bug_fix, feature_gap, enhancement}, `priority`, `target_module`, `placement`, `body`(issue 초안 md), `evidence`(verdict 등). Insights 페이지의 원천, Auto-Dev의 입력.

마이그레이션: `001_init`(14 테이블), `002_code_risk`, `003_observability`(metric_snapshots), `004_graphify`(code_edges, graphify_runs), `005_feature_repo`(feature_registry.repo), `006_proposals`. **다음 예정**: `007_ingestion`(sources, raw_reviews), `008_autodev`(agent_runs), `009_audit`(audit_events).

---

## 3. UI ↔ 백엔드 컨트랙트 (이번 작업의 핵심)

UI는 `web/`의 무빌드 React(CDN React+Babel) 목업이다. 8 페이지 + 온보딩/오버레이가 **전부 `window` 전역 mock 데이터**로 동작한다. 백엔드 배선 = 페이지별로 mock을 `/api/*` JSON으로 교체하는 작업.

### 3.1 페이지 → 데이터 → 백엔드 매핑

| 페이지 (`web/page-*.jsx`) | mock 전역 | `/api` 엔드포인트 | 백엔드 원천 | 배선 가능? |
|---|---|---|---|---|
| Dashboard | `PIPELINE`, `CATEGORIES`, `ACTIVITY` | `GET /api/dashboard` | run funnel + `processed_reviews` 집계 + audit | 🟡 부분 (funnel/category 가능, activity는 audit 레이어 대기) |
| Sources | `SOURCES` | `GET /api/sources` | Ingestion `sources` | 🔴 Ingestion 미구현 |
| Reviews | `RAW_REVIEWS` | `GET /api/reviews` | `processed_reviews` | 🟢 가능 |
| Processing | `MODULES`, `REVIEWS` | `GET /api/graph` | `feature_registry` 트리 + gap + `processed_reviews` | 🟢 가능 (기존 `ui-server.ts` buildGraph 재사용) |
| Insights | `PROPOSALS` | `GET /api/proposals` | `proposals` | 🟢 가능 |
| Auto-Dev | `AGENTS`, `TERMINAL_LINES` | `GET /api/agents` | Auto-Dev `agent_runs` | 🔴 Auto-Dev 미구현 |
| Activity | `AUDIT_EVENTS` | `GET /api/activity` | `audit_events` | 🔴 audit 레이어 대기 |
| Settings | — | `GET /api/config` | `src/config.ts` | 🟡 read-only 노출부터 |

### 3.2 컨트랙트 원칙

- **응답은 mock 스키마를 그대로 맞춘다.** UI를 거의 안 고치고 `window.X` → `await fetch('/api/x')`만 바꾸도록. (mock 모양이 곧 API 모양.)
- 라우트마다 `source: 'live' | 'mock'` 플래그. 미구현 레이어는 mock-shaped JSON을 `source:'mock'`으로 돌려줘 UI가 깨지지 않게 한다 → 레이어가 생기면 `'live'`로 승격.
- 컨트랙트는 `src/api/contract.ts`에 **타입으로** 박아 둔다(라우트 테이블 + 응답 타입). 핸들러는 `scripts/serve.ts`.
- repo 스코프는 `config.targetRepo`(현재 `tete-lab/automated-trading-system`).

### 3.3 서버 — Hono (얇은 프레임워크)

API 표면은 **Hono**로 조립한다(`src/api/app.ts`). UI에 승인/거절·소스추가 등 **쓰기(CRUD)가 명백히 필요**해서, raw `node:http` 대신 라우팅·zod 검증·미들웨어를 주는 얇은 프레임워크를 도입했다. NestJS 같은 무거운 앱 프레임워크는 배제(배치 레이어 성격과 충돌, ceremony 과다). 코드베이스가 zod 범벅이라 `@hono/zod-validator`와 맞물린다.

- `src/api/app.ts` — Hono 앱 조립. db/repo를 컨텍스트 주입 + 리소스별 라우터를 `/api`에 마운트. **새 레이어 = 라우터 파일 하나 + 여기 한 줄.**
- `src/api/routes/*.ts` — 리소스별 라우터(graph/proposals/reviews/dashboard + planned). GET은 live, CRUD POST는 zod 검증까지 골격(승인 영속화는 §7.1 결정 대기 501).
- `src/api/static.ts` — `web/` 정적 서빙(`.jsx`→`text/javascript`, Babel standalone이 브라우저에서 변환). catch-all.
- `scripts/serve.ts` — `@hono/node-server`로 위 앱을 띄우는 **얇은 부트스트랩**뿐.

UI 쪽은 빌드 스텝 없음(의도적, graphify 비용철학과 같은 결: 도구 최소화). 배치 레이어(Ingestion/Processing/…)는 **프레임워크 없이** 모듈+CLI 래퍼 유지 — 오케스트레이션(큐/스케줄)은 무인 루프가 필요해질 때 pg-boss(기존 Postgres 재사용)로 핀포인트 도입.

---

## 4. 디렉터리 구조 (단일 패키지)

```
selfheal/
├─ docs/                  설계 문서 (이 문서 = 우산, + 레이어별 스펙)
├─ db/migrations/         *.sql, 이름순 idempotent
├─ corpus/                Ingestion 대역 (손코딩 리뷰) — 레이어1 생기면 축소
├─ src/
│  ├─ config.ts           중앙 설정 (DI 스위치: llmClient/embeddingClient/targetRepo)
│  ├─ contracts/          zod 스키마 (ProcessedReview 등)
│  ├─ clients/            교체형 클라이언트 (llm: stub|claude-cli|anthropic, embedding)
│  ├─ processing/         Processing 레이어 (모듈)
│  │  ├─ stages/          per-review 단계들 (prefilter~persist)
│  │  ├─ pipeline/        Phase1/2 오케스트레이션 (phase1·runner·reconciliation·context)
│  │  └─ index.ts         레이어 public 엔트리 (processReview·makeContext·runReconciliation 재노출)
│  ├─ graphify/           repo 스캔 → 코드 지도
│  ├─ insight/            우선순위 + 제안
│  ├─ observability/      metrics
│  ├─ db/                 Db 클래스 (쿼리 헬퍼)
│  ├─ util/               code-risk 등
│  └─ api/                ← UI ↔ 백엔드 (Hono)
│     ├─ contract.ts      타입 + ApiEnv + ROUTES 테이블 (단일 진실원천)
│     ├─ app.ts           Hono 앱 조립 (라우터 마운트 + db/repo 주입)
│     ├─ static.ts        web/ 정적 서빙 (catch-all)
│     └─ routes/          리소스별 라우터 (graph, proposals, reviews, dashboard, planned)
├─ web/                   ← 이동됨(구 selfheal/): 무빌드 React 목업 UI
│  ├─ index.html          CDN React+Babel, *.jsx 로드
│  ├─ app.jsx             셸(사이드바/탑바/라우터)
│  ├─ page-*.jsx          8 페이지
│  ├─ mock.jsx / mock-extras.jsx   목업 데이터 (배선 시 /api로 교체 대상)
│  └─ styles.css, ui.jsx, overlays.jsx, icons.jsx, tweaks-panel.jsx
├─ scripts/               실행 스크립트 (migrate, seed, run-corpus, insight, graphify-scan)
│  ├─ ui-server.ts        구 React Flow 그래프 뷰 (개발자용, 유지)
│  └─ serve.ts            ← 제품 UI 부트스트랩 (Hono 앱을 @hono/node-server로 기동)
└─ test/
```

> **단일 패키지 유지** 결정: 지금 단계에선 apps/packages 분리(모노레포)는 오버엔지니어링. UI는 무빌드라 자체 빌드 의존이 없고, API(Hono)는 기존 `src/`를 그대로 import한다. SaaS/멀티테넌시가 현실이 되면 그때 분리.
>
> **프레임워크 결정**: API 표면만 **Hono**(얇음). 배치 레이어는 프레임워크 없이 모듈+CLI. 무거운 앱 프레임워크(NestJS) 배제. 오케스트레이션은 무인 루프 필요 시 pg-boss(기존 Postgres 재사용)로. — 상세 §3.3.

---

## 5. 실행 (scripts)

| 명령 | 하는 일 |
|---|---|
| `npm run db:up` / `db:migrate` / `db:reset` | Postgres+pgvector(Docker, 5433) 기동/마이그레이션/리셋 |
| `npm run graphify:scan` | 대상 repo 스캔 → 코드 지도 적재 (`GRAPHIFY_ENRICH=1`로 LLM enrich) |
| `npm run run:corpus` | 코퍼스 리뷰를 Processing 파이프라인에 통과 (funnel + §8 metrics) |
| `npm run insight` | 신호 → proposal 생성 |
| `npm run ui` | 구 React Flow 개발자 뷰 (`ui-server.ts`) |
| `npm run serve` | ← 신규: 제품 UI (`web/`) + `/api` |
| `LLM_CLIENT=claude-cli …` | 구독 Claude(headless, 추가과금 0) 사용. 기본은 `stub`(키 0) |

비용 제약(메모리 [[api-key-after-subscription]]): 구독 소진 전까지 실 API(`anthropic`) 켜지 않음. 개발 기본은 `stub`.

---

## 6. 배선 로드맵 (하나씩 쌓기)

골격(이 작업) → 페이지별 live 승격 순서. 백엔드가 이미 있는 것부터:

1. **골격** (이번): `web/`로 이동, `docs/architecture.md`, `src/api/contract.ts`, `scripts/serve.ts`(정적 서빙 + 라우트 스텁).
2. **Processing 페이지 live** — `/api/graph` ← `feature_registry` 트리 + gap (기존 buildGraph 이식). 코드 지도가 제품의 핵심 시각화.
3. **Insights 페이지 live** — `/api/proposals` ← `proposals`. 승인/거절 액션은 후속(HITL 상태 테이블).
4. **Reviews 페이지 live** — `/api/reviews` ← `processed_reviews`. feature 매핑·신호 배지 포함.
5. **Dashboard 부분 live** — funnel/category는 집계로, activity는 audit 레이어 대기.
6. **Ingestion(레이어1)** — `sources`/`raw_reviews` 테이블 + 첫 커넥터 → Sources 페이지 live, corpus 대역 축소.
7. **Auto-Dev(레이어5)** — `agent_runs` + 승인 proposal 소비 → Agents 페이지 live.
8. **Audit** — `audit_events` → Activity 페이지 + Dashboard activity live.

각 단계는 독립 커밋. UI는 mock fallback이 있어 미배선 페이지도 안 깨진다.

---

## 7. 열린 질문

1. **승인(HITL) 상태 저장** — proposal 승인/거절을 `proposals.status`에 둘지 별도 `proposal_reviews` 테이블에 둘지. Slack 연동 시점.
2. **실시간성** — Auto-Dev 진행(AGENTS의 steps/progress)은 polling vs SSE/WebSocket. 골격은 polling 가정.
3. **멀티테넌시** — `targetRepo` 단일 → 여러 제품. UI 상단 repo 스위처 + 모든 쿼리 repo 스코프(이미 대부분 됨).
4. **인증** — 목업의 user-chip은 가짜. 실제 배포 시 auth 레이어 필요(범위 밖, 후속).
