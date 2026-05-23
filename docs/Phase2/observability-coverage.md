# Observability coverage audit

Source schema: `packages/coding-agent/src/observability/event-schema.ts` (`SessionEvent`). `prompt.cache` is intentionally unimplemented per `docs/Phase1/closing-report.md` limitation note.

| variant | emitter | test | status |
|---|---|---|---|
| `session.start` | not implemented | `packages/coding-agent/test/cli/observe.test.ts`, `packages/coding-agent/test/observability/jsonl-sink.test.ts` synthesize the event | unimplemented |
| `turn.start` | not implemented | `packages/coding-agent/test/cli/observe.test.ts`, `packages/coding-agent/test/observability/event-bus.test.ts`, `packages/coding-agent/test/observability/jsonl-sink.test.ts` synthesize the event | unimplemented |
| `turn.end` | not implemented | `packages/coding-agent/test/cli/observe.test.ts` synthesizes the event | unimplemented |
| `tool.call` | not implemented | missing | unimplemented |
| `tool.result` | not implemented | missing | unimplemented |
| `goal.start` | `packages/coding-agent/src/goals/runtime.ts:GoalRuntime.createGoal` | `packages/coding-agent/test/observability/coverage/goal-events.test.ts` | covered |
| `goal.complete` | `packages/coding-agent/src/goals/runtime.ts:GoalRuntime.completeGoalFromTool` | `packages/coding-agent/test/observability/coverage/goal-events.test.ts` | covered |
| `subagent.start` | `packages/coding-agent/src/task/executor.ts:runSubprocess` | `packages/coding-agent/test/observability/coverage/subagent-events.test.ts`, `packages/coding-agent/test/observability/subagent-start-has-contract.test.ts` | covered |
| `subagent.end` | `packages/coding-agent/src/task/executor.ts:runSubprocess` | `packages/coding-agent/test/observability/coverage/subagent-events.test.ts` | covered |
| `memory.recall` | `packages/coding-agent/src/nexus/store.ts:NexusStore.search` | `packages/coding-agent/test/observability/coverage/memory-events.test.ts` | covered |
| `memory.write` | `packages/coding-agent/src/nexus/store.ts:NexusStore.add`, `packages/coding-agent/src/nexus/store.ts:NexusStore.update` | `packages/coding-agent/test/observability/coverage/memory-events.test.ts` | covered |
| `skill.promote` | `packages/coding-agent/src/nexus/store.ts:NexusStore.upsertSkill` | `packages/coding-agent/test/observability/coverage/memory-events.test.ts` | covered |
| `verifier.criterion` | `packages/coding-agent/src/goals/runtime.ts:GoalRuntime.completeGoalFromTool` | `packages/coding-agent/test/observability/coverage/goal-events.test.ts` | covered |
| `prompt.cache` | `packages/coding-agent/src/observability/prompt-cache-emit.ts:emitPromptCacheEventIfPossible` | `packages/coding-agent/test/observability/prompt-cache-emit.test.ts` | covered |
