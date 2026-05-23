# Phase2 driving doc (orchestrator playbook)

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
