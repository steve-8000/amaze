# T12.5 — Root `amaze doctor` health-check command
> **Ticket**: T12.5
> **Phase**: P1
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase3/closing-report.md


## Current state (grounded)

Phase2 operator review: `amaze doctor --help` is routed to default `launch` help because unknown subcommands fall through. Diagnostics are scattered: `memory doctor`, `metrics show`, `rules run`, observability sink reachability. No unified entry.

## Acceptance

1. `amaze doctor` is registered as a top-level subcommand. `amaze doctor --help` prints doctor-specific help, NOT launch help.
2. Output aggregates (in order):
   - **Memory subsystem**: result of `runDoctor()` from `src/cli/memory.ts` (or equivalent). Fail-soft on errors; show the error message but continue.
   - **Metrics availability**: how many metrics are registered, observability sink path, whether at least one session JSONL exists in the sink within the last 7 days.
   - **Rules engine**: number of loaded builtin + user/project rules, whether `evaluateRule` succeeds on a trivial smoke event stream (no crash). Reports any rule that throws.
   - **Observability sink**: path, writable status, last-flush timestamp if available.
3. Output ends with a one-line verdict: `Status: ok | degraded | failed`. `degraded` when any non-fatal component returned a problem; `failed` when memory doctor or rules engine cannot initialise.
4. Exit code: 0 on `ok`. 1 on `degraded` or `failed`. (Operators can scriptize on this.)
5. `--json` flag: emit the aggregated structure as a single JSON document.
6. New test `packages/coding-agent/test/cli/doctor.test.ts`:
   - happy path: ok verdict, exit 0.
   - memory subsystem failure injected → degraded or failed, exit 1.
   - rules engine throws on one rule (injected) → degraded, message identifying that rule.
   - `--json` returns parseable JSON with all four sections.

## Implementation outline

1. Add `doctor` to top-level command registration in `src/cli.ts`. Reuse the existing subcommand registration pattern.
2. New file `src/commands/doctor.ts` exporting `runDoctorCommand(opts)`. Composes:
   - `runDoctor` (memory) imported from `src/cli/memory.ts`.
   - MetricEngine introspection imported from `src/metrics`.
   - Rule loader + evaluator smoke from `src/rules`.
   - Observability sink path from `src/observability` (whichever public accessor exists).
3. Compose output via a small renderer (text vs json).
4. Help text registered through the existing CLI parser.

## Boundaries

- Touch: `src/cli.ts` (registration only), `src/commands/doctor.ts` (new), `src/cli/doctor.ts` (new if the codebase splits command/CLI parsing), `test/cli/doctor.test.ts` (new).
- Do NOT modify `runDoctor` (memory subsystem).
- Do NOT modify metrics, rules, or observability internals.
- Do NOT remove or rename `amaze memory doctor` — it stays.

## Verification

- `bun --cwd packages/coding-agent test test/cli/doctor.test.ts` exit 0.
- `bun --cwd packages/coding-agent test test/cli` exit 0.
- `bun run check:ts` exit 0.
- `bun --cwd packages/coding-agent src/cli.ts doctor --help` prints doctor-specific help.
