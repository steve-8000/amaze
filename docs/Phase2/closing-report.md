# Phase2 Closing Report

## Summary

Phase2 hardening is code-complete against the 10 ticket docs, and the typecheck gate is now green, but the Phase2 exit gate is not fully closed because the aggregate Phase2 test sweep failed once in `test/cli/memory-doctor.test.ts`.

Phase1→Phase2 delta: `bun run check:ts` moved from Phase1's exit 1 / 22 errors to exit 0 / 0 errors; the aggregate Phase2 sweep moved from Phase1's broad 38-fail snapshot to 1 aggregate-only failure with the isolated failing directory passing.

## Typecheck

| Field | Result |
|---|---|
| Command | `bun run check:ts` |
| Exit code | 0 |
| Error count | 0 |
| Evidence | Biome checked 1816 files; workspace `tsgo -p tsconfig.json --noEmit` checks exited 0, including `@amaze/coding-agent`. |
| Baseline comparison | Phase1 closing recorded exit 1 with 22 errors. Phase2 reduces that baseline by 22 errors to a clean 0-error run. |

## Test sweep

Aggregate command:

```sh
bun --cwd packages/coding-agent test test/autonomy test/metrics test/observability test/task test/learning test/rules test/nexus test/goals test/cli test/subagent test/memory-backend test/edit test/tools
```

Aggregate result: exit 1; 1336 pass, 1 fail, 302 skip, 3921 assertions, 1639 tests across 189 files.

Failure observed:

```text
fail: test/cli/memory-doctor.test.ts > memory doctor > prints degraded status and the affected Nexus item
Expected to contain: "- session-reindex: ok"
Received: "Nexus status: degraded\n- maintenance: startup write failed\n- session-reindex: Error: ENOENT: no such file or directory, open '/var/folders/tc/56th_sqd0tdb3t0m62v53q5h0000gn/T/nexus-backend-activity-agent-14ec6a53fc79855c/sessions\0'\n- knowledge-migration: ok\n"
```

Per-directory sweep for directories that failed in aggregate:

| Directory | Command | Exit | Pass | Fail | Skip | Total run | Result |
|---|---|---:|---:|---:|---:|---:|---|
| `test/cli` | `bun --cwd packages/coding-agent test test/cli` | 0 | 42 | 0 | 0 | 42 | Passed in isolation; the aggregate failure was not reproduced by the required per-directory sweep. |

## Per-ticket status

| Ticket | Status | Acceptance-linked tests / checks |
|---|---|---|
| T11.1 `check:ts` clean | Pass | `bun run check:ts` exit 0; 0 errors, down from Phase1's 22. |
| T11.2 Autonomy planner correctness | Pass | Aggregate included `test/autonomy`; required tests exist: `test/autonomy/planner-correctness.test.ts`, `test/autonomy/planner-emits-valid-proposal.test.ts`. |
| T11.3 `subagent.contractAdoption` true contract field | Pass | Aggregate included `test/metrics` and `test/observability`; source evidence: `SessionEvent['subagent.start']` has `hasContract`, reducer uses `event.hasContract`, task executor emits `hasContract: options.contract !== undefined`. |
| T11.4 Sandbox-replay eval gate | Pass | Aggregate included `test/learning`; source evidence: `evaluateProposal` invokes `runSandboxReplay` when `regressionCommands` are present; `test/learning/sandbox-replay.test.ts` exists. |
| T11.5 Verifier doc/code alignment | Pass | `search` for `uncertain does NOT block` under `packages/coding-agent/src` returned 0 matches. |
| T11.6 Rule DSL session/request/workspace aggregation | Pass | Aggregate included `test/rules`; source evidence: `RuleScan = "events" | "session" | "request" | "workspace"`; evaluator groups session/request/workspace; builtin rules include session/request/workspace rules; `test/rules/aggregation.test.ts` exists. |
| T11.7 Mandatory regression-command gate at apply | Pass | Aggregate included `test/learning`; source evidence: apply rejection reasons include `stale-eval`, patch hash is compared against last eval, and `test/learning/apply-regression-gate.test.ts` covers stale-eval/missing-sandbox/sandbox-fail paths. |
| T11.8 FTS advanced query explicit opt-in | Pass | Aggregate included `test/nexus`; source evidence: `escapeFts5Query` defaults to quoting, only returns raw query with `{ advanced: true }`, and both Nexus call sites pass explicit `advancedQuery === true`; `test/nexus/fts-escape.test.ts` exists. |
| T11.9 Observability coverage audit | Pass | `docs/Phase2/observability-coverage.md` exists. |
| T11.10 Operator CLI review | Pass | `docs/Phase2/operator-cli-review.md` exists. |

## Exit criteria checklist

| # | Exit criterion | Status | Current-state evidence |
|---:|---|---|---|
| 1 | Typecheck clean | Pass | `bun run check:ts` exit 0; error count 0. |
| 2 | Test sweep clean | Fail | Required aggregate sweep exited 1 with 1336 pass, 1 fail, 302 skip. Isolated `test/cli` sweep exited 0. |
| 3 | Autonomy planner schema validity | Pass | Required invariant tests exist and were included in aggregate: `test/autonomy/planner-correctness.test.ts`, `test/autonomy/planner-emits-valid-proposal.test.ts`. |
| 4 | `subagent.contractAdoption` uses `hasContract` | Pass | `event-schema.ts` includes `hasContract: boolean`; `metrics/definitions.ts` reducer uses `event.hasContract`; `task/executor.ts` emits `hasContract: options.contract !== undefined`; `test/metrics/contract-adoption.test.ts` exists. |
| 5 | Sandbox replay reachable | Pass | `evaluateProposal` calls `runSandboxReplay` for proposals with regression commands; `test/learning/sandbox-replay.test.ts` covers pass, command fail, timeout, and cleanup. |
| 6 | Verifier doc/code aligned | Pass | `search` for `uncertain does NOT block` in `packages/coding-agent/src` returned 0 matches. |
| 7 | Rule aggregation expanded | Pass | `rules/evaluator.ts` accepts four scans and groups by event/session/request/workspace; builtin rule files cover session, request, workspace in addition to existing event rules; `test/rules/aggregation.test.ts` covers the tiers. |
| 8 | Regression-command gate at apply | Pass | `applyProposal` rejects stale evals via patch hash mismatch and records `stale-eval`; `test/learning/apply-regression-gate.test.ts` exists. |
| 9 | FTS advanced query opt-in | Pass | `escapeFts5Query(query, opts)` quotes by default and only allows raw advanced syntax with `{ advanced: true }`; `session-search.ts` and `store.ts` pass explicit advanced flags; `test/nexus/fts-escape.test.ts` exists. |
| 10 | Observability coverage report exists | Pass | `docs/Phase2/observability-coverage.md` exists. |
| 11 | Operator CLI review report exists | Pass | `docs/Phase2/operator-cli-review.md` exists. |

## Open follow-ups

- Phase2 cannot be marked fully closed until the aggregate Phase2 test sweep exits 0. The only observed failure is `test/cli/memory-doctor.test.ts` in the aggregate command, where `session-reindex` reported an ENOENT path ending in `sessions\0`; `test/cli` passed when rerun in isolation.
- Skipped tests remain at 302 in the aggregate sweep, matching the Phase1 closing snapshot's documented skip count. No new skip rationale was evaluated beyond the aggregate count.
- `prompt.cache` remains the known observability limitation tracked by the Phase2 observability coverage work rather than implemented in this closure step.
- Autonomy remains default OFF; Phase2 validates planner correctness and gates, not production enablement.

## Next steps

- Phase3 candidate: investigate and fix the aggregate-only `memory doctor` / `session-reindex` ENOENT involving a `sessions\0` path, then rerun the same aggregate sweep until exit 0.
- Phase3 candidate: close the `prompt.cache` observability gap identified by the coverage audit.
- Phase3 candidate: dogfood the self-improvement loop with real JSONL sessions, proposal evaluation, metrics, and rules over a one-week window before making a Level-4 production claim.
- Dogfood window note: Phase2 closure does not require the one-week dogfood window, but Phase1 documented it as required evidence for a Level-4 production claim.
