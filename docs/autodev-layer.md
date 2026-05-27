# Auto-Dev Layer 설계 (레이어 5 — Proposal → Branch → Verify → PR)

> 버전: v0.1 (draft, **논의용 — 동결 아님**) · 대상 독자: selfheal 전 레이어 개발자 + UI
>
> 위치: Ouroboros 루프를 **닫는** 마지막 레이어. Insight가 우선순위 매긴 proposal을 사람이 승인(A1 HITL 게이트, 완료)하면, Auto-Dev가 그걸 **실제 코드 변경(브랜치/diff/PR 초안)**으로 바꾼다. 상위 [architecture.md](./architecture.md) §1의 레이어 5.
>
> **한 줄 정의**: `approvedProposals(repo)` → 격리 워크스페이스에서 coding agent를 구동해 변경을 만들고, **검증을 통과한 것만** PR 초안(handoff)으로 내보내는 self-improving 루프의 실행단.
>
> 레이어 결합은 테이블 컨트랙트로만 한다: 입력 `proposals` + `proposal_reviews`(승인분), 코드맵 `code_artifact_registry`/`code_edges`/`feature_registry`(CodeFlow), 출력 `agent_runs`/`agent_run_events`(신규). 코드 결합 아님.

---

## 0. 설계 1원칙 (조사 기반)

2026년 issue→PR 자동화 repo들은 하나의 골격으로 수렴했다. 가장 정제된 레퍼런스는 OpenAI **Symphony**(2026-04, harness-engineering 레퍼런스 스펙), 그리고 SWE-agent(ACI + self-verification), OpenHands resolver(sandbox→edit→test→PR), GitHub Copilot Coding Agent(보호 브랜치 격리)다.

**핵심 통찰 — harness engineering**: 신뢰성은 더 똑똑한 모델이 아니라 **agent가 먹기 좋은 repo 구조와 떠먹이는 grounding**에서 나온다. agent에게 "탐색"시키지 말고 **갈 곳을 떠먹여라.**

**selfheal의 비대칭 우위 — "CodeFlow가 곧 harness다"**: Symphony/OpenHands는 agent에게 맨 이슈 텍스트를 주고 repo를 탐색시킨다(비싸고 불안정). 우리는 이미 grounding을 갖고 있다:
- **bug_fix** → `signal_group.code_artifact_ids`(정확한 파일) + blast-radius(callers) + `defect.repro_steps/expected/actual` + corroboration(실제 유저 N건).
- **feature_gap** → CodeFlow 모듈맵 + `placement`(existing/new) + `connection` 배치안 + `verifyGapProposal` verdict.
- **enhancement** → 기존 기능의 anchor 파일.

→ 우리 프롬프트는 "이 이슈 고쳐봐"가 아니라 **"이 파일들에서, 이 blast-radius를 고려해, 이 실패를 재현하는 테스트부터 쓰고 고쳐라"**가 된다. 탐색 토큰을 0에 수렴(CodeFlow 비용철학 계승).

---

## 1. 확정된 결정 (2026-05-27, 사용자)

1. **PR 출력 경계 = 로컬 브랜치 + patch 아티팩트 (dry-run).** 워크스페이스에 브랜치 생성 + diff/PR본문을 아티팩트로 만들되 **GitHub push 안 함.** 실제 push+PR은 토큰+플래그 뒤 opt-in(후속). 이유: tete-lab/automated-trading-system은 외부 repo라 되돌리기 어려운 outward-facing 동작 → 비용/안전 보수 자세 유지, 루프 전체를 안전히 테스트.
2. **첫 범위 = Stub driver로 오케스트레이션+harness 먼저.** 상태머신·claim·워크스페이스 격리·검증게이트·`agent_runs`·PR아티팩트를 `StubAgentDriver`+결정론 테스트로 완성. 그다음 커밋에서 `ClaudeCliAgentDriver` 실물. (harness 규율: 모델이 아니라 *루프*를 테스트.)
3. **검증 = 결정론 게이트만 v1**, 적대적 Skeptic(claude-cli LLM 리뷰)은 v2.

상위 제약(계승): 구독 claude-cli만, anthropic 실 API는 구독 소진 전 금지([[api-key-after-subscription]]). 기본 driver=stub. 주석 영어. 커밋 전 독립 fresh-context 리뷰 에이전트([[independent-review-agent]]).

---

## 2. 상태머신 (`agent_runs.status`)

Symphony claim/run 라이프사이클을 우리 맥락(외부 트래커 없음, 트리거=HITL 승인)으로 축약:

```
queued → preparing → planning → implementing → verifying → pr_open
                                                    │
   종료: succeeded | failed | timed_out | rejected_by_verifier | canceled
```

- `queued` — 승인 proposal claim, run row 생성.
- `preparing` — 워크스페이스 준비(worktree/branch + before_run hook).
- `planning` — agent가 grounded brief로 계획 산출.
- `implementing` — agent가 코드 편집(bounded turns).
- `verifying` — 검증 루프(아래 §5).
- `pr_open` — **handoff 종료 상태**(Symphony `Human Review` 대응). dry-run에선 patch 아티팩트 + PR본문 생성 완료. 머지/실 PR은 사람(또는 후속 A단계).
- `rejected_by_verifier` — 검증 실패가 재시도 한도 소진(표면패치/회귀/테스트깨짐).

**불변식(Symphony 차용):** 상태 변이는 **단일 권한(orchestrator)**이 직렬화 → 같은 proposal 중복 dispatch 방지. claim은 `(repo, kind, ref_id)`에 활성 run 1개 제약(`INSERT … ON CONFLICT DO NOTHING` 또는 advisory lock).

---

## 3. 컴포넌트

```
approvedProposals(repo)            ← A1 HITL(완료): proposal_reviews.decision='approved'
        │ (dispatch queue, 테이블 컨트랙트)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ AutoDev Orchestrator (src/autodev/orchestrator.ts)             │
│  • claim · 동시성 슬롯 · 상태변이 단일권한 직렬화                  │
│  • 이미 활성/성공 run 있는 proposal 제외                          │
└──────────┬─────────────────────────────────────────────────────┘
           ▼ per run (격리)
  prepare ─▶ brief ─▶ DRIVE(AgentDriver) ─▶ VERIFY ─▶ handoff
  worktree   grounded   (bounded turns)     §5        patch+PR본문
  /branch    brief                                    아티팩트(dry-run)
```

**교체형 driver DI (LlmClient 패턴 그대로):** `src/autodev/drivers/`
- `StubAgentDriver` — LLM 0, 결정론. 워크스페이스에 스크립트된 편집 적용(예: 알려진 파일 생성/수정) → 오케스트레이션·격리·검증게이트·PR아티팩트·`agent_runs` 영속을 **모델 없이** 테스트. (첫 범위)
- `ClaudeCliAgentDriver` — `claude -p` headless를 워크스페이스 cwd에서 구동(구독, 추가과금 0). 허용 툴(edit/bash/test) + grounded brief 주입. (2번째 커밋)
- `AnthropicAgentDriver` / Agent SDK — 구독 소진 후.

**driver 계약(초안):**
```ts
interface AgentDriver {
  readonly kind: 'stub' | 'claude-cli' | 'anthropic';
  // 워크스페이스 cwd에서 brief를 구현. verify 콜백으로 self-check 가능(검증 피드백 재주입).
  run(input: { workspace: string; brief: GroundedBrief; attempt: number; feedback?: string })
    : Promise<{ filesChanged: string[]; summary: string; turnCount: number; usage?: LlmUsage }>;
}
```

---

## 4. 워크스페이스 격리 + grounded brief

**격리(Symphony "minimal isolation primitive"):** product repo의 캐시된 bare mirror에서 `git worktree add` per run → 브랜치 `selfheal/<kind>-<ref8>`. 경로 `workspaces/<repo-sanitized>/<ref-sanitized>/`, sanitize=`[A-Za-z0-9._-]`외 `_`. agent cwd 고정, **루트 밖 금지**. hooks: `after_create`(worktree+의존성), `before_run`(brief/AGENTS.md 주입), `after_run`(정리). 외부 repo라 product 쪽 스킬에 의존하지 않고 **워크스페이스에 brief 파일을 주입**한다.

> 현재 codeflow는 로컬 체크아웃 `rootDir`을 스캔한다(`scripts/codeflow-scan.ts`). Auto-Dev도 같은 로컬 체크아웃을 mirror 소스로 재사용한다 — 신규 clone 자동화는 Ingestion/배선 후순위.

**grounded brief (CodeFlow 질의로 조립):** `src/autodev/brief.ts`
- proposal.body(이미 issue 초안 md) + evidence(corroboration·platforms·band·effort).
- bug_fix: `signal_group.code_artifact_ids`→파일 목록, `Db.codeBlastRadius`→영향 callers, defect repro/expected/actual.
- feature_gap: 모듈맵 + placement/connection + verifyGapProposal verdict(grounded 모듈).
- enhancement: 기존 feature anchor 파일.
- 공통 지시: "**실패 재현 테스트 먼저(TDD)**, blast-radius 안에서만 수정, 커밋 메시지 규약".

---

## 5. 검증 (신뢰성 코어)

**v1 — 결정론 게이트(항상, 무료):** `src/autodev/verify.ts` 순수+프로세스 실행
1. diff 非공허(빈 변경 거부).
2. diff 범위 ⊆ (target_module ∪ blast-radius ± 허용) — 엉뚱한 곳 대량 수정 거부(SWE-Universe hacking detector 정신).
3. build/typecheck 통과(product repo의 `tsc`/build).
4. test 통과(product repo 테스트 스위트; 없으면 typecheck+build로 천장).
5. (bug_fix 권장) 회귀 테스트 신규 존재 — 없으면 경고 플래그(차단은 v2).

실패 시 피드백 동봉 재시도(bounded attempts, 지수 backoff `min(10s·2^n, 5m)` — Symphony). 한도 소진 → `rejected_by_verifier`.

**v2 — 적대적 Skeptic(claude-cli):** bug-hunter Hunter→Skeptic→Referee 흡수. diff를 proposal 대조 리뷰: "진짜 유저 결함 해결? 표면패치/하드코딩/테스트게이밍? 회귀?" → verdict. 결정론 게이트와 **둘 다 통과해야** PR. 독립 fresh-context로 구동(우리 리뷰-에이전트 규율을 루프 내부에 적용).

**위험 계층(bug-hunter canary/manualReview 차용):** critical 또는 결제/인증 `risk_tier` proposal은 **항상 draft + manualReview 강제** — 자동 ready 금지.

---

## 6. 데이터 플로우 (end-to-end)

1. Insight → `proposals`. 사람이 UI 승인 → `proposal_reviews.decision='approved'` (A1, 완료).
2. `runAutoDev`(CLI `npm run autodev`; 후속 pg-boss 무인 루프) → `approvedProposals(repo)`에서 활성/성공 run 없는 것 필터.
3. 동시성 슬롯 만큼: claim → `agent_runs`(queued) insert.
4. prepare: mirror→`git worktree add` 브랜치(after_create).
5. brief: proposal + CodeFlow 질의 조립(§4).
6. DRIVE: AgentDriver를 워크스페이스에서 구동(planning→implementing, bounded turns).
7. VERIFY: §5 결정론 게이트(v1) → 실패 시 피드백 재시도(backoff).
8. 통과: commit→branch→**patch+PR본문 아티팩트(dry-run)** → `pr_open`/`succeeded`, `proposal_reviews`를 in_dev로. 실패: `failed`/`rejected_by_verifier` + 사유.
9. 진행 이벤트 → `agent_run_events`(스트림/audit). stall_timeout 종료+재큐(Symphony).
10. (실 push opt-in 시) PR 머지(사람) → 제품 변경 → 새 리뷰 → 루프 반복 = **Ouroboros 닫힘**.

---

## 7. 스키마 (`db/migrations/008_autodev.sql`)

```sql
-- 실행 단위. proposal당 활성 run 1개(부분 unique 인덱스로 claim).
CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo          text NOT NULL,
  kind          text NOT NULL,          -- bug_fix | feature_gap | enhancement
  ref_id        text NOT NULL,          -- proposal_reviews와 동일 안정키
  branch        text,
  status        text NOT NULL,          -- §2 상태머신
  attempt       int  NOT NULL DEFAULT 0,
  workspace_path text,
  pr_url        text,                   -- dry-run에선 로컬 아티팩트 경로
  verdict       jsonb,                  -- 검증 결과(게이트별 pass/fail, 사유)
  tokens        int,
  error         text,
  started_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  ended_at      timestamptz
);
-- 같은 proposal 중복 dispatch 방지: 비종료 run은 (repo,kind,ref_id)당 1개.
CREATE UNIQUE INDEX agent_runs_active ON agent_runs (repo, kind, ref_id)
  WHERE status NOT IN ('succeeded','failed','timed_out','rejected_by_verifier','canceled');

CREATE TABLE agent_run_events (   -- 스트림/audit (Activity 페이지 원천)
  id      bigserial PRIMARY KEY,
  run_id  uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ts      timestamptz NOT NULL DEFAULT now(),
  phase   text NOT NULL,          -- preparing|planning|implementing|verifying|...
  message text,
  payload jsonb
);
CREATE INDEX agent_run_events_run ON agent_run_events (run_id, ts);
```

---

## 8. 디렉터리 / 배선 / UI

```
src/autodev/
  index.ts          public 엔트리(runAutoDev 재노출)
  orchestrator.ts   claim·동시성·상태머신
  workspace.ts      mirror→worktree, hooks, sanitize
  brief.ts          grounded brief 조립(CodeFlow 질의)
  verify.ts         결정론 게이트(v1) / Skeptic 훅(v2)
  drivers/{types,stub,claude-cli}.ts
scripts/autodev.ts  npm run autodev (CLI 래퍼)
test/autodev-*.test.ts  결정론 harness (StubAgentDriver + 격리 DB)
```

- DB 헬퍼: `Db.createAgentRun`/`updateAgentRun`/`appendRunEvent`/`activeRunFor`.
- UI 승격(architecture §6 단계7·8 점등): `/api/agents`←`agent_runs`(Auto-Dev 페이지), `/api/activity`←`agent_run_events`(Activity 페이지). mock→live.
- 오케스트레이션: 처음엔 CLI 1회 실행. 무인 루프 필요 시 pg-boss(기존 Postgres 재사용) — Symphony daemon poll 대응.

---

## 9. 빌드 로드맵 (하나씩)

1. **v1-a 스키마+DB**: `008_autodev.sql` + `Db` 헬퍼 + 결정론 테스트.
2. **v1-b 오케스트레이션+격리+StubDriver**: claim·상태머신·worktree·brief·결정론 게이트·patch 아티팩트. StubAgentDriver로 **전 경로 결정론 테스트**(승인 proposal→pr_open, 빈 diff 거부, 범위 위반 거부, 중복 claim 차단, rollback). `npm run autodev`.
3. ✅ **v1-c UI 배선 (백엔드)**: `/api/agents`(agent_runs→AgentRun, steps는 agent_run_events에서 복원)·`/api/activity`(agent_run_events→AuditEvent) live 승격. `src/api/routes/{agents,activity}.ts`+`_autodev-map.ts`, ROUTES status `live`, `Db.{listAgentRuns,listAgentRunEvents}`. 테스트 `test/api-autodev.test.ts`(Hono `app.request`). 프론트 mock→fetch 스왑은 web 팀(`USE_LIVE`).
4. ✅ **v2-a ClaudeCliAgentDriver (구현)**: `src/autodev/drivers/claude-cli.ts` — 구독 `claude -p`(headless)를 격리 worktree cwd에서 구동, 파일툴만(Read/Edit/Write/Glob/Grep, Bash 기본 차단), `--permission-mode acceptEdits`, `--max-turns` bounded, env 튜닝(AGENT_MODEL/MAX_TURNS/ALLOWED_TOOLS/TIMEOUT_MS). brief는 프롬프트로 주입(파일 아님 — 스코프 게이트 오염 방지). 변경파일은 worktree git status로 판정(자기보고 아님). 순수조각(buildAgentPrompt·parseChangedFiles) 단위테스트. 라이브 호출은 비결정·구독이라 미테스트. **실 end-to-end는 kiduki-gcs codeflow scan→corpus→insight→approve 후 `AGENT_DRIVER=claude-cli npm run autodev <mirror>`로 스모크 필요(별도).** verify 게이트 명령(node --check/eslint/build) 배선은 후속.
5. **v2-b 적대적 Skeptic + 위험계층**: Hunter→Skeptic→Referee, manualReview 강제.
6. **후속**: 실 GitHub push+PR opt-in(토큰/플래그), pg-boss 무인 루프, bug-hunter fix-plan canary/rollout 완전 흡수.

---

## 10. 열린 질문

1. **mirror 소스** — 로컬 체크아웃 재사용 vs bare clone 자동화(Ingestion 후 정리).
2. **product repo 테스트 가용성** — tete-lab/ats(Next.js TS)에 돌릴 테스트/typecheck가 있나? 없으면 v1 게이트 천장이 typecheck+build.
3. **실 push 경계 전환 시점** — 우리 소유 fork vs 대상 원본, 토큰 관리(범위 밖, 후속).
4. **diff 범위 허용폭** — blast-radius ± 어디까지를 "엉뚱한 수정"으로 볼지 캘리브레이션.
