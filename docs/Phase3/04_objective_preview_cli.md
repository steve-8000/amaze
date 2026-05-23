# T12.4 — Autonomy objective preview command
> **Ticket**: T12.4
> **Phase**: P1
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase3/closing-report.md


## Current state (grounded)

`amaze objective` exposes create/list/enable/disable/delete (CRUD). No non-mutating preview. Phase2 operator review Scenario D: with autonomy disabled (default), an operator cannot see what proposal would be emitted.

`planFromMetrics(objective, metrics, opts)` in `src/autonomy/planner.ts` already returns a `LearningProposal | null` without persisting anything. The CLI just needs to wire current state to it.

## Acceptance

1. `amaze objective preview --id <objId> [--metrics <jsonPath>] [--json]` prints the would-be proposal for an active objective, without writing to ProposalStore.
2. When `--metrics` is omitted, the command reads current metrics from the observability window (default: last 7 days) via the same MetricEngine call path that `amaze metrics show` uses.
3. When `--metrics` is provided, it's a JSON file `{ <metric>: <value>, ... }` used in place of measured metrics. Useful for dry-runs.
4. Output (text format): proposal type, patch, rollback, reason, mismatch metric and target. Output (`--json`): the `LearningProposal` shape exactly as returned by `planFromMetrics`.
5. When `planFromMetrics` returns null (all targets satisfied), the command exits 0 with a "no remediation needed" message.
6. Works regardless of `autonomy.enabled`. Document this explicitly in the help text.
7. New test `packages/coding-agent/test/cli/objective-preview.test.ts`:
   - active objective + mismatched metric → proposal output.
   - active objective + satisfied metric → "no remediation needed".
   - unknown objective id → non-zero exit + stderr message.
   - autonomy.enabled=false → preview still works.
   - Verify no row is added to ProposalStore by checking row count before and after.

## Implementation outline

1. Add `preview` subcommand in `src/commands/objective.ts` and `src/cli/objective.ts`.
2. Resolve objective by id from ObjectiveStore.
3. Resolve metrics: read from observability sink via `MetricEngine.window()` (or whatever the metrics show command uses). When `--metrics` is provided, parse the JSON file and override.
4. Call `planFromMetrics(objective, metrics, { settings: settings })` — passing the runtime settings instance for no-op suppression.
5. Format result. NEVER call `ProposalStore.upsert` or any mutating API.

## Boundaries

- Touch: `src/commands/objective.ts`, `src/cli/objective.ts`, `test/cli/objective-preview.test.ts` (new).
- Do NOT modify `planFromMetrics`.
- Do NOT modify ObjectiveStore or ProposalStore.

## Verification

- `bun --cwd packages/coding-agent test test/cli` exit 0.
- `bun --cwd packages/coding-agent test test/autonomy` exit 0 (no regression).
- `bun run check:ts` exit 0.
