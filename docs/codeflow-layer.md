# CodeFlow Layer 설계 (Codebase Ingestion & Self-Evolving Graph)

> 버전: v0.1 (draft, **논의용 — 동결 아님**) · 대상 독자: selfheal Processing Layer / Insight & Proposal / Auto-Dev 개발자
>
> **명칭**: 구 codename "graphify" → **CodeFlow**로 변경 (외부 codegraph/graphify류 도구와 구분 — 우리만의 이해·구현이라는 정체성). 아래에서 "graphify"라는 단어가 남아 있으면 그건 **외부 prior-art 도구**를 가리킨다.
>
> 위치: selfheal의 **연계 레이어**. Processing Layer가 "리뷰 → 코드 행동 신호"를 만든다면, CodeFlow는 그 신호가 **착지할 코드 지도(map)** 를 만든다. 둘은 공유 테이블 `code_artifact_registry`(+ 신규 `code_edges`)로만 연결된다 — 컨트랙트 결합, 코드 결합 아님.
>
> **설계 1원칙 (비용)**: 외부 graphify류 도구(prior-art)를 ~2000줄 repo에 돌렸을 때 Claude Max 5x 한도를 전부 소진했다. 원인은 "**노드마다 LLM 요약**". 우리 목표는 "LLM을 쓰지 말자"가 아니라 "**풀패스는 무조건 돌리되 토큰을 줄이자**"(Max 구독 있음).
>
> **핵심 통찰**: 우리가 CodeFlow에서 원하는 건 **요약이 아니라 매핑**이다. 매핑은 `affected_area`(자연어) ↔ artifact **임베딩 코사인**으로 일어난다. artifact 임베딩을 LLM 요약문이 아니라 **결정론적으로 추출한 텍스트**(path + module + symbol + 시그니처 + 인접 docstring/주석)로 만들면, 풀패스의 Claude 토큰은 ≈ 0이 된다(임베딩은 embedder 호출이라 Claude 토큰을 안 쓴다). → **노드별 LLM 요약은 기본적으로 안 한다.** Claude/Max 토큰은 결정론 텍스트가 빈약한 곳(docstring 없음·이름 난해·high-risk)에만 **선택적으로** description을 붙이는 데 쓴다. version-aware 캐시·증분 철학은 Processing Layer에서 계승.

---

## 0. 구현 현황 — codeflow는 `seed-registries.ts`의 자동화다

`../scripts/seed-registries.ts`(selfheal main)가 이미 **codeflow의 손코딩 스텁**이다. 하드코딩된 `CODE[]` 배열 6건을 돌면서 정확히 이렇게 한다:

```ts
const emb  = await embedder.embed([c.path, c.module, c.symbol ?? '', c.desc].join(' ')); // ← T4a 카드 임베딩
const risk = classifyCodeRisk(c.path, c.module, c.symbol, c.desc);                        // ← T2 risk
// INSERT ... code_artifact_registry ... ON CONFLICT (repo,path,symbol) DO UPDATE          // ← upsert
```

→ **codeflow가 새로 할 일은 단 하나: 하드코딩된 `CODE[]`를 실제 repo 자동 추출로 대체**하는 것. 다운스트림(카드 임베딩·risk·feature 링크·upsert·`mapCodeArtifacts` 소비)은 전부 이미 동작한다. 즉 codeflow는 `T0~T3 + 카드 생성`만 새로 만들면 되고, 나머지는 기존 코드 재사용.

**재사용할 기존 자산** (바퀴 재발명 금지):
- `makeEmbeddingClient()` (`src/clients/embedding/index.ts`) — embedder DI. `embed(text)→{vector,dim:1536}`. local-hash(기본)/cohere.
- `classifyCodeRisk(path,module,symbol,desc)` (`src/util/code-risk.ts`) — T2 그대로.
- `code_artifact_registry` 스키마 + `Db.codeMatchByFeatures/codeMatchByVector` — 소비자 live.
- 마이그레이션 러너(`scripts/migrate.ts`, `*.sql` 이름순·idempotent) — codeflow 마이그레이션은 **`004_codeflow.sql`** (003_observability까지 존재).
- 검증 하니스: `npm run verify` = migrate→seed→run-corpus. codeflow는 `seed` 자리를 대체/보강.

> ⚠️ Phase 2(`aggregateSignal`/reconciliation)는 **이미 구현됨**. `signal_groups.code_artifact_ids` 소비자가 live이므로 codeflow 출력이 그쪽에도 바로 흘러간다.

---

## 1. 목적과 책임

### 1.1 무엇을 만드나
대상 repo(GitHub) 하나를 받아, 그 코드베이스를 **질의 가능한 아티팩트 그래프**로 변환한다:
- **노드** = code artifact (파일 / 모듈 / 심볼). `code_artifact_registry` 행.
- **엣지** = 구조 관계 (containment, import, (선택)call). `code_edges` 행.
- **속성** = owners(CODEOWNERS), risk_tier(경로 휴리스틱), feature_ids 역링크, (선택)description+embedding.

이 그래프가 있어야 Processing Layer의 `mapCodeArtifacts`(spec §4.7b)가 defect를 **실제 코드 위치에 grounding** 할 수 있다. 지금은 이 테이블이 **비어 있어서** 코드 매핑이 항상 빈 배열을 반환한다. codeflow가 그 producer다.

### 1.2 "self-evolving"의 의미
repo는 살아 움직인다(커밋마다 변함). codeflow는 **증분 재수집**으로 그래프를 repo와 동기화한다:
- 변경된 파일만 재파싱, 변경된 아티팩트만 재임베딩 (content-hash diff).
- 삭제된 심볼은 `is_active=false` (행 삭제 아님 — 과거 신호의 provenance 보존).
- 이 루프가 곧 "코드베이스가 스스로 진화하면 지도도 따라 진화" → orca식 self-evolving의 토대.

### 1.3 책임이 아닌 것 (경계)
- 리뷰 처리 / 클러스터링 → Processing Layer.
- 우선순위 / 제안 / PR 사양 → Insight & Proposal Layer.
- PR 생성 / 코드 수정 → Auto-Dev Layer.
- codeflow는 **읽기 전용 분석**만 한다. repo에 쓰지 않는다.

---

## 2. 입력 컨트랙트: `RepoTarget`

```ts
interface RepoTarget {
  tenant_id: string;          // SaaS 멀티테넌시 (§7) — v0.1은 'default' 고정 가능
  repo: string;               // 'org/app-ios'
  ref: string;                // 커밋 SHA 또는 브랜치 (재현성 위해 resolve된 SHA 권장)
  clone_url?: string;         // 비공개 repo면 토큰 포함 URL (Ingestion이 주입)
  languages?: string[];       // 파싱 대상 한정 ('ts','swift','kotlin'...). 미지정=자동감지
  include?: string[];         // glob — 기본 src/**
  exclude?: string[];         // glob — node_modules/**, dist/**, *.test.* 등
  max_file_bytes?: number;    // 거대/생성 파일 컷 (비용·노이즈 보호)
}
```

**불변식**
- `(tenant_id, repo)`가 한 코드베이스. `ref`는 수집 시점 스냅샷.
- 빈/바이너리/생성 파일은 Tier 1에서 거른다 (funnel — Processing의 prefilter와 같은 직관).

---

## 3. 출력 컨트랙트

### 3.1 `code_artifact_registry` (기존 테이블, codeflow가 채움)
```
repo, path, module, symbol, owners[], feature_ids[],
description, embedding(1536), risk_tier, risk_score,
is_active, updated_at  · UNIQUE(repo, path, symbol)
```
- **임베딩 공간은 review embedder와 반드시 동일**해야 한다 (`config.embeddingClient`: `local-hash` 또는 `cohere` 1536). 그래야 `affected_area ↔ artifact` 코사인이 성립. → codeflow는 embedder를 **DI로 주입받고 직접 고르지 않는다**. (하드 제약)
- `feature_ids`: feature ↔ 코드 역링크. v0.1은 비워두고(빈 배열), 매핑은 후속 tier 또는 운영자/Insight가 채움.

### 3.2 `code_edges` (신규 테이블, §5)
구조 그래프. v0.1 필수는 containment(file→symbol, module→file)와 import. call 그래프는 선택(언어별 비용 큼).

### 3.3 `codeflow_runs` (신규, 관찰가능성/멱등성)
수집 1회 = 1 run. 어떤 ref를 언제, 몇 노드/엣지, LLM 토큰 얼마, 무엇이 changed/deleted 됐는지. Processing의 `ProcessOutcome`/funnel과 같은 역할.

---

## 4. 파이프라인 — **결정론 우선, LLM은 마지막·선택**

```
 RepoTarget
    │
    ▼
 [T0 acquire]    shallow clone / GitHub tree API          (LLM 0)
    │
    ▼
 [T1 parse]      tree-sitter → files·modules·symbols       (LLM 0)   ← 노드의 90%
    │            content_hash 계산 (증분 키)
    ▼
 [T2 attribute]  CODEOWNERS→owners · path휴리스틱→risk      (LLM 0)
    │            git log→churn (선택)
    ▼
 [T3 edges]      AST → contains·imports·calls → code_edges  (LLM 0)
    │            call 그래프 포함 (언어별 resolver)
    ▼
 [T4a embed]     결정론 "artifact card" 임베딩                (Claude 0)
    │            card = path+module+symbol+시그니처+docstring   ← 풀패스 항상
    ▼
 [T4b describe]  LLM description (선택·high-value만)          (Claude 토큰)
    │            결정론 텍스트 빈약/high-risk artifact에만 → 재임베딩
    ▼
 [persist]       registry upsert + edges + run 기록 + is_active 정리
```

**funnel/비용 직관**: T0~T3 + **T4a까지 전부 Claude 토큰 0** (T4a 임베딩은 embedder 호출). 노드 전부가 여기서 만들어지고 매핑 가능 상태가 된다. Claude 토큰은 **T4b에서만**, 그것도 결정론 카드가 빈약한 소수 artifact에 한해 쓴다 + 증분(변경분만) + 배치. → 2000줄이 Max를 태우던 "노드마다 요약" 구조를 "풀패스는 토큰 0, 토큰은 매칭이 약한 곳에만 핀포인트"로 바꾼다.

### T0 `acquire` — 결정론
- shallow clone(`--depth 1 --filter=blob:none`) 또는 GitHub tree+blob API. 토큰은 Ingestion이 주입.
- `ref`를 SHA로 resolve해 run에 박는다 (재현성).

### T1 `parse` — 결정론 (핵심)
- **tree-sitter** 다언어 파싱 → 함수/클래스/메서드/export 단위 심볼 추출. 언어 미지원 시 **파일 단위로 degrade**(symbol=NULL).
- 각 아티팩트에 `content_hash = hash(path + symbol + 본문)` → 증분 diff 키.
- include/exclude·max_file_bytes·바이너리 필터로 노이즈 컷.
- 산출: `(repo, path, module, symbol)` 후보 행들.

### T2 `attribute` — 결정론
- `CODEOWNERS` 파싱 → glob 매칭으로 `owners[]`.
- 경로 휴리스틱 → `risk_tier`/`risk_score`. **`src/util/code-risk.ts` 이미 존재 → 그대로 이식**(결제/인증 경로=critical 등). selfheal의 002_code_risk 마이그레이션과 동일 사전.
- (선택) `git log` 빈도 → churn 점수 (Insight 우선순위 가중용, 후속).

### T3 `edges` — 결정론 (call 포함)
- AST → `contains`(모듈→파일, 파일→심볼) · `imports`(import/require/use) · **`calls`(심볼→심볼)** 엣지.
- call 그래프는 **언어별 resolver**가 필요(같은 이름 해소 비용이 언어마다 다름) → 첫 타깃 언어부터 구현하고 미지원 언어는 calls 생략(contains/imports로 degrade).
- impact 질의("이 심볼을 건드리면 영향받는 곳")는 calls 엣지 역방향 순회로 제공 → Auto-Dev 입력. (call 그래프를 v0.1에 넣는 이유)

### T4a `embed` — 결정론 카드 임베딩 (Claude 토큰 0, **풀패스 항상**)
- **artifact card**(결정론 추출) = `path + module + symbol + 시그니처 + 인접 docstring/주석`. LLM 요약 아님.
- 이 카드를 `code_artifact_registry.embedding(1536)`에 임베딩. **review embedder와 동일 클라이언트 강제**(DI 주입) — affected_area(자연어)와 같은 공간이라야 코사인 매칭 성립.
- 임베딩은 embedder(Cohere/local) 호출 → **Claude 토큰 안 씀**. 풀패스 비용은 사실상 embedder API 비용뿐.
- **증분**: `content_hash` 안 바뀐 artifact는 재임베딩 skip. `enrich_version` bump 시 전체 무효(version-aware 캐시 동형).

### T4b `describe` — LLM **선택·핀포인트** (유일한 Claude 토큰 지점)
- **언제만**: T4a 카드가 빈약할 때 — docstring 없음 + 심볼명이 난해(`fn a1`, `handler2`) → 자연어 매칭이 약한 artifact. 또는 high `risk_tier`/public API처럼 매칭 정확도가 중요한 소수.
- LLM이 1~2줄 description 생성 → 카드에 합쳐 **재임베딩**(다시 embedder, Claude 토큰은 description 생성에만).
- **토큰 절감**: 전체가 아니라 "약한 노드"에만, 증분(변경분만), Batch/claude-cli 다발. 기본 enrich_mode는 풀패스(T4a)이고 T4b는 그 위에 선택적으로 얹힘.

> ⚠️ **embedder별 카드 매칭 현실** (seed-registries에서 확인): 기본 embedder는 `local-hash`(char 3-gram, **어휘적**)다. seed의 `desc`가 한국어("결제 화면, 결제 버튼")인 이유 — 한국어 리뷰의 `affected_area`와 **어휘가 겹쳐야** 코사인이 붙기 때문. 그런데 실제 TS repo의 결정론 카드는 **영어**(path/symbol/docstring)다. → **local-hash + 교차언어(영어 코드 ↔ 한국어 리뷰)에선 T4a 카드만으론 매칭이 약하다.** 이때 둘 중 하나 필요:
> - **(a) `cohere`로 전환** — embed-multilingual-v3는 교차언어 의미 매칭이 됨. 풀패스 토큰 0 유지(Claude 아님). **권장 1순위.**
> - **(b) T4b LLM desc** — 카드에 리뷰 언어(예: 한국어) description을 붙여 어휘를 맞춤. local-hash를 유지해야 할 때.
>
> 즉 "풀패스 토큰 0으로 매칭 작동"은 **embedder가 교차언어 의미를 잡거나(코히어), 코드와 리뷰 언어가 같을 때** 성립. local-hash dogfooding(영어 selfheal repo)에선 매칭 검증용으로 충분하나, 한국어 리뷰 운영엔 (a) 또는 (b)가 전제.

---

## 5. 데이터 모델 (신규분만)

```sql
-- 구조 그래프 엣지
CREATE TABLE code_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo        text NOT NULL,
  src_id      uuid NOT NULL REFERENCES code_artifact_registry(id) ON DELETE CASCADE,
  dst_id      uuid NOT NULL REFERENCES code_artifact_registry(id) ON DELETE CASCADE,
  kind        text NOT NULL,            -- 'contains' | 'imports' | 'calls'
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src_id, dst_id, kind)
);
CREATE INDEX ON code_edges (src_id, kind);
CREATE INDEX ON code_edges (dst_id, kind);

-- 수집 run (멱등성 · 관찰가능성)
CREATE TABLE codeflow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL DEFAULT 'default',
  repo          text NOT NULL,
  ref           text NOT NULL,           -- resolved SHA
  status        text NOT NULL DEFAULT 'running',  -- running|done|failed
  nodes_total   integer,
  nodes_changed integer,
  nodes_deleted integer,
  edges_total   integer,
  llm_tokens    integer NOT NULL DEFAULT 0,
  enrich_mode   text NOT NULL DEFAULT 'stub',     -- stub|claude-cli|anthropic
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX ON codeflow_runs (repo, started_at DESC);
```

> `code_artifact_registry`에는 `content_hash text`와 `tenant_id text DEFAULT 'default'` 컬럼 추가 필요(증분·멀티테넌시). selfheal 쪽 마이그레이션 **`004_codeflow.sql`**(003_observability까지 존재)로 ALTER. 러너는 `*.sql` 이름순·idempotent라 IF NOT EXISTS로 작성.

---

## 6. 외부 graphify(prior-art)에서 — 가져올 것 / 새로 만들 것

| 영역 | 결정 | 이유 |
|---|---|---|
| 그래프 모델(노드/엣지) | **가져옴** (개념) | 검증된 표현. 단 우리 `code_artifact_registry` 스키마에 맞춤. |
| tree-sitter 파싱 | **가져옴** | 결정론·다언어. T1 핵심. |
| 노드별 LLM 요약 | **버림** | 비용 원흉이고 우리는 요약이 아니라 매핑이 목적. 결정론 카드 임베딩으로 대체, LLM은 약한 노드에만(T4b). |
| 임베딩 모델 선택 | **새로 만듦** | 그 도구 자체 모델 대신 **review embedder 강제 공유**(공간 일치 하드 제약). |
| 증분 content-hash | **새로 만듦** | self-evolving 루프. Processing의 input_hash 패턴 이식. |
| risk/owners | **이식** | `code-risk.ts` + CODEOWNERS 이미 selfheal에 있음. |
| 출력 저장소 | **새로 만듦** | 그 도구 자체 store 대신 selfheal Postgres+pgvector. |

---

## 7. 결정 / 열린 질문

**결정됨**
- ✅ **call 그래프 v0.1 포함** (contains+imports+calls). 언어별 resolver, 첫 타깃 언어부터.
- ✅ **풀패스(T4a)는 무조건 실행**, Claude 토큰 0. LLM(T4b)은 매칭 약한 노드에만 핀포인트 — "안 쓰자"가 아니라 "줄이자".
- ✅ **첫 타깃 언어 = TypeScript/JS.** selfheal 자체가 TS → **dogfooding**(우리 repo로 e2e). TS의 tree-sitter·import 해소가 성숙해 call resolver 착수도 최단.

**아직 열림**
1. **dogfooding embedder** — TS selfheal repo로 e2e 시 local-hash면 영어 카드 ↔ 한국어 코퍼스 매칭이 약함(위 T4b 경고). MVP 매칭 검증을 영어 리뷰로 할지, 처음부터 cohere로 갈지.
2. **멀티테넌시 시점** — `tenant_id`를 v0.1부터 모든 테이블에 박을지(백필 회피) vs SaaS 직전에 도입할지. 권장: **컬럼만 지금**(DEFAULT 'default'), 격리 정책은 후속.
3. **code → feature_ids 자동 링크** — seed는 손으로 slug 매핑. 자동화 시 카드↔feature_registry 임베딩 매칭(`featureVectorMatch` 재사용)? 아니면 비워두고 semantic_match만 의존? (mapCodeArtifacts는 feature_ids 없이도 작동하므로 블로커 아님)
4. **T4b "약한 노드" 판정 기준** — docstring 부재 + 심볼명 엔트로피? risk_tier? 임계값은 첫 repo로 캘리브레이션.
4. **codeflow worktree ↔ selfheal main** — 코드/마이그레이션은 결국 selfheal src·db에 통합돼야 하는데(공유 테이블), 현재 codeflow 브랜치엔 src가 없음. 통합 지점/순서 정의 필요.

---

## 8. 다음 단계 (제안)
1. §7 열린 질문 합의 → 이 문서 v0.2 동결.
2. `004_codeflow.sql` 마이그레이션 (code_edges, codeflow_runs, registry에 content_hash·tenant_id ALTER, IF NOT EXISTS).
3. **codeflow ingest 스크립트 = `seed-registries.ts`의 자동화판**: TS repo를 T0~T3 파싱 → T4a 카드를 기존 embedder/risk/upsert 경로로 적재. `CODE[]` 하드코딩 제거. `npm run verify`의 seed 자리에 끼움 → `mapCodeArtifacts` e2e 매칭 확인. **여기까지 MVP** (Claude 토큰 0).
4. 증분 재수집(content_hash diff) + `codeflow_runs` 기록 + is_active 정리.
5. T4b LLM describe — 매칭 약한 노드 식별 후 핀포인트 enrich (Max 토큰, 배치). 또는 cohere 전환으로 교차언어 매칭 해결(§7 #1).
