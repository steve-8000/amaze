# Phase3 — Self-improving runtime stabilization

## 0. Naming

Phase1 = scaffold landed. Phase2 = scaffold hardened. **Phase3 = stabilization for production claim.**

Phase3 is *not* feature expansion. It closes the concrete operational gaps Phase2 surfaced during the operator review and integration sweep.

## 1. Position vs. Phase2

| Layer | Phase2 result | Phase3 obligation |
|---|---|---|
| Typecheck | exit 0, 0 errors | maintain 0 |
| Runtime (Goal/Verifier/MutationScope) | hardened | no change |
| Observability event stream | 13/14 emit sites covered | implement `prompt.cache` (14/14) |
| Rule DSL (4-tier scan) | evaluator + 9 builtin rules | runtime crash on `ratio $.usedHits / $.hits` aggregate must close |
| LearningProposal + Eval gate | sandbox-replay + apply-side regression gate | no change |
| Versioned apply/rollback | snapshots + patch hash gate | no change |
| Metrics | 10 definitions, schema-valid keys | no change |
| Autonomy | default-OFF skeleton | non-mutating preview command |
| Memory governance | Nexus + skill lifecycle + static fence | operator CLI for stale-fact workflow |
| Operator UX | scattered subcommands | unified `amaze doctor` entry |
| Test isolation | 1 aggregate-only flake (`sessions\0`) | flake closed |

## 2. Source of truth

`docs/Phase2/closing-report.md` and `docs/Phase2/operator-cli-review.md` enumerated five operator-CLI items and one aggregate-only test flake. Phase3 closes them. Phase2 observability-coverage audit identified `prompt.cache` as unimplemented; Phase3 closes that.

## 3. Tickets

| Phase | ID | Ticket | Doc |
|---|---|---|---|
| P0 | T12.1 | `rules run` aggregate crash (rule/evaluator mismatch) | `01_rules_aggregate_ratio.md` |
| P0 | T12.2 | `memory-doctor` aggregate-only `sessions\0` flake | `02_memory_doctor_flake.md` |
| P1 | T12.3 | Memory stale-fact CLI workflow | `03_memory_workflow_cli.md` |
| P1 | T12.4 | Autonomy objective preview command | `04_objective_preview_cli.md` |
| P1 | T12.5 | Root `amaze doctor` health-check command | `05_root_doctor_cli.md` |
| P2 | T12.6 | `prompt.cache` event emission | `06_prompt_cache_emit.md` |

`README.md` is the orchestration view. `exit_criteria.md` is the gate.

## 4. Exit gates (must all hold)

1. `bun run check:ts` exit 0 (maintained).
2. Aggregate `bun --cwd packages/coding-agent test` exit 0 — including the previously flaky `test/cli/memory-doctor.test.ts` in aggregate context.
3. `amaze rules run --since <ms>` completes without uncaught exceptions on the full default rule set.
4. `amaze memory search <q>`, `amaze memory mark-superseded <id>`, `amaze memory quarantine <id>` all work with verified output paths.
5. `amaze objective preview` returns a non-mutating proposal for an active objective whose metric mismatches.
6. `amaze doctor` is the documented top-level entry that aggregates `memory doctor`, `metrics show`, `rules run --quiet`, observability sink presence.
7. `prompt.cache` SessionEvent emitted from the production turn path with read/write token detail when provider metadata is available; observability coverage row flipped from `unimplemented` to `covered`.

## 5. Non-goals

- Autonomy default ON.
- Phase4 architecture.
- New rule scans or new metric definitions.
- LLM-judge backend.
- 1-week dogfood — operational, not a Phase3 ticket. Phase3 makes the dogfood possible; the dogfood itself remains a separate operator obligation tracked in `docs/Phase1/00_overview.md` §5.
