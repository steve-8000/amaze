# Phase2 driving doc (orchestrator playbook)

> **Status:** Historical implementation record. This driving doc documents the completed Phase2 orchestration plan and dispatch conventions; use the canonical repository README and docs index for current system state.

## Intent

Run Phase2 via parallel `task` dispatch only. Parent owns todo + integration + verification. Subagents own ticket implementation.

## Phase order

```
Phase 2P0  (parallel-safe)
  T11.1 typecheck-clean
  T11.2 autonomy-planner-correctness
  T11.3 contract-adoption-metric

Phase 2P1  (parallel-safe; depends only on P0 schema/metric alignments)
  T11.4 sandbox-replay
  T11.5 verifier-doc-alignment
  T11.6 rule-aggregation
  T11.7 regression-command-gate

Phase 2P2  (parallel-safe)
  T11.8 fts-explicit-advanced
  T11.9 observability-coverage-audit
  T11.10 operator-cli-review

Phase 2Ω   (integration)
  Final typecheck + test sweep + Phase2 closing report
```

## Dispatch contract

Each `task` call MUST include:

- `role`, `scope.include`, `scope.exclude` (others' files explicitly excluded).
- `successCriteria` with concrete `command-exit` or `command-output` for each acceptance check.
- `inputArtifact` pointing at the per-ticket doc.
- `escalation.onUncertainty = ask-parent` and a real budget cap.
- `outputContract.mustProduce` enumerating expected artifacts.

## Coordination

- IRC for cross-ticket questions (event schema additions, metric key renames).
- T11.3 adds `hasContract: boolean` to `SessionEvent['subagent.start']`. T11.2 consumes the matching renamed metric key. Sequence inside a single batch is OK if peers reach each other on IRC.
- T11.4 and T11.7 share replay infrastructure (`learning/eval/replay.ts`, `learning/apply/index.ts`). Coordinate via IRC; do not split same file across two parallel agents unless write-disjoint regions guaranteed.

## Forbidden scope-bleed

- Subagents NEVER touch `docs/Phase1/**` (frozen).
- Subagents NEVER edit `package.json` scripts (Phase1 settled).
- Subagents NEVER rename existing rules or metrics that aren't called out in the ticket.

## Integration cadence

After each phase batch returns: re-read `closing-report` style summary, append integration row to `docs/Phase2/integration-log.md`, mark todos, dispatch next batch.

## Verification ladder

1. Per-ticket acceptance command (each successCriteria).
2. Phase-batch sweep on changed directories only.
3. Final 2Ω full repo: `bun run check:ts` + `bun --cwd packages/coding-agent test`.
4. Closing report at `docs/Phase2/closing-report.md` mirroring Phase1's structure.

## Ticket index

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
|—|[00_overview.md](00_overview.md)|P0|planned|—|—|
|T11.1|[01_typecheck_clean.md](01_typecheck_clean.md)|P0|landed (2026-05-23)|—|closing-report Per-ticket status row T11.1; `bun run check:ts`|
|T11.2|[02_autonomy_planner_correctness.md](02_autonomy_planner_correctness.md)|P0|landed (2026-05-23)|—|closing-report Per-ticket status row T11.2; `test/autonomy`|
|T11.3|[03_contract_adoption_metric.md](03_contract_adoption_metric.md)|P0|landed (2026-05-23)|—|closing-report Per-ticket status row T11.3; `test/metrics`, `test/observability`|
|T11.4|[04_eval_sandbox_replay.md](04_eval_sandbox_replay.md)|P1|landed (2026-05-23)|T11.3|closing-report Per-ticket status row T11.4; `test/learning/sandbox-replay.test.ts`|
|T11.5|[05_verifier_doc_alignment.md](05_verifier_doc_alignment.md)|P1|landed (2026-05-23)|—|closing-report Per-ticket status row T11.5|
|T11.6|[06_rule_aggregation_layers.md](06_rule_aggregation_layers.md)|P1|landed (2026-05-23)|—|closing-report Per-ticket status row T11.6; `test/rules/aggregation.test.ts`|
|T11.7|[07_regression_command_gate.md](07_regression_command_gate.md)|P1|landed (2026-05-23)|T11.4|closing-report Per-ticket status row T11.7; `test/learning/apply-regression-gate.test.ts`|
|T11.8|[08_fts_explicit_advanced.md](08_fts_explicit_advanced.md)|P2|landed (2026-05-23)|—|closing-report Per-ticket status row T11.8; `test/nexus/fts-escape.test.ts`|
|T11.9|[09_observability_coverage_audit.md](09_observability_coverage_audit.md)|P2|landed (2026-05-23)|—|closing-report Per-ticket status row T11.9; docs/Phase2/observability-coverage.md|
|T11.10|[10_operator_cli_review.md](10_operator_cli_review.md)|P2|landed (2026-05-23)|—|closing-report Per-ticket status row T11.10; docs/Phase2/operator-cli-review.md|
|—|[exit_criteria.md](exit_criteria.md)|Ω|closed|—|closing-report Exit criteria checklist|
|—|[closing-report.md](closing-report.md)|Ω|closed|—|—|

## Reference docs

| 문서 | 목적 | Status |
|---|---|---|
| [verifier-policy.md](verifier-policy.md) | Verifier uncertain policy reference for T11.5. | landed (2026-05-23) — reference |
| [observability-coverage.md](observability-coverage.md) | Observability coverage audit required by T11.9. | landed (2026-05-23) — reference |
| [operator-cli-review.md](operator-cli-review.md) | Operator CLI scenario review required by T11.10. | landed (2026-05-23) — reference |
