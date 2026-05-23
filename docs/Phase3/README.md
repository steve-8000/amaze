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
