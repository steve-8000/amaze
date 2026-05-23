# Phase 1D-08 — Self-Improvement Metrics
> **Ticket**: T1.8
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase1/closing-report.md

> **출처**: `docs/Phase0/03_gpt.md` §7.3.
> **위상**: P2. Phase 04 (observability) 완료 후. 06/07 과 병렬 가능.

## Goal

```yaml
title: Quantify whether Amaze is actually improving over time
why: |
  Phase 04에서 정규화된 SessionEvent stream을 이용해 결정형 지표를 산출한다.
  지표 없이는 LearningProposal의 효과를 입증할 수 없다.
scope:
  include:
    - packages/coding-agent/src/metrics/**
    - packages/coding-agent/src/cli/metrics.ts
```

## 지표 정의 (v1)

| Metric | Window | Source events | Formula |
|---|---|---|---|
| `goal.completion.passRate` | last 7d | goal.complete | verdict=pass / total |
| `goal.forceCompleteRate` | last 7d | goal.complete | verdict=force / total |
| `subagent.contractAdoption` | last 7d | subagent.start | with contract / total |
| `subagent.revisionSuccess` | last 7d | subagent.end | revisions>0 && verdict=pass / revisions>0 |
| `subagent.noYieldRate` | last 7d | subagent.end | verdict=fail && reason=no-yield / total |
| `memory.hitPrecision` | last 7d | memory.recall + downstream tool.call | usedHits / hits |
| `memory.staleRate` | snapshot | nexus state | status in (superseded,quarantined) / total |
| `prompt.cacheChurn` | last 7d | prompt.cache | sum(missReason=tail-change) / total |
| `cost.perAcceptedGoal` | last 7d | turn.end + goal.complete | sum(usage tokens) / goal.complete[verdict=pass] |
| `verifier.bypassRate` | last 7d | verifier.criterion + goal.complete | (force-completes among fails) / total |

## Acceptance Criteria

```yaml
- id: metric-engine
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/metrics/engine.test.ts], expected: 0}
- id: metric-definitions
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/metrics/definitions.test.ts], expected: 0}
- id: metric-cli
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/metrics.test.ts], expected: 0}
- id: doctor-surface
  check: {type: command-output, argv: [bun,run,dev,--,doctor,--metrics], stdoutPattern: "goal\\.completion\\.passRate"}
```

## Tasks

### T8.1 — Metric engine

```json
{
  "id": "MetricEngine",
  "description": "JSONL sink + ring buffer에서 metric 계산 (streaming + windowed)",
  "assignment": "metrics/engine.ts: computeMetric(name, window): MetricResult. 각 metric은 reducer(state, event)+finalize 로 정의. window는 last:N | since:ms. cache: 직전 결과를 ring buffer cursor 와 함께 보관, 새 event만 reducer 호출. 신규 테스트 metrics/engine.test.ts: 결정형 fixture events에 대해 각 메트릭 기대값.",
  "contract": {
    "role": "metric-engine",
    "scope":{"include":["packages/coding-agent/src/metrics/engine.ts","packages/coding-agent/tests/metrics/engine.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/08_self_improvement_metrics.md",
    "outputContract":{"mustProduce":["engine","test"]},
    "successCriteria":[
      {"id":"engine-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/metrics/engine.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":220000}
  }
}
```

### T8.2 — Metric definitions

```json
{
  "id": "MetricDefinitions",
  "description": "위 표의 10개 metric 구현",
  "assignment": "metrics/definitions.ts: 각 metric을 {name, eventTypes, reducer, finalize} 로 등록. 표의 formula를 정확히 코드화. 신규 테스트 metrics/definitions.test.ts: 각 metric별 합성 event 시나리오로 기대값 검증.",
  "contract": {
    "role": "metric-defs",
    "scope":{"include":["packages/coding-agent/src/metrics/definitions.ts","packages/coding-agent/tests/metrics/definitions.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/08_self_improvement_metrics.md",
    "outputContract":{"mustProduce":["10 metrics","test"]},
    "successCriteria":[
      {"id":"def-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/metrics/definitions.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":250000}
  }
}
```

### T8.3 — CLI & doctor surface

```json
{
  "id": "MetricCli",
  "description": "amaze metrics show / amaze metrics watch / amaze doctor --metrics",
  "assignment": "amaze metrics show [--window 7d] [--json]: 전 metric 표 출력. amaze metrics watch: 1s 주기 갱신. amaze doctor --metrics: 임계값 위반 metric을 status로 노출 (예: forceCompleteRate>5% → warn). 신규 테스트 cli/metrics.test.ts.",
  "contract": {
    "role": "metric-cli",
    "scope":{"include":["packages/coding-agent/src/cli/metrics.ts","packages/coding-agent/src/cli/doctor.ts","packages/coding-agent/tests/cli/metrics.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/08_self_improvement_metrics.md",
    "outputContract":{"mustProduce":["cli","doctor","test"]},
    "successCriteria":[
      {"id":"metric-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/metrics.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

## 병렬화

T8.1 → T8.2 → T8.3 (sequential — definitions가 engine 사용, CLI가 둘 다 사용).

## 종료 조건

- 모든 10 metric 이 `amaze metrics show` 에서 산출됨
- `amaze doctor --metrics` 가 SLO 기반 status 출력
- Phase 1 종료 조건 (`overview.md` §5) 의 4 metric (`forceCompleteRate`, `goalPassRate`, `revisionSuccess`, `memoryHitPrecision`) 노출됨
