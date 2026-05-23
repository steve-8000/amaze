# T11.5 — Verifier doc/code alignment

## Current state (grounded)

`packages/coding-agent/src/goals/verifier.ts:15-17`:
```
 *   - A criterion returning `uncertain` does NOT block completion at the closing audit
 *     level. Only `fail` blocks. This avoids the "everything is uncertain → blocked
 *     forever" failure mode of overly cautious verifiers.
```

But Phase1 introduced:
- `AcceptanceCriterion.blocking?: "fail-only" | "uncertain-blocks"` (line 73).
- `defaultBlockingPolicy()` returning `"uncertain-blocks"` for scope-include, lsp-clean, llm-judged (lines 76-83).
- `summarize(mode: 'audit' | 'contract')` where `contract` mode treats `uncertain` on `uncertain-blocks` criteria as a fail.
- `runtime.completeGoalFromTool` reads `goal.uncertainPolicy` and chooses mode.

Outcome: the head comment is wrong as documentation of behaviour.

## Acceptance

1. The verifier header comment in `src/goals/verifier.ts` rewritten to describe both modes:
   - `audit` mode (back-compat): `uncertain` does not block; only `fail` blocks.
   - `contract` mode (Phase1 default `block-manual`): criteria whose `blocking === "uncertain-blocks"` treat `uncertain` as a fail. Per `goal.uncertainPolicy`:
     - `allow` → audit mode (legacy behaviour).
     - `warn` → audit mode + emit `verifier.criterion` warning event for each uncertain.
     - `block-manual` → contract mode, but the caller may force-complete with explicit human override.
     - `block-all` → contract mode, no force-complete path.
2. `docs/Phase1/02_verifier_hardening.md` reviewed and updated to match the runtime, with a "code references" footer linking back to the file ranges.
3. New file `docs/Phase2/verifier-policy.md` is a one-page operator reference: the policy table + a worked example for each value.
4. Grep `uncertain does NOT block` in `packages/coding-agent/src/**` returns 0 matches.

## Implementation

This is documentation-only. No runtime change.

Steps:

1. Open `src/goals/verifier.ts`, rewrite lines 1-20 to describe the contract/audit mode dichotomy. Keep the original determinism + no-mutation contract bullets.
2. Cross-check `summarize` doc-comment (search file for `summarize` declaration) — update to refer to `mode` parameter.
3. Update `docs/Phase1/02_verifier_hardening.md` "uncertain policy" section. Append a "Runtime references" subsection listing `verifier.ts:summarize`, `runtime.ts:completeGoalFromTool`, `settings-schema.ts:goal.uncertainPolicy`.
4. Write `docs/Phase2/verifier-policy.md`.

## Boundaries

- Touch: `src/goals/verifier.ts` (comment-only diff), `docs/Phase1/02_verifier_hardening.md`, `docs/Phase2/verifier-policy.md` (new).
- Do not change any logic.

## Verification

- `bun run check:ts` exit 0 (comment changes must not break compile).
- `bun --cwd packages/coding-agent test test/goals test/verifier` exit 0.
- Manual: grep returns 0 matches.
