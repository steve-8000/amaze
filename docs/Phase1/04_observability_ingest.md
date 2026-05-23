# Phase 1C-04 — Observability Plane: Session Parser & Event Bus
> **Ticket**: T1.4
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase1/closing-report.md

> **출처**: `docs/Phase0/03_gpt.md` §1, §6 (AMAZE 흡수할 AI Coach parser/analyzer).
> **위상**: P2. 1A 머지 후 진입.

## Goal

```yaml
title: Normalize all runtime activity into a single event stream consumable by the rule DSL
why: |
  AI Coach의 가치는 dashboard가 아니라 session parser + harness-agnostic normalization layer.
  AMAZE는 이미 in-process event 발행이 있지만, observability를 위한 normalized session schema가 부재.
  Rule DSL(05)과 Learning Proposal(06)의 입력원이 된다.
scope:
  include:
    - packages/coding-agent/src/observability/**
    - packages/coding-agent/src/runtime/events.ts
    - packages/coding-agent/src/cli/observe.ts
  exclude:
    - packages/coding-agent/src/nexus/**   # nexus 자체 이벤트는 forwarding만
```

## 산출물

1. **`SessionEvent` 표준 스키마** — 모든 runtime event를 단일 union 으로 정규화
2. **In-process pub/sub bus** — rule engine과 metrics가 구독
3. **Persistent sink** — JSONL 로 `~/.amaze/observability/sessions/<sessionId>.jsonl` 적재
4. **CLI** — `amaze observe tail`, `amaze observe export --session <id>`

## Acceptance Criteria

```yaml
- id: session-event-schema
  check: {type: file-exists, path: packages/coding-agent/src/observability/event-schema.ts}
- id: event-bus-pubsub
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/observability/event-bus.test.ts], expected: 0}
- id: jsonl-sink-roundtrip
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/observability/jsonl-sink.test.ts], expected: 0}
- id: cli-observe-export
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/cli/observe.test.ts], expected: 0}
- id: forwarding-coverage
  check: {type: command-exit, argv: [bun,test,packages/coding-agent/tests/observability/forwarding-coverage.test.ts], expected: 0}
```

## `SessionEvent` 스키마 (계약)

```ts
export type SessionEvent =
  | { type: "session.start"; sessionId: string; ts: number; cwd: string; agent: string }
  | { type: "turn.start"; sessionId: string; ts: number; turn: number }
  | { type: "turn.end"; sessionId: string; ts: number; turn: number; usage: TokenUsage }
  | { type: "tool.call"; sessionId: string; ts: number; tool: string; argsHash: string }
  | { type: "tool.result"; sessionId: string; ts: number; tool: string; ok: boolean; durationMs: number; bytesIn?: number; bytesOut?: number }
  | { type: "goal.start"; sessionId: string; ts: number; goalId: string; title: string; criteriaCount: number }
  | { type: "goal.complete"; sessionId: string; ts: number; goalId: string; verdict: "pass"|"fail"|"force"; failedCount: number; uncertainCount: number }
  | { type: "subagent.start"; sessionId: string; ts: number; taskId: string; role: string; isolated: boolean }
  | { type: "subagent.end"; sessionId: string; ts: number; taskId: string; verdict: "pass"|"fail"|"uncertain"; changedFiles: number; revisions: number }
  | { type: "memory.recall"; sessionId: string; ts: number; query: string; hits: number; usedHits: number }
  | { type: "memory.write"; sessionId: string; ts: number; memoryType: string; status: string }
  | { type: "skill.promote"; sessionId: string; ts: number; name: string; status: string }
  | { type: "verifier.criterion"; sessionId: string; ts: number; goalId: string; criterionId: string; status: "pass"|"fail"|"uncertain"; durationMs: number }
  | { type: "prompt.cache"; sessionId: string; ts: number; readTokens: number; writeTokens: number; missReason?: string };
```

> 본 union 은 v1 — 추가 fan-out 시 새 variant만 추가. 기존 variant 의 필드 제거는 metric 호환성 정책에 의해 금지.

## Tasks

### T4.1 — Schema + bus

```json
{
  "id": "ObservabilitySchema",
  "description": "SessionEvent union, EventBus(emit/subscribe), in-memory ring buffer",
  "assignment": "packages/coding-agent/src/observability/event-schema.ts에 위 union 그대로 정의. event-bus.ts: EventBus class { emit(e: SessionEvent), subscribe(fn): unsubscribe, snapshot(n): SessionEvent[] }. ring buffer 기본 5000. 모든 emit은 동기 push, 비동기 fan-out은 microtask로. 신규 테스트 event-bus.test.ts: emit/subscribe/unsubscribe + ring 오버플로우 잘림.",
  "contract": {
    "role": "observability-bus",
    "scope":{"include":["packages/coding-agent/src/observability/**","packages/coding-agent/tests/observability/event-bus.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/04_observability_ingest.md",
    "outputContract":{"mustProduce":["schema","bus","test"]},
    "successCriteria":[
      {"id":"bus-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/observability/event-bus.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":180000}
  }
}
```

### T4.2 — Forwarding from existing emitters

```json
{
  "id": "ForwardingCoverage",
  "description": "기존 GoalRuntime, TaskExecutor, NexusStore, ToolDispatcher, PromptCache에서 SessionEvent로 mapping해 EventBus.emit",
  "assignment": "각 site 마다 minimal adapter 추가. side-effect 없이 emit만. (a) goals/runtime.ts: completeGoalFromTool 결과를 goal.complete event로 (b) task/executor.ts: subagent start/end (c) tools/dispatcher.ts: tool.call/tool.result (d) nexus/store.ts: memory.recall/write, skill.promote (e) prompt-cache-policy.ts: prompt.cache 정보. 신규 테스트 forwarding-coverage.test.ts: 각 site의 dummy 시나리오 실행 후 EventBus.snapshot()에 해당 variant가 들어있는지 검증.",
  "contract": {
    "role": "forwarding-coverage",
    "scope":{"include":["packages/coding-agent/src/goals/runtime.ts","packages/coding-agent/src/task/executor.ts","packages/coding-agent/src/tools/**","packages/coding-agent/src/nexus/store.ts","packages/coding-agent/src/prompt-cache-policy.ts","packages/coding-agent/tests/observability/forwarding-coverage.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/04_observability_ingest.md",
    "outputContract":{"mustProduce":["adapters","test"]},
    "successCriteria":[
      {"id":"fwd-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/observability/forwarding-coverage.test.ts"],"expected":0}},
      {"id":"regress","check":{"type":"command-exit","argv":["bun","run","check:ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":250000}
  }
}
```

### T4.3 — JSONL persistent sink

```json
{
  "id": "JsonlSink",
  "description": "EventBus 구독해 ~/.amaze/observability/sessions/<sessionId>.jsonl 에 line-delimited 적재",
  "assignment": "BackgroundWriter (Bun.write append) + rotation: 파일 100MB 또는 24h 초과 시 rollover. flush는 batch (50 events or 500ms). 신규 테스트 jsonl-sink.test.ts: emit 100건 후 파일에 100개 라인, 각 라인 JSON.parse 가능.",
  "contract": {
    "role": "jsonl-sink",
    "scope":{"include":["packages/coding-agent/src/observability/jsonl-sink.ts","packages/coding-agent/tests/observability/jsonl-sink.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/04_observability_ingest.md",
    "outputContract":{"mustProduce":["sink","test"]},
    "successCriteria":[
      {"id":"sink-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/observability/jsonl-sink.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":150000}
  }
}
```

### T4.4 — CLI

```json
{
  "id": "ObserveCli",
  "description": "amaze observe tail / export",
  "assignment": "amaze observe tail [--session <id>] [--filter <type>]: 실시간 stdout. amaze observe export --session <id> --since <ts>: JSONL 출력. 신규 테스트 cli/observe.test.ts: fixture jsonl 파일 export → filter한 결과 검증.",
  "contract": {
    "role": "observe-cli",
    "scope":{"include":["packages/coding-agent/src/cli/observe.ts","packages/coding-agent/tests/cli/observe.test.ts"],"exclude":[]},
    "inputArtifact":"docs/Phase1/04_observability_ingest.md",
    "outputContract":{"mustProduce":["cli","test"]},
    "successCriteria":[
      {"id":"observe-cli-test","check":{"type":"command-exit","argv":["bun","test","packages/coding-agent/tests/cli/observe.test.ts"],"expected":0}}
    ],
    "escalation":{"onUncertainty":"ask-parent","budgetCap":120000}
  }
}
```

## 병렬화

T4.1 → (T4.2, T4.3) 병렬 → T4.4. T4.2 의 callsite 가 많아 가장 risky; IRC 로 site 별 progress 공유.

## 종료 조건

- SessionEvent 가 사실상 모든 runtime decision point 를 커버 (`forwarding-coverage.test.ts` 가 governance: 새 emitter 추가 시 해당 테스트가 가르치는 변경 요구).
- 다음 phase (05 rule DSL) 가 이 schema 만 의존하면 동작.
