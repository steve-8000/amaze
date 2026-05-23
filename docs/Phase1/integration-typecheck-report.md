# Phase1 Integration Typecheck Report

## Run

- Command: `bun run check:ts`
- Exit code: 1
- Full output capture: `artifact://209`
- Expanded diagnostic capture (`bun run check:tools -- --max-diagnostics=200`, used only to reveal omitted diagnostics): `artifact://211`
- Overall error count: 32 errors
- Non-error diagnostics: 7 warnings, 2 infos

## Classification metadata

- A: 8 errors
- B: 24 errors
- C: 0 errors

## A. Phase1 regressions

Phase1 regression criteria applied: diagnostic path is under one of the requested Phase1 path groups and the file is currently modified/untracked in git status. All A items below are in `packages/coding-agent/src/tools/`, which is within the requested `src/tools/` path group.

### Summary by file

- `packages/coding-agent/src/tools/code-callees.ts`: 1 error
- `packages/coding-agent/src/tools/code-callers.ts`: 1 error
- `packages/coding-agent/src/tools/code-def.ts`: 1 error
- `packages/coding-agent/src/tools/code-refs.ts`: 1 error
- `packages/coding-agent/src/tools/index.ts`: 1 error
- `packages/coding-agent/src/tools/nexus-memory-explain.ts`: 1 error
- `packages/coding-agent/src/tools/repo-search.ts`: 1 error
- `packages/coding-agent/src/tools/session-search.ts`: 1 error

### Detailed A diagnostics

- `packages/coding-agent/src/tools/code-callees.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/code-callers.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/code-def.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/code-refs.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/index.ts:1` — `assist/source/organizeImports`: imports/exports are not organized, including newly added code search and nexus memory explain tool wiring.
- `packages/coding-agent/src/tools/nexus-memory-explain.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/repo-search.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants nexus knowledge imports before nexus scope and `ToolSession` before `resolveAgentCwd`.
- `packages/coding-agent/src/tools/session-search.ts:1` — `assist/source/organizeImports`: imports are not sorted; Biome wants `searchNexusSessionAnchors` before the prompt markdown import.

## B. Pre-existing / outside requested Phase1 path set

These are outside the requested A path set, even when currently modified. They are therefore counted as B under the provided rule.

- `packages/agent/src/compaction/compaction.ts`: 1 error
- `packages/agent/test/compaction-reasoning.test.ts`: 1 error
- `packages/coding-agent/scripts/nexus-behavioral-ab.ts`: 2 errors
- `packages/coding-agent/scripts/nexus-cold-quantitative.ts`: 1 error
- `packages/coding-agent/src/modes/acp/acp-agent.ts`: 1 error
- `packages/coding-agent/src/modes/components/settings-defs.ts`: 1 error
- `packages/coding-agent/src/modes/controllers/input-controller.ts`: 1 error
- `packages/coding-agent/src/modes/interactive-mode.ts`: 2 errors
- `packages/coding-agent/src/modes/utils/ui-helpers.ts`: 1 error
- `packages/coding-agent/src/nexus/commands.ts`: 1 error
- `packages/coding-agent/src/nexus/doctor.ts`: 1 error
- `packages/coding-agent/src/nexus/index.ts`: 1 error
- `packages/coding-agent/src/nexus/knowledge/migration.ts`: 1 error
- `packages/coding-agent/src/nexus/knowledge/store.ts`: 3 errors
- `packages/coding-agent/src/slash-commands/builtin-registry.ts`: 1 error
- `packages/coding-agent/test/nexus-agi-features.test.ts`: 2 errors
- `packages/coding-agent/test/nexus-knowledge-db-migration.test.ts`: 1 error
- `packages/coding-agent/test/nexus-knowledge.test.ts`: 1 error
- `packages/coding-agent/test/session-manager/build-context.test.ts`: 1 error

## C. Ambiguous boundary

- None: 0 errors

## Warnings / infos not counted as errors

- `packages/coding-agent/scripts/nexus-temp-ablation.ts`: 1 info (`lint/complexity/noUselessEscapeInRegex`)
- `packages/coding-agent/src/nexus/llm-client.ts`: 1 info (`lint/complexity/noUselessContinue`), 1 warning (`lint/complexity/useOptionalChain`)
- `packages/coding-agent/src/nexus/knowledge/indexer.ts`: 2 warnings (`lint/correctness/noUnusedVariables`)
- `packages/coding-agent/src/nexus/knowledge/store.ts`: 1 warning (`lint/style/useImportType`)
- `packages/coding-agent/src/nexus/knowledge/writeback.ts`: 1 warning (`lint/style/useImportType`)
- `packages/coding-agent/src/session/messages.ts`: 1 warning (`lint/correctness/noUnusedVariables`)
- `packages/coding-agent/scripts/nexus-cold-inspect.ts`: 1 warning (`lint/correctness/noUnusedVariables`)

## Recommended follow-up tickets for A

1. Tools import-order cleanup: run Biome organize-imports/fmt on `packages/coding-agent/src/tools/code-callees.ts`, `code-callers.ts`, `code-def.ts`, `code-refs.ts`, `nexus-memory-explain.ts`, `repo-search.ts`, and `session-search.ts`; no behavioral change expected.
2. Tool registry organization cleanup: run Biome organize-imports/fmt on `packages/coding-agent/src/tools/index.ts` and verify all newly wired tools remain exported/registered.
