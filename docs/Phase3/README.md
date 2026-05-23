# Phase3 driving doc

## Intent

Phase3 closes Phase2's leftover operational gaps. Same orchestrator pattern as Phase1/Phase2: parallel `task` dispatch only.

## Phase order

```
Phase 3P0  (parallel-safe)
  T12.1 rules-aggregate-ratio
  T12.2 memory-doctor-flake

Phase 3P1  (parallel-safe)
  T12.3 memory-workflow-cli
  T12.4 objective-preview-cli
  T12.5 root-doctor-cli

Phase 3P2
  T12.6 prompt-cache-emit

Phase 3Ω   (integration)
  Closing report + observability-coverage audit row flip
```

## Dispatch contract

Each `task` call MUST include:

- `role`, `scope.include`, `scope.exclude`.
- `successCriteria` with concrete `command-exit` per acceptance.
- `inputArtifact` pointing at the per-ticket doc.
- `escalation.onUncertainty = ask-parent`.
- `outputContract.mustProduce` enumerating expected artifacts.

## Coordination

- T12.5 (root doctor) consumes T12.2's restored memory-doctor command. Dispatch T12.5 in P1 after T12.2 P0 lands.
- T12.3 (memory CLI) touches `cli/memory.ts` and `commands/memory.ts`. T12.5 (root doctor) imports memory doctor symbols. T12.3 must not rename existing exports.
- T12.6 needs both schema (already declares `prompt.cache`) and a production emit site. Must coordinate with prompt-cache-policy. If provider response metadata is unavailable, emission with partial fields is acceptable; the ticket spec defines minimum fields.

## Forbidden scope-bleed

- Subagents NEVER touch `docs/Phase1/**` or `docs/Phase2/**` other than the explicit row flips called out per ticket.
- Subagents NEVER edit `package.json` scripts.
- Subagents NEVER rename existing schema variants or metric names.

## Verification ladder

1. Per-ticket acceptance command.
2. Phase-batch sweep on changed directories.
3. Final 3Ω full `bun run check:ts` + aggregate `bun --cwd packages/coding-agent test`.
4. Closing report at `docs/Phase3/closing-report.md` mirroring Phase2's structure.

## Ticket index

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
|—|[00_overview.md](00_overview.md)|Ω|closed|—|—|
|T12.1|[01_rules_aggregate_ratio.md](01_rules_aggregate_ratio.md)|P0|landed (2026-05-23)|—|closing-report T12.1 row; `packages/coding-agent/test/cli/rules-run-smoke.test.ts`|
|T12.2|[02_memory_doctor_flake.md](02_memory_doctor_flake.md)|P0|landed (2026-05-23)|—|closing-report T12.2 row; aggregate sweep|
|T12.3|[03_memory_workflow_cli.md](03_memory_workflow_cli.md)|P1|landed (2026-05-23)|—|closing-report T12.3 row; `test/cli/memory-*.test.ts`|
|T12.4|[04_objective_preview_cli.md](04_objective_preview_cli.md)|P1|landed (2026-05-23)|—|closing-report T12.4 row; `packages/coding-agent/test/cli/objective-preview.test.ts`|
|T12.5|[05_root_doctor_cli.md](05_root_doctor_cli.md)|P1|landed (2026-05-23)|T12.2, T12.3|closing-report T12.5 row; `packages/coding-agent/test/cli/doctor.test.ts`|
|T12.6|[06_prompt_cache_emit.md](06_prompt_cache_emit.md)|P2|landed (2026-05-23)|—|closing-report T12.6 row; `packages/coding-agent/test/observability/prompt-cache-emit.test.ts`|
|—|[exit_criteria.md](exit_criteria.md)|Ω|landed (2026-05-23)|T12.1–T12.6|closing-report exit criteria checklist|
|—|[closing-report.md](closing-report.md)|Ω|closed|T12.1–T12.6|—|

## Reference docs

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
|—|[cli-root-doctor.md](cli-root-doctor.md)|P1|superseded-by: docs/Phase3/05_root_doctor_cli.md|T12.5|—|
|—|[cli-objective-preview.md](cli-objective-preview.md)|P1|superseded-by: docs/Phase3/04_objective_preview_cli.md|T12.4|—|
|—|[cli-memory-stale-fact-workflow.md](cli-memory-stale-fact-workflow.md)|P1|superseded-by: docs/Phase3/03_memory_workflow_cli.md|T12.3|—|
|—|[cli-rules-run-aggregate-ratio.md](cli-rules-run-aggregate-ratio.md)|P0|superseded-by: docs/Phase3/01_rules_aggregate_ratio.md|T12.1|—|
|—|[prompt-cache-emit.md](prompt-cache-emit.md)|P2|superseded-by: docs/Phase3/06_prompt_cache_emit.md|T12.6|—|
