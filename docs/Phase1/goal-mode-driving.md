# Phase1 Goal-mode 오케스트레이터 운전 매뉴얼

이 문서는 Phase1 parent orchestrator가 `docs/Phase1/00_overview.md`부터 `10_release_runbook.md`까지의 sub-goal을 goal runtime으로 운전하는 절차다. 목표는 빠른 dispatch가 아니라 결정형 verifier와 eval gate를 우선하는 closed-loop self-improvement governance chain을 안전하게 닫는 것이다.

## Step 1 — `todo_write` init payload

Phase1 시작 시 parent orchestrator의 master todo를 아래 JSON으로 초기화한다. 이 master todo가 진행 상황의 진실 소스이며, README나 개별 phase 문서의 체크박스가 이를 대체하지 않는다.

```json
[
  {"phase":"1A-Boundary","items":[
    "01 security boundaries (effectiveAgent, apply_patch, isolated verifier)",
    "02 verifier hardening (uncertain, yield, shell, exec, changedFiles)"
  ]},
  {"phase":"1B-MemoryGov","items":[
    "03 memory governance (contradiction, skill lifecycle, migration)"
  ]},
  {"phase":"1C-Observability","items":[
    "04 observability ingest (session parser, event bus)",
    "05 rule DSL engine (.amaze/rules)"
  ]},
  {"phase":"1D-Learning","items":[
    "06 learning proposal layer",
    "07 eval gate (replay/regression/rollback)",
    "08 self-improvement metrics"
  ]},
  {"phase":"1E-Autonomy","items":[
    "09 autonomous long-horizon goals (feature-flagged)"
  ]},
  {"phase":"1Ω-Ops","items":[
    "10 release runbook (AGENTS.md, test:ts split, doctor surface)"
  ]}
]
```

## Step 2 — Phase 별 sub-goal 진입

각 phase 문서의 `Goal` YAML 블록을 그대로 `goal start`에 투입한다. 문서 파일 하나가 하나의 Phase1 sub-goal에 대응한다. 예: `01_security_boundaries.md`의 `Goal`은 1A 보안 경계 sub-goal이고, `10_release_runbook.md`의 `Goal`은 운영 위생 sub-goal이다.

`goal start` 후에는 반환된 goal id를 parent master todo와 연결한다. 이후 ticket dispatch, verifier result, revision loop, `goal complete <id>`는 모두 이 id를 기준으로 기록한다.

## Step 3 — Task ticket dispatch

각 phase 문서의 `Tasks` 섹션 ticket을 `task` 도구로 dispatch한다. ticket은 자기완결 assignment와 `SubagentContract`를 포함하므로, parent는 scope/include/exclude와 success criteria를 보존해 전달한다.

의존 그래프를 따른다:

- 1A는 우선 닫는다. 1A가 끝나기 전 1C/1D를 출시 단계까지 밀지 않는다.
- 1B와 1Ω은 1A와 병렬 가능하다.
- 1C는 04 observability ingest 후 05 rule DSL 순서로 진행한다.
- 1D는 06 learning proposal → 07 eval gate → 08 metrics 의존을 지킨다.
- 1E는 1D의 eval gate가 안정화된 뒤에만 시작한다.

같은 파일 또는 같은 settings-schema를 만지는 ticket들은 병렬 dispatch 전에 IRC로 owning을 합의한다. 특히 schema, config loader, verifier contract처럼 호출자가 많은 표면은 한 worker가 owner가 되고 다른 worker는 owner에게 필요한 contract만 요청한다.

## Step 4 — AcceptanceVerifier 결과 해석

AcceptanceVerifier 결과는 결정형 criterion을 기준으로 해석한다.

- pass: ticket 결과를 parent master todo에 반영하고 다음 의존 ticket 또는 phase로 이동한다.
- fail: 실패 criterion, changedFiles, stderr/stdout 근거를 보존하고 같은 goal id에서 revision을 발행한다.
- llm-judged / manual: audit only로 취급한다. 이 항목은 사람이 읽을 수 있는 근거를 남기되 gate 차단 조건으로 삼지 않는다.

항상 결정형 우선이다. `command-exit`, `command-output`, `file-exists`, `scope-include`, `scope-exclude`, `lsp-clean` 같은 검증이 gate를 막거나 통과시킨다. LLM 판단은 보조 설명이며 권한·검증 경계를 대체하지 않는다.

## Step 5 — Phase 종료

해당 phase의 모든 required ticket이 AcceptanceVerifier pass 상태이고, 의존 phase도 만족되면 `goal complete <id>`를 실행한다. 완료 후 parent master todo만 업데이트한다. 개별 문서의 상태 표기를 임의로 고치지 않는다.

Phase complete는 “작업자가 완료를 주장했다”가 아니라 “goal runtime이 criteria pass를 관찰했고 parent orchestrator가 goal id를 완료 처리했다”는 뜻이다.

## Rollback

1D-07 eval gate가 머지되기 전의 코드/문서 변경 rollback은 일반 `git revert`를 사용한다. 1D-07 이후, proposal store와 versioned promotion 경로가 활성화된 변경은 `amaze proposals rollback`을 사용해 promoted skill/rule/policy 상태까지 함께 되돌린다.

rollback 기록에는 원인 criterion, affected goal id, reverted commit 또는 proposal id를 남긴다. runtime state와 durable governance artifact가 어긋나지 않게 하는 것이 목적이다.

## 충돌 회피

동일 settings-schema, goal verifier contract, task contract type, config surface를 만지는 ticket은 동시에 수정하지 않는다. parent 또는 workers는 IRC로 owning을 합의한 뒤 하나의 owner만 schema를 변경한다. 비-owner ticket은 owner가 확정한 field name, default, migration rule만 사용한다.

## 결정형 우선 원칙

Phase1의 gate는 deterministic evidence가 우선이다. `llm-judged`와 `manual`은 audit only이며, pass/fail 자동 차단은 결정형 check가 담당한다. self-improvement loop를 닫는 작업일수록 prompt 판단보다 tool-level enforcement, verifier output, eval replay, regression 결과를 우선한다.
