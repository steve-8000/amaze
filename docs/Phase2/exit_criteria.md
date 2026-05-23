# Phase2 Exit Criteria

Phase2 closes only when **every** check below is observed in current-state evidence. Budget exhaustion is not completion.

## Mandatory checks

1. **Typecheck clean.**
   - Command: `bun run check:ts`
   - Expected exit: `0`
   - Expected stdout pattern: no `error` lines from biome or tsc.

2. **Test sweep clean.**
   - Command: `bun --cwd packages/coding-agent test`
   - Expected exit: `0` with zero `fail`.
   - Skipped tests are acceptable only if `Phase1/closing-report.md` already documented them as deliberate skips.

3. **Autonomy planner schema validity.**
   - For every metric in `BUILTIN_REMEDIATIONS`, the produced `LearningProposal.patch` keys MUST validate against `settings-schema.ts`. Concretely: `goal.uncertainPolicy` ∈ `allow|warn|block-manual|block-all`.
   - For every key in `BUILTIN_REMEDIATIONS`, an exact metric of that name MUST exist in `metricDefinitions`.
   - Verification: `packages/coding-agent/test/autonomy/planner-correctness.test.ts` (new) asserts both invariants.

4. **`subagent.contractAdoption` measures contracts, not isolation.**
   - `SessionEvent['subagent.start']` has `hasContract: boolean`.
   - `metricDefinitions.find(m => m.name === 'subagent.contractAdoption').reducer` uses `event.hasContract`.
   - Emit site in `task/executor.ts` sets `hasContract` from the actual contract envelope, not from worktree isolation flag.
   - Test: `test/metrics/contract-adoption.test.ts` (new).

5. **Sandbox replay reachable.**
   - `evaluateProposal({ regressionCommands: [...] })` invokes `runSandboxReplay()` and the result is included in the report.
   - `runSandboxReplay()` checks out current head into a temp worktree, applies the proposal patch (snapshot-based dry-run), runs the regression commands, captures exit codes, and reverts.
   - Tests at `test/learning/sandbox-replay.test.ts` cover: clean pass, command-exit fail surfaces fail, timeout, worktree cleanup on error.

6. **Verifier doc/code aligned.**
   - `goals/verifier.ts` head comment no longer states "uncertain does NOT block completion" without the contract-mode qualifier.
   - `docs/Phase1/02_verifier_hardening.md` referenced behaviour matches `runtime.completeGoalFromTool` flow.
   - Test: grep `uncertain does NOT block` in `src/goals/**.ts` returns 0 matches.

7. **Rule aggregation expanded.**
   - `rules/evaluator.ts` accepts `scan: events | session | request | workspace`.
   - `session` aggregates events grouped by `sessionId`; `request` groups by `turn` index; `workspace` aggregates across all sessions in a window.
   - At least one builtin rule per aggregation tier ships under `rules/builtin/`.
   - Test: `test/rules/aggregation.test.ts` covers all four tiers.

8. **Regression-command gate at apply.**
   - `applyProposal` refuses `apply` when proposal `type ∈ {settings, rule, skill}` AND `regressionCommands.length > 0` AND last evaluation predates patch hash.
   - Stale-eval rejection is surfaced through proposal event history.
   - Test: `test/learning/apply-regression-gate.test.ts`.

9. **FTS advanced query opt-in.**
   - `escapeFts5Query(query, { advanced?: boolean })` defaults to `advanced: false`. When false, ALL queries are FTS-quoted irrespective of substring match.
   - Callers that genuinely want operator queries pass `{ advanced: true }` explicitly. Two call sites updated: `nexus/session-search.ts`, `nexus/store.ts`.
   - Test: `test/nexus/fts-escape.test.ts`.

10. **Observability coverage report exists.**
    - `docs/Phase2/observability-coverage.md` enumerates every emit site against the schema and identifies any TODO (e.g. `prompt.cache`).
    - Each emit site has at least one assertion in tests.

11. **Operator CLI review report exists.**
    - `docs/Phase2/operator-cli-review.md` exercises `amaze observe`, `amaze rules`, `amaze proposals`, `amaze metrics`, `amaze objective`, `amaze doctor` against representative scenarios and lists missing affordances (if any) as P3 tickets.

## Closing artifact

- `docs/Phase2/closing-report.md` with sections: Summary, Typecheck, Test sweep, Per-ticket status, Open follow-ups.
- 1-week dogfood window OPTIONAL for Phase2 closure (it remains a Phase1 §5 obligation for Level-4 production claim, not a Phase2 ticket).
