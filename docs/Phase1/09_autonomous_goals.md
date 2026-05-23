# Phase 1E-09 — Autonomous Long-Horizon Goal Manager (feature-flagged)
> **Ticket**: T1.9
> **Phase**: P3
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase1/closing-report.md

> **출처**: `docs/Phase0/03_gpt.md` §5.1, §8 (Level 4 → 향한 한 발).
> **위상**: P3. Phase 1D 의 eval gate (07) 와 metrics (08) 가 안정화된 후 진입.
> **기본값**: 비활성. 명시적 opt-in (`autonomy.enabled: true`) 없이는 동작 금지.

## 입장 (Stance)

> "Amaze가 스스로 목표를 만든다" 는 AGI 영역이고 본 phase의 목표가 아니다.
> 본 phase 는 **사용자가 정의한 장기 목표 (objective) 안에서**
> verifier-bounded sub-goal을 자동 생성·우선순위화·실행하는 *제한된 자율성* 만 도입한다.

## Goal

```yaml
title: Run user-declared long-horizon objectives as a queue of bounded, eval-gated sub-goals
why: |
  사용자가 "다음 4주간 force-complete rate를 5% → 1%로 낮춰라"같은 objective를 선언하면,
  Amaze가 metric을 모니터하며 LearningProposal/rule/sub-goal을 후보로 만들고 큐잉,
  human gate 통과한 것만 실제 sub-goal로 진입.
scope:
  include:
    - packages/coding-agent/src/autonomy/**
    - packages/coding-agent/src/cli/objective.ts
    - packages/coding-agent/src/settings/**
```

## Objective 계약

```ts
export interface Objective {
  id: string;
  title: string;
  metricTargets: Array<{ metric: string; target: number; direction: "down"|"up"; deadline?: number }>;
  budget: { tokens?: number; usd?: number; wallClockMs?: number };
  guardrails: {
    requireHumanForApply: boolean;     // 기본 true
    maxAutoSubgoalsPerDay: number;     // 기본 1
    forbiddenScopes: string[];         // glob
  };
  status: "active" | "paused" | "completed" | "cancelled";
}
```

## Acceptance Criteria

```yaml
- id: objective-store
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/autonomy/store.test.ts], expected: 0}
- id: subgoal-proposal
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/autonomy/subgoal-proposal.test.ts], expected: 0}
- id: rate-limiter
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/autonomy/rate-limit.test.ts], expected: 0}
- id: feature-flag-default-off
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/autonomy/feature-flag.test.ts], expected: 0}
- id: objective-cli
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/objective.test.ts], expected: 0}
```

## Tasks

### T9.1 — Objective store & feature flag

```json
{
  "id": "ObjectiveStore",
  "description": "objectives 테이블, feature flag autonomy.enabled (기본 false)",
  "assignment": "autonomy/store.ts: SQLite objectives + objective_events. settings에 autonomy.enabled (기본 false). flag false 면 autonomy loop entrypoint가 즉시 return. 신규 테스트 feature-flag.test.ts: flag false에서 startAutonomyLoop가 no-op, true에서만 동작.",
  "contract": {
    "role": "objective-store",
    "scope":{"include":["packages/coding-agent/src/autonomy/store.ts","packages/coding-agent/src/autonomy/migrations/**","packages/coding-agent/src/settings/**","packages/coding-agent/tests/autonomy/store.test.ts","packages/coding-agent/tests/autonomy/feature-flag.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/09_autonomous_goals.md",
    "outputContract":{"mustProduce":["store","flag","test"]},
    "successCriteria":[
      {"id":"store-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/autonomy/store.test.ts"],"expected":0}},
      {"id":"flag-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/autonomy/feature-flag.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":200000}
  }
}
```

### T9.2 — Metric→Sub-goal proposal

```json
{
  "id": "SubgoalProposal",
  "description": "objective의 metricTargets 미달성 시 후보 sub-goal LearningProposal 생성",
  "assignment": "autonomy/planner.ts: 주기적으로(예: 1h) computeMetric(target.metric)을 호출, target에서 멀어지면 후보 sub-goal 생성. sub-goal은 LearningProposal(type='rule'|'settings') 형태 또는 builtin remediation playbook 참조. proposal은 항상 human-required gate (objective.guardrails.requireHumanForApply 무시). 신규 테스트 subgoal-proposal.test.ts: synthetic metric trajectory에 대해 후보 생성.",
  "contract": {
    "role": "subgoal-planner",
    "scope":{"include":["packages/coding-agent/src/autonomy/planner.ts","packages/coding-agent/tests/autonomy/subgoal-proposal.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/09_autonomous_goals.md",
    "outputContract":{"mustProduce":["planner","test"]},
    "successCriteria":[
      {"id":"sub-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/autonomy/subgoal-proposal.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":220000}
  }
}
```

### T9.3 — Rate limiter & budget

```json
{
  "id": "AutonomyRateLimit",
  "description": "maxAutoSubgoalsPerDay, budget tokens/usd 한계, forbiddenScopes 강제",
  "assignment": "autonomy/limits.ts: shouldEmitProposal(objectiveId, candidate): allow|deny+reason. 일일 카운터, budget 잔량 (사용량은 turn.end events로 적분), forbiddenScopes 글로브 검사. 신규 테스트.",
  "contract": {
    "role": "rate-limiter",
    "scope":{"include":["packages/coding-agent/src/autonomy/limits.ts","packages/coding-agent/tests/autonomy/rate-limit.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/09_autonomous_goals.md",
    "outputContract":{"mustProduce":["limiter","test"]},
    "successCriteria":[
      {"id":"rate-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/autonomy/rate-limit.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T9.4 — CLI

```json
{
  "id": "ObjectiveCli",
  "description": "amaze objective create/list/show/pause/cancel, --enable",
  "assignment": "amaze objective create --title --metric --target --direction --deadline, list, show <id>, pause, cancel. amaze objective enable / disable 은 autonomy.enabled 토글. 신규 테스트.",
  "contract": {
    "role": "objective-cli",
    "scope":{"include":["packages/coding-agent/src/cli/objective.ts","packages/coding-agent/tests/cli/objective.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/09_autonomous_goals.md",
    "outputContract":{"mustProduce":["cli","test"]},
    "successCriteria":[
      {"id":"obj-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/objective.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

## Safety Notes

- 본 phase 코드 머지 후에도 default 상태에서는 일체 동작 안 함.
- enable 후에도 모든 sub-goal proposal 은 human-required gate → 자동 apply 경로 없음.
- forbiddenScopes 기본값: `[".git/**", ".amaze/settings.json", "AGENTS.md", "packages/coding-agent/src/learning/**"]` (학습 시스템이 학습 시스템 자체를 재귀적으로 바꾸지 못하게).

## 종료 조건

- 모든 acceptance criteria pass
- 1주간 enable 한 dogfood 환경에서 ungated apply 발생 0건
