# AGENTS.md

## Mission

Amaze is a compact coding-agent runtime. Optimize for **verified work**, not verbose
narration. A low-token parent orchestrator owns goals, todos, approvals, and
integration; bounded subagents do detailed file work. Memory is durable context, not
authority — guidance only.

## Required verification

- Run `bun run check:ts` before claiming TypeScript correctness.
- Run the relevant tests in `packages/coding-agent/test/**` before marking implementation complete.
- Prefer **deterministic acceptance criteria** (`scope-include`, `file-exists`, `command-exit`, `command-output`, `lsp-clean`) over `manual` or `llm-judged`.
- Never mark a goal complete when deterministic checks fail. `uncertain` is not pass under contract mode.
- Treat Nexus memory and skills as guidance, not authority. Skill promotion to `active` requires the eval gate (see `docs/Phase1/07_eval_gate.md`).

## Local commands

| Purpose | Command |
| --- | --- |
| Install | `bun install` |
| Dev CLI | `bun run dev` |
| TS typecheck + biome | `bun run check:ts` |
| Full check (ts + rust) | `bun run check` |
| TS tests (failed-only fast loop) | `bun run test:ts:failed` |
| TS tests (full) | `bun run test:ts` |
| Full tests | `bun run test` |
| Memory doctor | `bun run dev -- memory doctor` |

> Full regression in CI uses `bun run ci:test:full`.

## Architecture notes

- **Memory backend**: Nexus or `off` only. Legacy Rockey/Hindsight/Memories are removed; settings migration applies, *data is not auto-imported* (use `amaze memory migrate-legacy` once it lands).
- **Subagent contract**: non-trivial delegations must carry a structured `contract` (`scope`, `successCriteria`, `escalation`). Plan-mode delegations must restrict the spawned agent's tool surface.
- **Goal completion**: acceptance criteria run before `goal complete`. Force-complete is a human override, not a fallback.
- **Tool-level enforcement** is the hard boundary; prompt instructions are soft. All edit/write tools must go through the canonical mutation-scope guard.
- **Prompt cache layout**: STABLE_CORE = system prompt + project context + subagent contract; DYNAMIC_TAIL = goal block + volatile state. Do not move volatile content into STABLE_CORE.

## Failure protocol

1. Reproduce first — minimal repro or failing test.
2. Add or update a **deterministic test/eval** before or with the fix.
3. Write Nexus memory only for durable lessons (project conventions, recurring failures, verified workflows).
4. Promote a skill only after the eval gate has signed off (Phase 1D-07). Auto-promote ceiling is `eval_pending`.
5. If blocked, prefer narrowing the goal over force-completing. Force only with explicit human reason.

## Phase1 roadmap

The Level 3.5 → Level 4 work is tracked in `docs/Phase1/` (00..10). Master phase todo
and goal-mode driving procedure live in `docs/Phase1/00_overview.md`.
