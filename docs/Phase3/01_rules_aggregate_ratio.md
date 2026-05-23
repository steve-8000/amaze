# T12.1 — `rules run` aggregate ratio crash

## Current state (grounded)

`packages/coding-agent/src/rules/evaluator.ts:38-40`:
```ts
if (!["count", "ratio", "distinct"].includes(rule.detect.aggregate)) {
  throw new Error(`Unsupported rule aggregate: ${rule.detect.aggregate}`);
}
```

`amaze rules run` (operator review Scenario B) emits an uncaught:
```
Error: Unsupported rule aggregate: ratio $.usedHits / $.hits
    at evaluateRule (rules/evaluator.ts:39:13)
```

A T11.6 builtin rule (most likely `session-memory-recall-decay.rule.md`) declares `aggregate: ratio $.usedHits / $.hits` — a ratio EXPRESSION rather than the bare keyword `ratio`. The parser accepted the string; the evaluator's allow-list rejects it.

## Acceptance

1. `amaze rules run --since 0 --quiet` against an observability JSONL containing the full builtin rule input set exits 0. No uncaught exceptions on any builtin rule.
2. `evaluateRule` supports ratio aggregates of the form `ratio <numerator-expr> / <denominator-expr>` where each side is a safe expression evaluated per matched event. Numerator and denominator are summed across matched events; the aggregate value is `sumNumerator / sumDenominator` (0 when denominator sum is 0). The bare `count | ratio | distinct` keywords stay supported.
3. New test `packages/coding-agent/test/rules/aggregate-ratio-expr.test.ts` covers:
   - `aggregate: "ratio $.usedHits / $.hits"` on memory.recall events → correct ratio value.
   - Empty-denominator handling (no NaN).
   - Numerator/denominator expression parse errors surface a deterministic, non-uncaught error (returned, not thrown out of evaluateRule).
4. New CLI smoke test `packages/coding-agent/test/cli/rules-run-smoke.test.ts` invokes `cli/rules.ts` `runRulesRunCommand` over each loaded builtin rule against a synthetic event stream. All exits 0.

## Implementation outline

1. Extend the aggregate parser. Where `detect.aggregate` is currently a string keyword, accept ALSO `"ratio <num> / <den>"` (`<num>` and `<den>` are safe-expr strings starting with `$.` or numeric literals). Compile each side once via `compileExpr` and evaluate per matched event.
2. Add `aggregateRatioExpr(matchedEvents, numExpr, denExpr): number` helper.
3. Wire into `evaluateRule`: when the aggregate string starts with `ratio ` and contains ` / `, parse out the two expressions and use the new helper. Otherwise fall through to the existing keyword path.
4. Preserve the keyword-`ratio` behavior (current count-of-matched / count-of-window) when the aggregate is exactly `"ratio"`.
5. If `rule.detect.aggregate` parses to neither shape, return an error finding (rule-level, with severity `critical`) rather than throwing — so `amaze rules run` over the full rule set never crashes on a malformed rule.

## Boundaries

- Touch: `src/rules/evaluator.ts`, `src/rules/types.ts` if the type needs widening, `test/rules/aggregate-ratio-expr.test.ts` (new), `test/cli/rules-run-smoke.test.ts` (new).
- Do NOT modify `rules/parser.ts` unless the aggregate field is currently typed too narrowly to accept the expression string. If so, widen the type only.
- Do NOT modify any `.rule.md` file. The builtin rule that triggered the crash MUST keep its current `aggregate: ratio $.usedHits / $.hits` line. The fix is the evaluator catching up to the rule.

## Verification

- `bun --cwd packages/coding-agent test test/rules test/cli/rules-run-smoke.test.ts` exit 0.
- `bun run check:ts` exit 0.
