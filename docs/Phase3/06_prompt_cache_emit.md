# T12.6 — `prompt.cache` event emission

## Current state (grounded)

`SessionEvent['prompt.cache']` is declared in `src/observability/event-schema.ts` with shape `{ sessionId, ts, readTokens, writeTokens, missReason }`. Phase2 observability-coverage audit marked it `unimplemented`.

`prompt-cache-policy` (under `src/prompt-cache-policy.ts` or equivalent) computes cache hit/miss reasons. Production turn-end path receives provider response with cache token detail (Anthropic: `cache_creation_input_tokens`, `cache_read_input_tokens`).

## Acceptance

1. The production turn path emits one `prompt.cache` event per provider response that includes cache token metadata. Required fields: `sessionId`, `ts`, `readTokens`, `writeTokens`, `missReason`.
2. `missReason` derives from the prompt-cache-policy:
   - `none` when readTokens > 0 and writeTokens == 0 (full hit).
   - `tail-change` when the policy classifies the miss as caused by the tail churn (e.g. tool-result variation).
   - `tool-change` when the policy classifies as caused by tool-set drift.
   - `prefix-change` when caused by system/header/instructions change.
   - `unknown` when classification is unavailable.
3. When provider metadata is absent (non-Anthropic providers, or response lacking the cache fields), NO `prompt.cache` event is emitted. Do not synthesize fake data.
4. The `docs/Phase2/observability-coverage.md` row for `prompt.cache` flips from `unimplemented` to `covered` and references the new emission test path.
5. New test `packages/coding-agent/test/observability/prompt-cache-emit.test.ts`:
   - Anthropic-shaped response with cache fields → exactly one `prompt.cache` event emitted with correct fields and missReason.
   - Provider response without cache metadata → zero `prompt.cache` events.
   - Each missReason classification reaches the event correctly.

## Implementation outline

1. Locate the turn-end handler in production code (likely `packages/agent/src/agent-session.ts` or the LLM response post-processing path). Identify where total token usage is currently reported (this is the natural emission point).
2. Add a small helper `emitPromptCacheEvent({ sessionId, response, bus, policyResolver })` that:
   - Returns early if `response.usage.cache_*` fields are absent.
   - Computes `readTokens` and `writeTokens` from the response.
   - Invokes `policyResolver.classifyMiss(...)` (if the policy supports it; otherwise call the existing classification function).
   - Emits via the session event bus.
3. Wire this helper alongside the existing `turn.end` emit. Order: emit `turn.end` first, then `prompt.cache` (if applicable).
4. Audit row update in `docs/Phase2/observability-coverage.md`.

## Boundaries

- Touch: `src/observability/prompt-cache-emit.ts` (new helper), wherever the production turn-end emits live (one or two files at most), `docs/Phase2/observability-coverage.md` (one row), `test/observability/prompt-cache-emit.test.ts` (new).
- Do NOT modify the schema variant.
- Do NOT modify `prompt-cache-policy` core classification logic. Use it through its existing interface.
- Do NOT change anything in `metrics/definitions.ts` — `prompt.cacheChurn` already consumes this event variant.

## Verification

- `bun --cwd packages/coding-agent test test/observability` exit 0.
- `bun run check:ts` exit 0.
- Audit doc row updated and references the new test file.
