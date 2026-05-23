# T11.3 — `subagent.contractAdoption` measures contracts, not isolation

## Current state (grounded)

`packages/coding-agent/src/observability/event-schema.ts:34`:
```
| { type: "subagent.start"; sessionId: string; ts: number; taskId: string; role: string; isolated: boolean }
```

No `hasContract` field.

`packages/coding-agent/src/metrics/definitions.ts:38-46`:
```ts
{
  name: "subagent.contractAdoption",
  eventTypes: ["subagent.start"],
  initial: () => ({ numerator: 0, denominator: 0 }),
  reducer: (state, event) => {
    if (event.type !== "subagent.start") return state;
    return { numerator: state.numerator + (event.isolated ? 1 : 0), denominator: state.denominator + 1 };
  },
  finalize: ratio,
},
```

Numerator currently counts isolation, not contract usage.

## Acceptance

1. `SessionEvent['subagent.start']` gains a `hasContract: boolean` field (non-optional; emitters must decide).
2. Every `subagent.start` emission site sets `hasContract` from the presence of a non-null subagent contract envelope, NOT from the isolation flag.
3. `subagent.contractAdoption` reducer uses `event.hasContract`.
4. New test `packages/coding-agent/test/metrics/contract-adoption.test.ts` asserts: (a) when 3 subagents start with `hasContract=true` and 2 with `hasContract=false`, the metric finalises to 0.6; (b) `isolated` and `hasContract` can diverge — a non-isolated subagent with a contract counts as adoption.
5. New test `packages/coding-agent/test/observability/subagent-start-has-contract.test.ts` asserts emitter populates `hasContract` correctly for both contract-bearing and contract-less subagent launches in `task/executor.ts`.

## Implementation

### Schema edit

`packages/coding-agent/src/observability/event-schema.ts:34`:
```ts
| {
    type: "subagent.start";
    sessionId: string;
    ts: number;
    taskId: string;
    role: string;
    isolated: boolean;
    hasContract: boolean;
  }
```

### Emitter edit (task/executor.ts)

Locate the `emitSessionEvent({ type: "subagent.start", ... })` call. Add `hasContract: Boolean(task.contract)` (or whatever the contract field on the task descriptor is — confirm by reading `task/types.ts`).

### Metric edit (metrics/definitions.ts)

```ts
return { numerator: state.numerator + (event.hasContract ? 1 : 0), denominator: state.denominator + 1 };
```

### Migration of existing tests

Any test that constructs a `subagent.start` event literal must add `hasContract`. Grep for `type: "subagent.start"` under `packages/coding-agent/test` and patch.

## Boundaries

- Touch: `src/observability/event-schema.ts`, `src/metrics/definitions.ts`, `src/task/executor.ts` (emit site only), and any test files literal-constructing `subagent.start` events.
- Do not change `subagent.end` schema.
- Do not modify the `isolated` field or its semantics.

## Verification

- `bun --cwd packages/coding-agent test test/observability test/metrics test/task` exit 0.
- The new contract-adoption tests pass.
- `bun run check:ts` exit 0 (schema field addition must compile cleanly).
