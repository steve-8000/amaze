# Amaze `goal → mission` 통합 — 병렬 에이전트 작업 계획서

> 목적: [리팩토리 계획서](./README.md 기준 설계안)를 **여러 goal-mode 에이전트가 worktree에서 동시에**
> 실행할 수 있도록, 작업을 **충돌 없는 레인(lane)** 으로 쪼개고 의존성·게이트·완료기준을 고정한다.
>
> 실행 방식: 각 레인 = 독립 worktree + 독립 goal. `paseo` 스킬로 에이전트/worktree 생성,
> 각 에이전트에 해당 레인의 `/goal set` 목표문을 그대로 주입한다.

---

## 0. 검증된 현재 상태 (계획 전제)

코드 확인 결과 (2026-05-24):

| 항목 | 사실 | 영향 |
| --- | --- | --- |
| `goals/runtime.ts` | 988줄. **이미** `mission/store`를 import하고 `missionId` 연결 + `recordMissionVerificationFromGoalObjective`로 mission verification dual-write 수행 | Phase 2(dual-write)의 토대가 이미 존재 → 어댑터 신설보다 **승격**에 집중 |
| `mission/runtime.ts` | 39줄. event-bus + JSONL sink 중심의 얇은 싱글톤. 실행 오너 아님 | 실행 제어를 여기로 이동해야 함 (Lane C2) |
| `mission/store.ts` | 1000줄+. `MissionStore`/`resolveMission`. mission 상태의 실체 | 실행 오너 승격의 backing store |
| `mission/types.ts` | 229줄. 상태/계약/검증/rollback 풍부 | 확장 대상, 파괴 금지 |
| `/goal` 서브커맨드 | `set / show / pause / resume / drop / budget` → `handleGoalModeCommand` | CLI 레인에서 alias 처리 |
| 테스트 베이스라인 | `test/goals/*`(goal-runtime, goal-mode-integration, closing-audit-e2e, uncertain-policy 등), `test/mission/*`, `test/cli/mission.test.ts`, `test/observability/coverage/goal-events.test.ts` | 모든 레인의 회귀 게이트 |
| `tools/` | 약 80개 파일 평면 배치 | Gateway는 신규 디렉토리로 추가, 기존 파일은 wrapper로 점진 흡수 |

> **핵심 원칙 변경 없음:** GoalRuntime 즉시 삭제 금지 · 첫 단계 behavior-preserving · Memory는 guidance · Mission event는 단일 audit log · Verifier 동작 동일 유지.

---

## 1. 병렬화 전략

원래 계획서는 PR 1~10이 대체로 **순차**다. 병렬화의 관건은:

1. **신규 파일만 만드는 작업**은 서로 독립 → Wave 1에서 동시 실행 가능
2. **기존 파일을 수정하는 작업**은 파일 소유권으로 격리하거나 의존 순서로 직렬화
3. 각 레인은 **behavior-preserving 게이트**(`bun test` 베이스라인 통과)를 자체적으로 통과해야 머지

### 1.1 의존성 DAG

```txt
Wave 1 (전부 동시 실행 — 신규 파일/문서만, 기존 동작 불변)
  A. Mission Core Types        (mission/core/**)            ── 독립
  B. Event Schema v2           (mission/events.ts 확장)      ── 독립
  C1. ToolGateway Skeleton     (tools/registry|gateway/**)  ── 독립
  D. Memory Authority Types    (memory/authority 신규)       ── 독립
  E. Baseline Docs + Maps      (docs/refactor/**)           ── 독립

        │ A,B 완료
        ▼
Wave 2
  C2. MissionRuntime 실행오너 승격   (mission/runtime.ts, mission/store.ts)   ← A,B
  F.  Goal→Mission 어댑터 확장        (goals/runtime.ts)                       ← A,B
       (※ C2와 F는 서로 다른 파일군 → 동시 가능, 단 인터페이스 합의 필요)

        │ C2,F 완료
        ▼
Wave 3
  G. MissionPolicyEngine        (mission/policy/** 신규 + classify 연결)   ← C2
  H. ToolGateway 강제 적용       (tools/*.ts wrapper 교체)                 ← C1
  I. Task/Subagent Mission 바인딩 (task/**, subagent/**)                   ← C2

        │ G,H,I 완료
        ▼
Wave 4
  J. Nexus Memory Bridge        (memory-backend/**, nexus/**)             ← C2,D,G
  K. CLI Migration              (slash-commands, commands/**)             ← C2,F
  L. Legacy Goal 축소           (goals/runtime.ts thin wrapper)           ← 전부
```

### 1.2 레인별 파일 소유권 매트릭스 (충돌 방지의 핵심)

| 레인 | **쓰기 소유(이 레인만 수정)** | 읽기 전용 참조 |
| --- | --- | --- |
| A | `mission/core/**` (신규) | `mission/types.ts` |
| B | `mission/events.ts`, `mission/event-bus.ts`, `mission/jsonl-sink.ts` | `mission/types.ts` |
| C1 | `tools/registry/**`, `tools/gateway/**` (신규) | `tools/index.ts`, `tools/tool-result.ts` |
| D | `memory/authority/**` (신규) | `memory-backend/**`, `nexus/**` (읽기) |
| E | `docs/refactor/**` | 전체 (읽기) |
| C2 | `mission/runtime.ts`, `mission/store.ts`, `mission/read-model.ts`, `mission/projection.ts` | A의 core 타입, B의 events |
| F | `goals/runtime.ts`, `goals/state.ts`, `goals/index.ts` | A의 core 타입, mission/store |
| G | `mission/policy/**` (신규), `mission/context-packet.ts` | C2 산출물 |
| H | `tools/*.ts` (개별 도구 wrapper), `tools/index.ts` | C1 gateway |
| I | `task/**`, `subagent/**` | C2 runtime |
| J | `memory-backend/**`, `nexus/**`, `memory/bridge/**` (신규) | D, G |
| K | `slash-commands/**`, `commands/**`, `cli/**` | F, C2 |
| L | `goals/runtime.ts`, `goals/verifier.ts` | 전부 |

> **규칙:** 한 파일은 한 시점에 한 레인만 쓰기 소유한다. `goals/runtime.ts`는 F와 L이 모두 건드리므로
> **L은 F 머지 이후에만 시작**한다 (DAG에서 직렬). `tools/index.ts`는 C1(추가)→H(교체) 순서.

---

## 2. Wave 1 — 동시 실행 5개 레인 (behavior-preserving, 신규 파일 위주)

각 레인은 **기존 테스트 0개 깨짐 + 신규 코드 compile 통과**가 완료기준. 동작 변경 금지.

### Lane A — Mission Core Types
- 신규: `mission/core/{mission.ts, mission-input.ts, mission-outcome.ts, mission-budget.ts, mission-scope.ts, acceptance-criteria.ts, mission-runtime.iface.ts}`
- `mission/types.ts`의 기존 타입과 호환되는 adapter 타입/변환 함수 작성 (기존 export 유지)
- 신규 `mission-runtime.iface.ts`에 §7 `MissionRuntime` 인터페이스 선언 (구현 X, 타입만)
- **완료기준:** `bun run check` 통과, `mission/types.ts` 기존 export 무손상, 신규 타입 단위 테스트 추가

### Lane B — Event Schema v2
- `mission/events.ts` 확장: §12 lifecycle 이벤트(`mission.created/classified/planned/task.*/tool.*/completed/blocked/cancelled/rolled_back`) 추가
- `EventEnvelope<T>` v2 도입 + v1 dual-read 호환 (기존 event 파싱 깨짐 금지)
- **완료기준:** `test/mission/producers.test.ts`, `read-model.test.ts` 통과 + v1/v2 호환 테스트 추가

### Lane C1 — ToolGateway Skeleton
- 신규: `tools/registry/{tool-registry.ts, tool-descriptor.ts}`, `tools/gateway/{tool-gateway.ts, permission-gate.ts, risk-classifier.ts, mutation-guard.ts, timeout-policy.ts}`
- §9.3 `ToolDescriptor`, §9.4 risk 분류 구현. **아직 어떤 도구도 강제로 통과시키지 않음** (등록만 가능)
- read/write/bash/repo-search/gh/fetch를 legacy descriptor로 **등록만** (호출 경로 미변경)
- **완료기준:** gateway 단위 테스트(등록/risk분류/scope deny) 추가, 기존 tool 호출 경로 불변

### Lane D — Memory Authority Types
- 신규: `memory/authority/{authority-hierarchy.ts, mission-memory-object.ts, durable-write-rule.ts}`
- §11.1 authority 계층, §11.2 `MissionMemoryObject`, §11.3 durable write rule을 **순수 타입+판정함수**로 구현 (저장소 연결 X)
- **완료기준:** authority ranking / durable-write 판정 단위 테스트, 기존 memory 동작 불변

### Lane E — Baseline Docs + Maps
- `docs/refactor/00-current-runtime-map.md` ~ `04-risk-register.md` 생성 (§13 Phase 0 산출물)
- goal↔mission↔task↔subagent import 그래프, tool 직접 호출 call-site 목록, memory read/write call-site 목록
- **완료기준:** 문서 5종 생성, 다른 레인이 참조할 call-site 인벤토리 완성

---

## 3. Wave 2 — 실행 오너 승격 (A,B 머지 후)

### Lane C2 — MissionRuntime 실행 오너 승격
- `mission/runtime.ts`를 §7 `MissionRuntime` 구현체로 확장 (create/classify/plan/execute/verify/complete/block/cancel/emit/get)
- `MissionStore`를 backing store로 사용, budget/accounting/state-transition을 여기서 소유
- **GoalRuntime은 아직 그대로** — 병렬 path로 동작
- **완료기준:** mission lifecycle 통합 테스트(create→…→complete, block, cancel) 추가, 기존 mission 테스트 통과

### Lane F — Goal→Mission 어댑터 확장
- 이미 존재하는 `goals/runtime.ts`의 mission 연결(`recordMissionVerificationFromGoalObjective`, `missionId`)을 **전 lifecycle로 확장**
- goal set/complete/block/drop → mission.created/verification.completed/completed/blocked/cancelled dual-write
- `renderGoalBlock`은 **유지**, `renderMissionBlock` 병행 추가 (prompt cache 보호)
- **완료기준:** `test/goals/*` 전부 통과 + goal-originated mission이 read-model에 노출되는 테스트 추가
- **주의:** C2와 인터페이스 합의 — Wave 2 시작 전 두 레인 에이전트가 `mission-runtime.iface.ts`를 계약으로 확정

---

## 4. Wave 3 — 정책·게이트 강제·하위 구조 (C2 머지 후)

### Lane G — MissionPolicyEngine
- 신규 `mission/policy/{policy-decision.ts, classifier.ts, risk.ts, context-budget.ts}`
- §8 `MissionPolicyDecision` + classify 구현, `mission.classified` 이벤트 기록
- `mission/context-packet.ts`에 contextBudget 산정 연결
- **완료기준:** low-risk는 critic 생략 / high-risk는 critic·verifier 강제 / policy가 event log에 기록되는 테스트

### Lane H — ToolGateway 강제 적용
- write/bash/edit/delete/gh 류 mutation 도구를 gateway 경유 **필수**로 전환 (C1 wrapper 사용)
- subagent mutation scope를 gateway의 `mutation-guard`에 연결
- direct import call-site를 gateway 호출로 점진 교체 (E의 call-site 인벤토리 사용)
- **완료기준:** scope-violation deny 테스트, tool-call event 기록 테스트, mutation 도구는 gateway 없이 실행 불가

### Lane I — Task/Subagent Mission 바인딩
- §10 `MissionTask` 도입, 기존 `task` executor를 `MissionTaskRunner`로 wrapping
- subagent contract에 `missionId`/`taskId` 필수화, task output → mission evidence 연결
- parallel/worktree 실행 로직은 위치 유지 (회귀 위험 최소화)
- **완료기준:** `test/subagent/*`, parallel/worktree 회귀 테스트 통과 + missionId 강제 테스트

---

## 5. Wave 4 — 통합·CLI·legacy 축소

### Lane J — Nexus Memory Bridge
- 신규 `memory/bridge/mission-memory-bridge.ts` + `MemoryCurator`
- memory read에 missionId 부여, write는 curator 경유, D의 authority 적용
- recall 결과를 `MissionContextPacket`에 포함, authority=guidance 표기
- **완료기준:** §15.5 memory 테스트 전부 — recall 포함/ repo truth 미오버라이드 / curator 없는 durable write 거부 / session_search 유지

### Lane K — CLI Migration
- `/mission` canonical 서브커맨드 추가(create/show/stream/evidence/decision/verify/complete/rollback)
- `/goal` → `/mission` alias 매핑 (set→create, show→show, drop→cancel 등), `/goal` deprecated 안내
- `docs/current/{mission-runtime,tool-gateway,memory-authority,goal-legacy-alias}.md` 작성
- **완료기준:** `test/cli/mission.test.ts` 확장 + goal alias 동작 테스트, help 텍스트 갱신

### Lane L — Legacy Goal 축소
- `goals/runtime.ts`를 thin wrapper로 축소 (실행 로직 → C2로 이미 이동된 것 위임)
- 중복 state 로직 제거, import path 정리
- **완료기준:** GoalRuntime 내부 로직 70%+ 위임, `/goal` alias·verifier 동작 동일, 전체 테스트 그린
- **선행:** F + C2 + K 머지 후에만 시작

---

## 6. 각 레인용 `/goal set` 목표문 (복붙용)

> 각 에이전트 worktree에서 그대로 `/goal set <objective>` 후 budget 설정. acceptance criteria를 명시해
> goal verifier가 완료를 검증하도록 한다.

**Lane A**
```
mission/core/ 하위에 Mission/MissionInput/MissionOutcome/MissionBudget/MissionScopeGuard/AcceptanceCriterion
및 MissionRuntime 인터페이스 타입을 신규 작성한다. mission/types.ts의 기존 export는 절대 변경/삭제하지 않고
호환 adapter 함수를 제공한다. 완료조건: `bun run check` 통과, 기존 test/mission/* 전부 통과,
신규 타입 단위테스트 추가, 동작 변경 0.
```

**Lane B**
```
mission/events.ts에 mission lifecycle 이벤트(created/classified/planned/task.*/tool.*/completed/blocked/
cancelled/rolled_back)와 버전드 EventEnvelope v2를 추가한다. v1 이벤트 파싱 호환을 유지한다.
완료조건: test/mission/producers.test.ts·read-model.test.ts 통과, v1/v2 dual-read 테스트 추가, 동작 변경 0.
```

**Lane C1**
```
tools/registry/와 tools/gateway/를 신규로 만들어 ToolDescriptor, ToolRegistry, ToolGateway, PermissionGate,
RiskClassifier, MutationGuard, TimeoutPolicy를 구현한다. read/write/bash/repo-search/gh/fetch를 legacy
descriptor로 등록만 하고 기존 호출 경로는 바꾸지 않는다. 완료조건: gateway 단위테스트 추가, 기존 tool 동작 0 변경.
```

**Lane D**
```
memory/authority/ 신규 디렉토리에 authority 계층(instruction>repo_truth>mission_evidence>verified_memory>
guidance), MissionMemoryObject 타입, durable write rule 판정함수를 순수 함수로 구현한다. 저장소는 연결하지 않는다.
완료조건: authority ranking·durable-write 판정 단위테스트, 기존 memory 동작 0 변경.
```

**Lane E**
```
docs/refactor/00~04 문서를 작성한다: 현재 runtime map, goal↔mission 중복, tool 직접호출 call-site 목록,
memory read/write call-site 목록, risk register. 코드는 수정하지 않는다. 완료조건: 문서 5종 생성 및 call-site 인벤토리 완성.
```

(C2/F/G/H/I/J/K/L 목표문은 선행 레인 머지 후 동일 양식으로 발급 — §2~§5의 완료기준을 acceptance criteria로 사용)

---

## 7. 공통 운영 규칙 (모든 에이전트)

```txt
1. 자기 레인의 "쓰기 소유" 파일 밖은 수정 금지. 읽기만 한다.
2. 시작 시 베이스라인 저장: `bun test` 결과를 기록하고, 머지 전 동일/개선만 허용.
3. behavior-preserving 레인(Wave 1, C2-병행, F)은 기존 동작/테스트를 절대 깨지 않는다.
4. GoalRuntime은 L 레인 외에는 삭제/축소 금지.
5. renderGoalBlock 즉시 제거 금지 — renderMissionBlock 병행으로만 추가.
6. 각 레인은 독립 worktree + 독립 브랜치. 머지는 DAG 순서(Wave1→2→3→4)대로.
7. 인터페이스 충돌 지점(mission-runtime.iface.ts)은 Wave 2 시작 전 C2·F 에이전트가 계약 확정 후 진행.
8. 머지 게이트: `bun run check && bun test` 그린 + 해당 레인 acceptance criteria 충족.
```

## 8. 권장 실행 순서 요약

| Wave | 동시 레인 | 게이트 |
| --- | --- | --- |
| 1 | A, B, C1, D, E | 각자 check+test 그린, 동작 불변 → 머지 |
| 2 | C2, F (iface 계약 합의 후) | mission lifecycle/ goal dual-write 테스트 |
| 3 | G, H, I | policy/ gateway 강제/ mission 바인딩 테스트 |
| 4 | J, K → L | memory/CLI 테스트 후, 마지막에 L |

> 가장 위험한 레인은 **C2(실행 오너 승격)** 와 **L(legacy 축소)**. 이 둘은 단독 머지 + 충분한 회귀 검증을 권장한다.

---

## 부록 — 실행 결과 (오케스트레이션 완료)

**완료일:** 2026-05-24 · 13개 레인 전부 main 병합 완료.

### 웨이브별 결과
| Wave | 레인 | 커밋 | 상태 |
| --- | --- | --- | --- |
| 1 | A,B,C1,D,E | `ff52089` (octopus) | ✅ mission core types, event v2, gateway skeleton, memory authority, baseline docs |
| 2 | F, C2 | `cf45da8`, `1ca280c` | ✅ goal→mission dual-write, MissionRuntime 실행오너 (+ producers 불변식 회귀 수정) |
| 3 | G,H,I | `95faa88` (octopus) | ✅ policy engine, gateway 강제(seam, allow-by-default), task/subagent mission 바인딩 (+ import 수정) |
| 4 | J,K,L | `110b05a`(J,K), `7b0653f`(L) | ✅ memory bridge, /mission CLI + /goal alias, GoalRuntime legacy 표기 |

### 검증
- 패키지 타입체크: **non-`bun`-env 에러 0건**.
- 리팩토리 신규 테스트: 전부 통과 (mission/tools/subagent/session/memory/cli 통합 907+ pass).
- 전체 스위트 잔여 실패 7건은 **전부 pre-existing/환경적**(base 45d459f에서도 동일 실패): compaction Copilot-initiator ×4(모델 연결 필요), write-acp-fs, research-run, learning/store(flaky+기존 uncommitted 변경). 리팩토리 기인 회귀 **0건**.

### 운영 교훈 (다음 오케스트레이션용)
1. **worktree 격리는 세션 베이스 커밋에서 분기** — 오케스트레이터가 직전에 main에 머지한 내용을 보지 못한다. 후속 웨이브 에이전트는 시작 시 `git merge main --no-edit`로 선행 작업을 흡수해야 한다(Wave 3·4에서 적용, Wave 2 C2 충돌의 원인).
2. **가장 위험한 레인(C2 실행오너 승격, L legacy 축소)은 격리 없이 main 트리에서 직접** 작업시키고 오케스트레이터가 diff 검토 후 커밋하는 통제점을 두면 안전.
3. **§5 L의 "70% 위임" 목표는 의도적으로 미달성.** 토큰-델타만 증명 가능하게 동일하여 위임했고, verifier/lifecycle/budget은 동작이 실제로 달라 "동작 동일" 비협상 제약을 우선했다. 향후 mission이 verifier/lifecycle을 정본화하면 추가 위임 가능.
