# T11.1 — `check:ts` clean
> **Ticket**: T11.1
> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase2/closing-report.md

## Current state (grounded)

`docs/Phase1/closing-report.md` snapshot: `bun run check:ts` → exit 1, 22 errors. Class A (Phase1-introduced regressions) = 0. The 22 remaining errors are pre-existing or external. Concrete files:

- `packages/agent/src/compaction/compaction.ts` — organize-imports blank-line error.
- `packages/agent/test/compaction-reasoning.test.ts` — import name ordering.
- `packages/coding-agent/scripts/nexus-behavioral-ab.ts` — import ordering, `forEach` callback returning value.
- `packages/coding-agent/scripts/nexus-cold-quantitative.ts` — `forEach` callback returning value.
- `packages/coding-agent/src/modes/acp/acp-agent.ts` — import ordering.
- `packages/coding-agent/src/modes/components/settings-defs.ts` — unused `Settings` import.
- `packages/coding-agent/src/modes/controllers/input-controller.ts` — import ordering.
- `packages/coding-agent/src/modes/interactive-mode.ts` — import name ordering.
- `packages/coding-agent/src/nexus/commands.ts` — import ordering.
- `packages/coding-agent/src/nexus/doctor.ts` — import ordering.
- `packages/coding-agent/src/nexus/index.ts` — export ordering.
- `packages/coding-agent/src/nexus/knowledge/migration.ts` — import ordering.
- `packages/coding-agent/src/nexus/knowledge/store.ts` — import ordering AND assignment-in-expression.
- `packages/coding-agent/src/slash-commands/builtin-registry.ts` — import ordering.
- `packages/coding-agent/test/nexus-agi-features.test.ts` — import ordering, unused `NexusEmbeddingClient` import.
- `packages/coding-agent/test/nexus-knowledge-db-migration.test.ts` — import ordering.
- `packages/coding-agent/test/nexus-knowledge.test.ts` — import ordering.
- `packages/coding-agent/test/session-manager/build-context.test.ts` — import ordering.

## Acceptance

- `bun run check:ts` exit code 0.
- Diff for each touched file is biome-driven only: organize-imports + unused-removal + the one assignment-in-expression rewrite in `nexus/knowledge/store.ts`.
- No public API surface changes (no rename, no signature edit).

## Implementation rules

1. For each file, run `bunx biome check --apply <file>` then manually inspect for any non-import diff. Discard non-import diffs unless directly the error.
2. `assignment-in-expression` in `nexus/knowledge/store.ts`: hoist the assignment to its own statement before the conditional; do not refactor surrounding logic.
3. `forEach` callbacks that return values in `scripts/nexus-*.ts`: replace `arr.forEach(x => state.push(...))` returning the result with explicit block body `{ state.push(...); }`, or convert to `for...of`. Either is acceptable; pick whichever produces the smaller diff.
4. Unused imports: remove. Do not leave commented-out lines.

## Boundaries

- **Do** touch only the 18 files listed above.
- **Do not** touch any file under `packages/coding-agent/src/{goals,subagent,task,nexus/{store.ts,pipeline.ts,session-search.ts},learning,metrics,autonomy,rules,observability,memory-backend,config,tools,edit,capability,commands,cli,cli.ts}` unless that exact path is in the list. (Most aren't.)
- **Do not** alter test assertions; only fix lint-class issues in the test files.

## Risk and rollback

Mechanical biome-driven cleanup. Rollback is `git checkout -- <file>` per file. No behavioural risk.

## Verification

- `bun run check:ts` exit 0.
- `bun --cwd packages/coding-agent test test/nexus test/session-manager` exit 0 (sanity on touched test files).
