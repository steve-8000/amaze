# T12.3 — Memory stale-fact CLI workflow

## Current state (grounded)

`amaze memory` exposes `doctor` and `migrate-legacy` only. Phase2 operator review Scenario C identified the gap: an operator cannot find stale facts, mark them superseded, and verify recall from the CLI.

NexusStore already supports the underlying operations:
- `store.search({ query, scope, limit })` returns hits.
- `store.markSuperseded(memoryId, reason?)` / equivalent — verify the actual API by reading `src/nexus/store.ts`.
- `store.quarantine(memoryId, reason?)` / equivalent — verify the actual API.

T12.3 wires those to the CLI.

## Acceptance

1. `amaze memory search <query> [--scope all|current_project|...] [--limit N] [--json]` prints matching memories with `id`, `status`, `content` (truncated), `provenance`. Both human and `--json` formats.
2. `amaze memory mark-superseded <id> [--reason <text>]` transitions a memory's status to `superseded` and records the reason in proposal event history (or a status-transition log if no proposal store backs the memory layer). Exit code 0 on success; non-zero with stderr message on unknown id.
3. `amaze memory quarantine <id> [--reason <text>]` transitions to `quarantined`. Same exit semantics.
4. Existing `amaze memory doctor` and `amaze memory migrate-legacy` continue to work. Their tests stay green.
5. Help text: `amaze memory --help` lists all five subcommands.
6. New integration tests at `packages/coding-agent/test/cli/memory-search.test.ts`, `memory-mark-superseded.test.ts`, `memory-quarantine.test.ts` cover happy path + unknown id + scoped search.

## Implementation outline

1. Read `src/nexus/store.ts` to identify the exact runtime API for status transitions. If `markSuperseded` / `quarantine` methods exist on NexusStore, wire CLI to them. If not, add minimal wrappers (status update via existing `upsert`-equivalent path) and an event-history record.
2. Add subcommand entries in `src/commands/memory.ts` and `src/cli/memory.ts`. Mirror the existing `doctor` / `migrate-legacy` registration pattern.
3. Output formatting: text and `--json`. JSON shape: `{ id, status, content, provenance, source }[]` for search; `{ id, status, prevStatus, reason }` for transitions.
4. Argument parsing follows existing CLI helpers under `packages/utils/src/cli.ts` (or wherever the parser lives). Do not reinvent.

## Boundaries

- Touch: `src/commands/memory.ts`, `src/cli/memory.ts`, possibly `src/nexus/store.ts` ONLY to add status-transition wrappers if absent (do not change existing methods).
- Do NOT modify the FTS or migration code.
- Do NOT modify `amaze memory doctor` or `amaze memory migrate-legacy` behavior.
- Do NOT modify `cli.ts` top-level command registration beyond ensuring the existing `memory` group still resolves.

## Verification

- `bun --cwd packages/coding-agent test test/cli` exit 0.
- `bun run check:ts` exit 0.
- `bun --cwd packages/coding-agent src/cli.ts memory --help` lists all five subcommands.
