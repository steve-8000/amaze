# Phase2 — Self-improving Runtime Hardening

## 0. Naming

Phase1 = "scaffold landed". Phase2 = "scaffold hardened to production".
Goal label: **Level 4 production-ready self-improving runtime**.

## 1. Position vs. Phase1

| Layer | Phase1 result | Phase2 obligation |
|---|---|---|
| Runtime (Goal/Subagent/Verifier/MutationScope) | Strengthened | Doc drift cleanup |
| Observability | EventBus + JSONL sink + 9 emit sites | Coverage audit, contract field gaps |
| Rule DSL | Markdown + safe expr + evaluator (scan=events only) | session/request aggregation |
| LearningProposal | Store + provenance/contradiction/replay gates | Sandbox-replay gate (real regression) |
| Versioned apply/rollback | Snapshot+atomic write | Regression command gate before apply |
| Metrics | 10 definitions | Key alignment + true `hasContract` field |
| Autonomy | Skeleton (default OFF) | Planner enum/metric correctness |
| CI cleanliness | 22 errors (Class A=0 from Phase1) | All `check:ts` green |

Phase2 is *not* a feature expansion. It closes correctness gaps the external review flagged after Phase1 landed.

## 2. Source of truth

External review identified concrete bugs against current `main`:

- `autonomy/planner.ts` emits `"goal.uncertainPolicy": "ask" | "complete"` — both invalid against `allow | warn | block-manual | block-all`.
- `autonomy/planner.ts` keys metrics as `force_complete_rate` / `verifier_bypass_rate` / `shell_criteria_bypass_rate` — none of these match registered metric definitions (`goal.forceCompleteRate`, `verifier.bypassRate`, none for shell-criteria-bypass).
- `metrics/definitions.ts` `subagent.contractAdoption` uses `event.isolated` though `subagent.start` schema has no `hasContract` field — metric actually measures isolation adoption.
- `learning/eval/replay.ts` is event-log replay, not sandbox/command replay; not a real regression gate.
- `goals/verifier.ts:15-17` header comment still says "uncertain does NOT block completion" though runtime now honours `goal.uncertainPolicy` with contract-mode blocking.
- `nexus/session-search.ts:478` and `nexus/store.ts:1640` `escapeFts5Query` returns raw query when input contains `OR|AND|NOT|NEAR`; parameter-bound so not SQLi but semantics ambiguity remains. Should be explicit `advanced` opt-in.

These are the P0/P1/P2 inputs.

## 3. Tickets

| Phase | ID | Ticket | Doc |
|---|---|---|---|
| P0 | T11.1 | `check:ts` clean (drop to 0 errors) | `01_typecheck_clean.md` |
| P0 | T11.2 | Autonomy planner correctness (enum + metric keys) | `02_autonomy_planner_correctness.md` |
| P0 | T11.3 | `subagent.contractAdoption` true contract field | `03_contract_adoption_metric.md` |
| P1 | T11.4 | Sandbox-replay eval gate | `04_eval_sandbox_replay.md` |
| P1 | T11.5 | Verifier doc/code alignment | `05_verifier_doc_alignment.md` |
| P1 | T11.6 | Rule DSL session/request aggregation | `06_rule_aggregation_layers.md` |
| P1 | T11.7 | Mandatory regression-command gate at apply | `07_regression_command_gate.md` |
| P2 | T11.8 | FTS advanced query explicit opt-in | `08_fts_explicit_advanced.md` |
| P2 | T11.9 | Observability coverage audit | `09_observability_coverage_audit.md` |
| P2 | T11.10 | Operator CLI review | `10_operator_cli_review.md` |

`README.md` is the orchestration view. `exit_criteria.md` is the gate.

## 4. Exit gates (must all hold)

1. `bun run check:ts` exit 0.
2. `bun --cwd packages/coding-agent test` exit 0 over all directories Phase1 closed.
3. `amaze autonomy enable` does not emit a settings proposal that fails schema validation.
4. `subagent.contractAdoption` numerator counts subagents launched **with** an enforced contract envelope (`hasContract === true`), and Phase1 contract-using tests show it ≥ baseline.
5. `evaluateProposal` invokes sandbox replay when the proposal carries regression-commands; bypassing without commands requires `goal.uncertainPolicy != block-*` policy.
6. `verifier.ts` head comment and `docs/Phase1/02_verifier_hardening.md` agree with runtime behaviour.
7. `amaze rules show --aggregate session|request|workspace` returns useful results.
8. `escapeFts5Query` no longer enters raw mode without `advanced: true` flag.

## 5. Non-goals

- Autonomy default ON. Stays default OFF.
- New Nexus features.
- Agent count / new tool families.
- LLM-judge backend.

Phase2 is hardening. Phase3 is when feature scope opens again.
