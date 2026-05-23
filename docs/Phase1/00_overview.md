# Phase1 — Amaze: Level 3.5 → Level 4 Roadmap

> **목표**: 현재 "Verified multi-agent runtime" (Phase0 doc03 기준 Level 3 ~ 3.5)을
> **"Eval-gated self-improving agentic runtime"** (Level 4)로 끌어올린다.
> AGI 선언이 아니라 **closed-loop self-improvement** 의 governance chain을 완성하는 것이 목표.

본 디렉터리의 각 md 파일은 **하나의 Phase1 sub-goal** 에 대응한다. 부모 오케스트레이터는
각 파일의 `Goal` 블록을 `goal start`에 그대로 투입하고, `Tasks` 섹션의 ticket을
`task` 도구로 dispatch 한다. 모든 ticket은 `SubagentContract` JSON으로 직렬화되어 있다.

---

## 0. Mission

```text
AMAZE execution
  → AI-Coach-style analysis
  → Nexus learning proposal
  → verifier/eval gate
  → versioned skill/rule/policy promotion
  → measurable improvement
```

이 루프를 **권한·검증 경계가 닫힌 상태에서** 닫는 것이 Phase1의 정의다.

---

## 1. Phase 트리 / 의존 그래프

```text
Phase1A — Boundary Closure (보안/권한)
  ├── 01_security_boundaries.md      (P0: effectiveAgent / apply_patch / isolated)
  └── 02_verifier_hardening.md       (P1: uncertain policy / yield / shell / exec)

Phase1B — Memory & Skill Governance
  └── 03_memory_governance.md        (contradiction / skill lifecycle / migration)

Phase1C — Observability Plane (AI Coach 흡수)
  ├── 04_observability_ingest.md     (session parser / normalized event bus)
  └── 05_rule_dsl.md                 (.amaze/rules/*.rule.md DSL engine)

Phase1D — Learning & Eval Loop
  ├── 06_learning_proposal.md        (LearningProposal 객체 / proposal store)
  ├── 07_eval_gate.md                (replay / regression / sandbox / rollback)
  └── 08_self_improvement_metrics.md (force-complete rate / hit precision / churn)

Phase1E — Autonomy (선택, 후순위)
  └── 09_autonomous_goals.md         (long-horizon goal manager — gated only)

Phase1Ω — Operational
  └── 10_release_runbook.md          (AGENTS.md 복구 / test:ts 분리 / doctor)
```

**의존 규칙**:
- 1A 가 끝나기 전엔 1C/1D 를 출시 단계까지 진행하지 않는다. 권한 경계가 새는 상태에서
  자기수정 루프를 닫으면 self-contamination 위험.
- 1B 와 1Ω 은 1A 와 병렬 가능 (코드 영역이 겹치지 않음).
- 1C → 1D 는 sequential. Proposal 입력원이 observability plane.
- 1E 는 1D 의 eval gate 가 안정화된 후에만 진입.

---

## 2. Cross-cutting Invariants

모든 Phase1 작업이 위반해선 안 되는 불변식:

1. **Memory is guidance, not authority.** Memory → Skill → Active policy 승격은 항상 gate 통과 후.
2. **Tool-level enforcement > prompt instruction.** 권한은 prompt 가 아니라 tool layer 에서 막는다.
3. **Verifier 는 상태를 mutate 하지 않는다.** `command-*` criteria 도 read-only argv 우선.
4. **STABLE_CORE 깨지 않기.** 새 기능이 goal-block 외 dynamic 영역에서 cache breakpoint 위로 들어가면 reject.
5. **결정형 acceptance 우선.** llm-judged / manual 는 audit 전용, gate 차단은 결정형으로.
6. **회귀 금지.** 본 디렉터리 작업은 기존 5,352 pass 테스트를 깨선 안 된다. 새 테스트는 추가.

---

## 3. 부모 오케스트레이터의 진입 절차

1. `todo_write` 로 아래 master phase list 초기화.
2. 각 phase md 파일을 `goal start <Goal>` 으로 진입.
3. 해당 phase의 `Tasks` 섹션 ticket 들을 `task` 도구에 병렬/직렬 정책에 맞게 dispatch.
4. AcceptanceVerifier 가 모든 criteria pass 한 후 `goal complete`.
5. 다음 phase 로 이동.

### Master Todo (init payload)

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

---

## 4. 공통 ticket 스키마

각 phase 의 `Tasks` 섹션은 다음 형태를 따른다. `task` 도구 호출 시 그대로 사용 가능:

```jsonc
{
  "id": "CamelCaseId",          // ≤ 32
  "description": "UI label",
  "assignment": "...",          // 자기완결 지시
  "contract": {
    "role": "verb-noun",
    "scope": { "include": ["src/foo/**"], "exclude": [] },
    "inputArtifact": "docs/Phase1/0X_...md#section",
    "outputContract": { "mustProduce": ["modified files", "passing tests"] },
    "successCriteria": [/* AcceptanceCriterion[] */],
    "escalation": { "onUncertainty": "ask-parent", "budgetCap": 200000 }
  }
}
```

`successCriteria` 의 `check.type` 은 결정형 우선:
- `scope-include` / `scope-exclude` — changedFiles glob
- `file-exists` — artifact 산출 확인
- `command-exit` — `argv` 기반 (shell 금지)
- `command-output` — stdout/stderr regex
- `lsp-clean` — 변경 파일 LSP diagnostics 0
- `manual` / `llm-judged` — audit only (block 안 함)

---

## 5. Phase 1 의 정의: Done

다음이 모두 참이면 Phase1 종료, Level 4 도달:

- [ ] doc02 의 P0/P1 항목 13개 전부 regression test 추가됨 (02번 문서 § 13)
- [ ] doc01 의 P0/P1 항목 전부 해결 (AGENTS.md, uncertain policy, contradiction, skill lifecycle, migration)
- [ ] `.amaze/rules/*.rule.md` 가 session event stream 위에서 결정형으로 평가됨
- [ ] LearningProposal → eval gate → versioned promotion 경로가 코드로 존재
- [ ] `cost per accepted goal`, `force-complete rate`, `revision loop success rate`, `memory hit precision` 4 지표가 doctor/CLI 로 노출됨
- [ ] 1 주 실측 데이터에서 `force-complete rate` 감소 또는 `goal completion pass rate` 증가 중 1개 이상 입증

---

## 6. 비-목표 (out of scope)

- LLM weight online training
- 자율적 자기 코드 PR 자동 머지 (human approval gate 유지)
- 새 IDE/UI 표면. AI Coach 의 dashboard 는 흡수하지 않음 — rule DSL/parser 만 흡수.
- AGI 선언

---

## 7. 파일 인덱스

| 파일 | 단계 | 우선순위 | 의존 |
|---|---|---|---|
| 01_security_boundaries.md | 1A | P0 | — |
| 02_verifier_hardening.md | 1A | P1 | 01 |
| 03_memory_governance.md | 1B | P1 | — (병렬) |
| 04_observability_ingest.md | 1C | P2 | 01 |
| 05_rule_dsl.md | 1C | P2 | 04 |
| 06_learning_proposal.md | 1D | P2 | 03, 05 |
| 07_eval_gate.md | 1D | P2 | 06 |
| 08_self_improvement_metrics.md | 1D | P2 | 04 |
| 09_autonomous_goals.md | 1E | P3 | 07, 08 |
| 10_release_runbook.md | 1Ω | P0 | — (병렬) |
