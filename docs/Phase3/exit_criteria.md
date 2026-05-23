# Phase3 Exit Criteria

Phase3 closes only when every check below holds against current-state evidence.

## Mandatory checks

1. **Typecheck maintained.** `bun run check:ts` exit 0, error count 0.

2. **Aggregate test sweep clean.** `bun --cwd packages/coding-agent test test/autonomy test/metrics test/observability test/task test/learning test/rules test/nexus test/goals test/cli test/subagent test/memory-backend test/edit test/tools` exits 0 with zero fails. The Phase2 carryover failure `test/cli/memory-doctor.test.ts` `sessions\0` must no longer reproduce in aggregate.

3. **Rules-run no-crash.** Smoke test `amaze rules run --since 0 --quiet` against a minimal observability JSONL on every builtin rule. Exit code 0. No uncaught exceptions. Verified by a new integration test that loads the default builtin rule set and runs `evaluateRule` on a representative event stream for each rule.

4. **Memory CLI workflow.** `amaze memory --help` lists `search`, `mark-superseded`, `quarantine`, `doctor`, `migrate-legacy`. Each subcommand has its own help, an integration test under `test/cli/memory-*.test.ts`, and survives a scripted workflow: search → identify stale id → mark-superseded → re-search shows it as superseded.

5. **Objective preview.** `amaze objective preview --id <objId>` prints the proposal the autonomy planner would emit given current metrics, without mutating ProposalStore. When autonomy is disabled the preview still works. Test at `test/cli/objective-preview.test.ts`.

6. **Root `amaze doctor`.** `amaze doctor` is registered as a top-level subcommand (not routed to `launch`). Output aggregates: typecheck status (optional, may be omitted if outside the CLI's purview), memory doctor result, metrics availability, rules engine load status, observability sink reachability. Test at `test/cli/doctor.test.ts`.

7. **`prompt.cache` covered.** Production turn path emits `prompt.cache` events with `sessionId`, `ts`, `readTokens`, `writeTokens`, `missReason`. The observability-coverage row in `docs/Phase2/observability-coverage.md` flips from `unimplemented` to `covered` with a direct emission test reference.

8. **No silent shrink.** Every Phase3 ticket either lands fully or is explicitly abandoned with a Phase4 ticket stub. Stub-and-skip is prohibited.

## Closing artifact

- `docs/Phase3/closing-report.md` with sections: Summary, Typecheck, Test sweep, Per-ticket status, Exit criteria checklist, Open follow-ups, Next steps.
