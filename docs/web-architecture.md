# selfheal web/ — 프론트엔드 아키텍처 설계

> 버전: v0.1 (draft, **논의용 — 동결 아님**) · 대상 독자: UI 개발자 + 백엔드 배선 담당
>
> 이 문서는 [architecture.md](./architecture.md)(우산)의 **§3 UI↔백엔드 컨트랙트 / §7 열린 질문**을 프론트엔드 관점에서 구체화한다. 화면별 기능 인벤토리는 [ui-feature-matrix.md](./ui-feature-matrix.md)에 있다. 여기서는 **(1) 상태/스토어, (2) 데이터 레이어(mock→API), (3) 라우팅, (4) 보안** 네 뼈대의 목표 구조와 단계적 도입 순서를 정의한다.
>
> **한 줄 정의**: 현재 `web/`는 *시각 완성도 높은 목업 셸*이다. "앱"으로 가려면 비어 있는 뼈대 4개를 채워야 하고, 그 순서와 경계를 여기서 못 박는다.

---

## 0. 현재 상태 (코드 기준 진단)

| 뼈대 | 현재 구현 | 위치 | 문제 |
|---|---|---|---|
| **라우팅** | `route`가 `App`의 `useState<Route>` | `web/src/app.tsx:178` | URL 동기화·딥링크·뒤로가기·새로고침 유지 전부 안 됨. 공유 링크 불가 |
| **전역 상태** | `window` CustomEvent 버스 (`selfheal:toggle-theme`, `selfheal:open-wizard`) + 오버레이만 Context | `app.tsx:187-198`, `overlays.tsx` | 전역 상태가 이벤트버스에 흩어짐. 디버깅·테스트·확장 어려움 |
| **데이터 레이어** | 각 페이지가 `data/mock.ts`를 직접 import | `pages/*.tsx` | 로딩/에러/빈/스켈레톤 상태 부재. 캐싱·재검증 없음. mock→API 스왑 지점이 페이지마다 흩어짐 |
| **인증/권한** | 사용자 "Maya Ortiz" admin 하드코딩 | `app.tsx:123-130` | 식별·권한 경계 없음. 승인/거절 등 권한 액션이 무방비 |

**설치 현황** (`web/package.json`): React 19 · Vite 8 · TS 6 · @xyflow/react · @dagrejs/dagre · Playwright. **라우터·스토어·데이터페칭 라이브러리 없음.**

긍정 신호: XSS 진입점 없음(`dangerouslySetInnerHTML` 0건), 고비용 액션에 confirm 다이얼로그 있음, 오버레이 Context 패턴 정착, 감사로그 페이지 존재.

---

## 1. 상태/스토어 설계

### 1.1 상태 3분류

상태를 성격별로 나눠 각각 다른 도구로 관리한다(한 통에 다 넣지 않는다).

| 분류 | 예시 | 도구 | 이유 |
|---|---|---|---|
| **Server state** | reviews, proposals, graph, agents, dashboard 집계 | **TanStack Query** (§2) | 캐싱·재검증·로딩/에러·낙관적 업데이트가 본질. 직접 만들면 버그 양산 |
| **Client/UI state** | theme, route(라우터로 이관), 선택된 노드, 필터, 오버레이 | **Zustand** (단일 스토어, 슬라이스) | 가볍고 리렌더 정밀 제어. Context 리렌더 비용·Redux ceremony 둘 다 회피 |
| **Ephemeral state** | 입력값, 토글, 호버 | 컴포넌트 `useState` | 전역화 불필요 |

> **Zustand 선택 근거**: 규모(8 페이지)에 Redux는 과함, Context는 구독 단위가 거칠어 그래프 같은 무거운 트리에서 리렌더 폭발. Zustand는 selector 단위 구독 + provider 없이 import, 번들 ~1KB. 이벤트버스(`CustomEvent`)를 스토어 액션으로 대체하면 `global.d.ts`의 WindowEventMap 해킹도 제거된다.

### 1.2 스토어 슬라이스 (제안)

```
web/src/store/
├─ index.ts        // create() + 슬라이스 합성
├─ ui.slice.ts     // theme, overlay 열림상태, 선택/필터 (route는 라우터로)
├─ session.slice.ts// user, org, role, 권한 플래그 (현재 mock, §4에서 실연결)
└─ selectors.ts    // 파생 selector (권한 체크 등)
```

서버 데이터는 스토어에 **넣지 않는다** — Query 캐시가 단일 진실원천. 스토어는 "지금 어떤 노드를 골랐나" 같은 *뷰 상태*만.

### 1.3 이벤트버스 → 스토어 마이그레이션

- `selfheal:toggle-theme` → `useUiStore(s => s.toggleTheme)`
- `selfheal:open-wizard` → `useUiStore(s => s.openWizard)` (or 라우터 모달 route)
- `global.d.ts`의 커스텀 WindowEventMap 선언 제거.

---

## 2. 데이터 레이어 (mock → /api)

### 2.1 목표 — 스왑 지점을 한 곳으로

현재 `import { RAW_REVIEWS } from '../data/mock'`가 페이지마다 박혀 있다. 이걸 **fetcher + 훅 한 층** 뒤로 숨겨, 페이지는 `useReviews()`만 호출하게 한다. mock→API 전환이 *fetcher 한 군데* 교체로 끝난다.

```
web/src/api/
├─ client.ts       // fetch 래퍼 (baseURL, 에러 정규화, source:'live'|'mock' 플래그 인지)
├─ keys.ts         // queryKey 팩토리
└─ hooks/
   ├─ useReviews.ts // useQuery → GET /api/reviews  (fallback: mock)
   ├─ useGraph.ts   // GET /api/graph
   ├─ useProposals.ts
   └─ ...           // architecture.md §3.1 매핑과 1:1
```

- 각 훅은 `architecture.md §3.1`의 페이지↔엔드포인트 매핑과 1:1.
- 백엔드 미구현 라우트는 서버가 `source:'mock'`인 mock-shaped JSON을 주므로(§3.2 컨트랙트 원칙) UI는 안 깨진다. 훅은 `source`만 보고 "목 데이터" 배지를 띄울 수 있다.
- **컨트랙트 단일 진실원천**: `src/api/contract.ts`(백엔드)와 `web/src/data/mock.ts`의 export 타입이 같아야 한다. → **검수 때 발견한 드리프트(GraphData 노드 shape, `f:`/`g:` ID 접두사, `Source.status` `'err'`vs`'error'`, AuditEvent shape)를 이 단계에서 정합화**한다.

### 2.2 로딩/에러/빈 상태

목업엔 없는 3대 상태를 컴포넌트 레벨에서 표준화:
- **Skeleton** — 리스트/카드용 스켈레톤 컴포넌트 (이미 있는 `.list`/`.card` 토큰 재사용).
- **Error** — 재시도 버튼 + `source` 표기. 토스트(이미 있음)와 연동.
- **Empty** — "아직 데이터 없음" + CTA(예: Sources에서 소스 추가).

### 2.3 쓰기(mutation)

승인/거절·소스추가는 `useMutation` + 낙관적 업데이트 + 롤백. **단, 클라 낙관성은 UX일 뿐 — 권한·영속화는 서버가 진실**(§4.3, architecture.md §7.1 HITL 상태저장 결정 대기).

---

## 3. 라우팅

- **도입**: React Router(또는 TanStack Router). `Route` 유니온 타입을 URL 경로에 매핑.
- **딥링크**: `/reviews/:id`, `/insights/:proposalId`, `/processing?node=t_ko` — 리뷰·제안·그래프 노드를 공유 링크로 열기. (현재 최대 갭)
- **부수효과**: `app.tsx`의 `route` state + 상당수 이벤트버스 제거. 오버레이 일부는 모달 route로 승격 가능.
- **코드 스플릿**: 이미 ProcessingPage가 `React.lazy`(ReactFlow ~200KB). 라우터 도입 시 라우트 단위 lazy로 일반화.

---

## 4. 보안

> **핵심 인식**: 이건 일반 대시보드가 아니라 **자율 에이전트가 대상 repo에 PR을 여는 control plane**이다. 보안 표면이 SaaS 평균과 다르다. (architecture.md §7.4: 인증은 "후속"으로 미뤄져 있음 — 배포 전 반드시 닫아야 할 항목)

### 4.1 권한 경계 (최우선)

"제안 승인 → Auto-Dev 실행 → PR 생성"은 **돈(LLM ~$3)과 코드 변경**을 유발한다. 현재는 클라이언트 버튼 게이팅뿐.
- **인증** — 실제 신원(OIDC/세션). user-chip 하드코딩 제거.
- **RBAC** — `viewer`(읽기) / `reviewer`(승인·거절) / `admin`(소스·설정·큐 제어). `session.slice`에 role, selector로 UI 게이팅.
- **서버측 인가** — 클라 게이팅은 UX, 진짜 결정은 **서버가 토큰/role 재검증**. 승인·재생성·큐일시정지 라우트는 서버에서 권한+레이트리밋 체크.
- **감사** — 누가 무엇을 승인했나. Activity 페이지/`audit_events`와 연결(architecture.md 배선 §8).

### 4.2 신뢰불가 UGC (XSS)

리뷰는 App/Play Store·Reddit·X에서 긁어온 **신뢰불가 텍스트**다.
- **현재 안전**(`dangerouslySetInnerHTML` 0건) — React 기본 이스케이프에 의존 중. **이 불변식을 유지**한다: 리뷰/제안 본문에 `dangerouslySetInnerHTML` 금지. 마크다운 렌더가 필요하면 sanitizer(DOMPurify) 경유 필수.
- 제안 본문(`proposals.body`가 issue 초안 md)을 렌더할 때 특히 주의 — md→HTML 경로가 생기면 sanitize.

### 4.3 시크릿 & 전송 경계

- **API 키는 SPA 번들에 절대 미포함** — 서버측 유지. (메모리 [[api-key-after-subscription]] 원칙과 동일선상: 키는 클라에 노출 0)
- Anthropic/소스 자격증명, GitHub 토큰 전부 서버. 클라는 세션 쿠키(httpOnly)만.
- **CSP 헤더**(Hono 미들웨어) — `script-src 'self'`, inline 차단. + `X-Frame-Options`/`frame-ancestors`로 clickjacking 차단(승인 버튼이 있으니 중요).

### 4.4 고비용/파괴적 액션

- confirm 다이얼로그 이미 있음(Regenerate insights, Pause queue) — 유지.
- **서버 레이트리밋** — "Regenerate insights"는 비용 발생. 클라 디바운스 + 서버 레이트리밋 이중.

---

## 5. 단계적 도입 순서

architecture.md §6 백엔드 배선 로드맵과 맞물리게:

1. **데이터 레이어 골격** — `web/src/api/client.ts` + 훅 한 개(useGraph 또는 useReviews)로 패턴 확립. mock fallback 유지. **컨트랙트 드리프트 정합화**(§2.1).
2. **스토어 도입** — Zustand `ui`/`session` 슬라이스. 이벤트버스→액션 마이그레이션, `global.d.ts` 정리.
3. **라우팅** — URL 동기화 + 딥링크. `route` state 제거.
4. **로딩/에러/빈 상태** — 표준 컴포넌트, 모든 훅에 적용.
5. **인증/RBAC(클라)** — `session.slice` + UI 게이팅. (서버측 인가는 백엔드 auth 레이어와 동시.)
6. **보안 하드닝** — CSP/프레임 헤더(Hono), sanitize 경로 점검, 레이트리밋.

> 각 단계 독립 커밋. 1·2는 기능 변화 없이 내부 구조만 — 회귀 위험 낮음. 5·6은 백엔드 auth 레이어 존재가 전제(architecture.md §7.4).

### 5.1 진행 상황 + 다음 웨이브 (백엔드 contract reconciliation)

**완료** (mock-phase, 독립 검수 통과): §5의 1~4 + 5의 클라 RBAC가 구현됐다. TanStack Query 데이터 seam(`web/src/api/`), Zustand 스토어(`web/src/store/`), TanStack Router 딥링크(`web/src/router.tsx`), 이벤트버스 제거, route-level lazy(번들 분할), 로딩/에러/빈 상태, Playwright 19 케이스. 빌드/타입체크/E2E 그린.

**다음 웨이브 — `live` 라우트의 백엔드 핸들러를 정합화된 contract에 맞춘다.** 이번에 `src/api/contract.ts` ↔ `web/src/data/mock.ts`는 맞췄지만, 이미 `status:'live'`로 표시된 두 라우트의 **실제 Hono 핸들러는 아직 contract와 어긋난다**(핸들러가 DB row를 `any`로 타이핑해 contract가 강제되지 않은 탓):

- **S1 — `/api/graph`** (`src/api/routes/graph.ts`): contract는 평문 ID(`t_ko`)·`data:{label,kind,heat,isOrphan}`·색 없음(프론트가 CSS var로 테마)을 선언하나, `buildGraph`는 여전히 `f:`/`g:` 접두사 ID·`data:{label}`만·인라인 hex 색(`#0b3a52`…)을 방출한다. → `buildGraph`를 contract 모양으로 수정.
- **S1 — `/api/reviews`** (`src/api/routes/reviews.ts`): 핸들러가 방출하는 `RawReviewRow`와 페이지/`mock-extras`가 소비하는 `RawReview`(`author,country,priority,when,confidence,mapped,…`)가 거의 disjoint. → 핸들러를 mock 모양으로 정렬.
- **S2 — 그래프 shape 단일화 (결정됨)**: canonical = **백엔드는 도메인 데이터를 주고, 클라가 레이아웃을 소유**한다. 즉 `/api/graph`는 `{ modules: RepoModule[], reviews: Record<id, GraphReview[]> }`(= `useGraph`의 `GraphPayload`)를 반환하고, ReactFlow 노드/엣지·dagre 배치는 `processing.tsx`의 `buildGraph`가 클라에서 만든다. 근거: 레이아웃은 표현(presentation) 관심사라 서버에 두면 결합이 늘고, Wave 1A의 `useGraph`가 이미 이 모양을 가정한다. → contract의 ReactFlow `GraphData`/`GraphNode`/`GraphEdge`를 **도메인 타입(`RepoModule`/`GraphReview`)으로 교체**하고 `buildGraph` 핸들러를 거기에 맞춘다(hex 색·`f:`/`g:` 접두사·노드 좌표 전부 제거).

> 즉 "플래그 한 줄로 live 스왑"이 graph/reviews에서는 핸들러를 먼저 고쳐야 성립한다. 그 전까지 두 라우트는 사실상 mock-only로 본다.

**그 뒤** — N3(insights 딥링크 재네비 동기화), N4(`useMutation`+낙관적 롤백)은 백엔드 쓰기(HITL §7.1) 배선 시점에 함께.

---

## 6. 결정 필요 (열린 질문)

1. **라우터 선택** — React Router(생태계 표준) vs TanStack Router(타입세이프·Query와 한 팀). 후자가 Query 도입과 시너지.
2. **스토어** — Zustand로 확정? (대안: Jotai 원자 모델, 또는 Context 유지) — 본 문서는 Zustand 가정.
3. **인증 방식** — OIDC 제공자(누구?) vs 자체 세션. architecture.md §7.4와 함께 결정. 배포 시점 의존.
4. **HITL 승인 영속화** — architecture.md §7.1 미해결(`proposals.status` vs 별도 테이블). 데이터 레이어 mutation 설계가 여기 의존.
5. **mock fallback 유지 기간** — 전 페이지 live 후 mock 제거 vs 데모용 유지.
