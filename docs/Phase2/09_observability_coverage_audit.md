# T11.9 — Observability coverage audit

## Current state (grounded)

Phase1 declared 9 emit sites: `goal.start`, `goal.complete`, `verifier.criterion`, `subagent.start`, `subagent.end`, `memory.write`, `memory.recall`, `skill.promote`. The schema also declares `session.start`, `turn.start`, `turn.end`, `tool.call`, `tool.result`, `prompt.cache`.

Per Phase1 closing-report: `prompt.cache` is not emitted (prompt-cache-policy has no token-detail inputs).

`session.start`, `turn.start`, `turn.end`, `tool.call`, `tool.result` — emission status unverified in Phase1 closing.

## Acceptance

1. Audit doc `docs/Phase2/observability-coverage.md` produced with one row per `SessionEvent` variant, columns:
   - Event type.
   - Emitter file:symbol (or "not implemented").
   - Test assertion file (or "missing").
   - Coverage status: `covered | unimplemented | partial`.
2. Every event variant in `session-event-schema.ts` is one of:
   - `covered` (emitter + test exist), or
   - `unimplemented` with a Phase3 ticket reference in the row.
3. For any `partial` row, a follow-up test is added that asserts the emission. New tests live under `packages/coding-agent/test/observability/coverage/`.
4. `prompt.cache` row explicitly marked `unimplemented`, references the Phase1 limitation note in `closing-report.md`, and links a Phase3 ticket file `docs/Phase3/<TBD>.md` (created as a stub by T11.9).
5. Sanity: for each `covered` row, the test file is run and passes.

## Implementation outline

1. Read `src/observability/event-schema.ts` to enumerate variants.
2. For each variant, grep `emit*` and `bus.publish` across `packages/coding-agent/src/**` to locate emitters.
3. For each variant, grep test assertions under `packages/coding-agent/test/observability/**` and `test/**`.
4. Build the table.
5. For any variant lacking a direct emission test, add a minimal test under `test/observability/coverage/<event-type>.test.ts` that constructs the realistic call path and asserts the bus received the event.
6. Write the audit doc.

## Boundaries

- Touch: `docs/Phase2/observability-coverage.md` (new), `test/observability/coverage/**` (new tests as needed), `docs/Phase3/prompt-cache-emit.md` (stub).
- Do not modify schema variants. Do not implement `prompt.cache`.
- Do not modify production emitters unless the audit finds an outright bug (e.g. event field missing). In that case, escalate via IRC to the parent before patching.

## Verification

- `bun --cwd packages/coding-agent test test/observability` exit 0.
- Audit doc exists and lists every event variant.
- `bun run check:ts` exit 0.
