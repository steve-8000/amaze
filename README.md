![Amaze mascot saying AMAZE](assets/amaze.png)

# Amaze

**A compact coding-agent runtime for engineers who want the agent to do the work, not narrate the struggle.**

This repository is configured as a source-controlled daily-driver profile for Amaze: a low-token parent orchestrator owns goals, todos, approvals, and integration; bounded subagents do detailed file work; provider prompt caching keeps stable context cheap; Nexus memory preserves durable project/user/failure knowledge.

Built for:

- fast repository understanding
- tool-grounded code changes
- concise user-facing output
- reproducible project skills and settings
- high-context workers under a compact orchestrator
- completion checks that verify acceptance criteria before declaring done

## Current project profile

Runtime configuration lives in:

```text
.amaze/settings.json
.amaze/skills/
```

Key checked-in defaults:

- `prompt.mainContextMode = "compact"` for the top-level parent.
- `prompt.cache.orchestratorRetention = "default"`, `prompt.cache.subagentPrefixReuse = true`.
- `compaction.enabled = false` and `compaction.strategy = "off"` with continuous tool-output demotion enabled.
- `memory.backend = "nexus"`.
- User/project skill import from Codex/Claude is disabled; the project uses the allowlisted `.amaze/skills` set.
- Reasoning summaries are hidden by default (`hideThinkingBlock = true`).

Local-only state remains intentionally ignored: `agent.db*`, `.env`, logs, sessions, and build outputs.

## Model routing

| Agent/use | Model | Thinking |
| --- | --- | --- |
| Default coding | `openai-codex/gpt-5.5` | provider default |
| `task` | `openai-codex/gpt-5.5` | `medium` |
| `quick_task` | `openai-codex/gpt-5.5` | `minimal` |
| `explore` | `openai-codex/gpt-5.5` | `low` |
| `plan` | `anthropic/claude-opus-4-7` | `xhigh` |
| `reviewer` | `anthropic/claude-opus-4-7` | `high` |
| `oracle` | `openai-codex/gpt-5.5` | `xhigh` |
| `researcher` | `xai/grok-4.3` | `medium` |
| `visual_qa` | `openai-codex/gpt-5.5` | `low` |

## Subagents

Bundled subagents available in this profile:

| Agent | Purpose |
| --- | --- |
| `quick_task` | Strictly mechanical updates or data collection. |
| `task` | General-purpose implementation worker. |
| `explore` | Read-only codebase scouting and compressed handoff context. |
| `plan` | Architecture and sequencing for non-trivial changes. |
| `reviewer` | Diff, quality, maintainability, security, and test review. |
| `oracle` | Read-only second opinion for hard debugging or risky decisions. |
| `researcher` | xAI-backed X/Twitter investigation only. |
| `visual_qa` | Browser/UI validation and sandboxed visual QA. |

The top-level parent should stay lean: plan, delegate, integrate, verify, and report. Subagents receive fuller project context and can optionally be spawned with a structured contract that includes scope, acceptance criteria, escalation behavior, and output requirements.

## Goal mode and completion checks

Goal mode is enabled by default. The hidden `goal` tool supports:

- `create` — start an objective with an optional token budget.
- `get` — inspect active goal state.
- `update` — revise objective, token budget, design-interview answers, or acceptance criteria.
- `complete` — run closing audit and finish; `force: true` skips the audit and is counted in telemetry.

Design Interview answers are captured through the normal `ask` tool once per active goal, using keys such as `scope`, `constraints`, `approach`, and `acceptance`. Active goal state is re-rendered into the dynamic prompt tail so it survives compaction and session handoff.

Structured acceptance criteria support deterministic checks:

- `scope-include` / `scope-exclude`
- `file-exists`
- `command-exit`
- `command-output`
- `lsp-clean`
- `llm-judged`
- `manual`

Failed criteria block `goal({ op: "complete" })` unless completion is forced. Manual criteria surface as uncertain so the operator can decide whether to replace them with a deterministic check or force completion.

## Prompt cache and memory flow

The system prompt is split into stable and volatile blocks:

1. **STABLE_CORE**: system contract, static project context, skills list, and session-invariant instructions.
2. **DYNAMIC_TAIL**: cwd/date, relevant directory context, workspace tree, active goal state, and other per-turn state.

Anthropic requests receive a `systemPromptCacheBreakpointIndex` hint so cache control lands on STABLE_CORE instead of the changing tail. Other providers ignore the hint safely.

Nexus memory is the active local memory backend. It provides:

- `memory` — add/replace/remove durable user, project, memory, or failure entries.
- `memory_search` — search durable memory by query/scope/category.
- `session_search` — search prior session anchors without loading full transcripts.
- `memory://root` artifacts for reading the active memory store through the `read` tool.

Memory is guidance, not authority: current user instructions and repository state override stale memory.

## Built-in tool surface

The runtime exposes boring, inspectable tools first: `read`, `find`, `search`, `bash`, `edit`, `write`, LSP, browser/visual tools, `task`, todos, IRC, memory tools, web search, X Search, CUA computer-use automation, eval/debug, GitHub, AST tools, checkpoints, and internal URL readers.

Hidden/session tools (`goal`, `resolve`, `yield`, `report_finding`, `report_tool_issue`) are injected when the current mode needs them.

## Local development

```sh
bun install
bun run dev
```

For a linked local CLI:

```sh
bun run install:dev
```

For a release-style build:

```sh
bun run build
```

`@amaze/coding-agent` currently reports version `1.0.0`.

## Verify

```sh
bun run check:ts
bun run test:ts
```

Full verification also includes Rust and Python where the local toolchain is available:

```sh
bun run check
bun run test
bun run lint:py
bun run test:py
```

`bun run test` requires `cargo nextest` for the Rust lane.
