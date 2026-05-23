# T11.6 — Rule DSL session/request/workspace aggregation

## Current state (grounded)

`packages/coding-agent/src/rules/evaluator.ts` (per `docs/Phase1/05_rule_dsl.md`) supports `scan: events` only. Aggregations are `count | ratio | distinct` across an event window.

AI Engineering Coach equivalents work over normalised session/request/workspace structures, enabling rules like "high cache churn within a single request" or "memory.recall hits drop across a session".

## Acceptance

1. `RuleDefinition.detect.scan` accepts `"events" | "session" | "request" | "workspace"`.
2. Evaluator groups the input event stream before applying the `where`/`aggregate` clauses:
   - `events` (existing): no grouping.
   - `session`: group by `sessionId`. Aggregate per group; rule fires per session.
   - `request`: group by `(sessionId, turn)`. Aggregate per (session, turn) where `turn` derives from the surrounding `turn.start`/`turn.end` pair.
   - `workspace`: single bucket across all sessions in the window.
3. Aggregates accessible inside `where` as `agg.count`, `agg.ratio`, `agg.distinct`, plus per-group identifiers (`sessionId`, `turn` when applicable).
4. At least one new builtin rule per added tier under `packages/coding-agent/src/rules/builtin/`:
   - `session-memory-recall-decay.rule.md` (scan: session): low memory.hitPrecision over a session.
   - `request-cache-churn.rule.md` (scan: request): per-turn cache churn miss-rate above threshold.
   - `workspace-force-complete-trend.rule.md` (scan: workspace): force-complete rate trend across the window.
5. Tests in `packages/coding-agent/test/rules/aggregation.test.ts` cover all four tiers, including:
   - Grouping correctness for session/request.
   - Empty-group handling (no division by zero).
   - Rule fires once per group, not once per event.

## Implementation outline

### Schema

`packages/coding-agent/src/rules/types.ts`:
```ts
export type RuleScan = "events" | "session" | "request" | "workspace";
```

`detect.scan` typed accordingly.

### Evaluator

`packages/coding-agent/src/rules/evaluator.ts`:

```ts
function groupEvents(events, scan) {
  if (scan === "events") return [{ key: null, events }];
  if (scan === "workspace") return [{ key: null, events }];
  if (scan === "session") return groupBy(events, e => e.sessionId);
  if (scan === "request") return groupBy(events, e => `${e.sessionId}#${turnOf(e)}`);
}
```

`turnOf(event)` resolves the enclosing turn index by carrying the most recent `turn.start.turn` in a sequential walk; events outside any turn (e.g. session.start) get `turn = -1` and are excluded from the `request` grouping.

`where` evaluation runs once per group; rule emits one finding per group that matches.

### Parser

No syntactic change to `.rule.md`; only the enum widening in the type validator.

## Boundaries

- Touch: `src/rules/{types.ts,evaluator.ts}`, `src/rules/builtin/*.rule.md` (three new files), `test/rules/aggregation.test.ts` (new).
- Do not change `src/rules/parser.ts` beyond accepting the wider enum.
- Do not modify existing builtin rules.

## Verification

- `bun --cwd packages/coding-agent test test/rules` exit 0.
- `bun --cwd packages/coding-agent test test/rules/aggregation.test.ts` exit 0.
- `amaze rules list` shows three new rules.
