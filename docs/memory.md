# Memory

Amaze has a pluggable memory plane selected by `memory.backend`. Memory is durable context, not authority: the agent must prefer current user instructions and current repository state whenever they conflict with recalled memory.

## Backends

| Backend | Status | Runtime tools | Notes |
| --- | --- | --- | --- |
| `off` | Default upstream | none | No memory subsystem runs. |
| `rockey` | Canonical local backend | `memory`, `memory_search`, `session_search` | SQLite-backed durable user/project/failure memory plus prior-session anchor search. |
| `local` | Legacy backend | `/memory` slash command, `memory://root` artifacts | Startup extraction/consolidation pipeline that writes markdown summaries and generated skill playbooks. |
| `hindsight` | Remote backend | `retain`, `recall`, `reflect` | Talks to a Hindsight server or Cloud instance. |

Legacy `memories.enabled` is accepted only for migration. On first config load, `memories.enabled: true` becomes `memory.backend: rockey`; `false` becomes `off`.

## Configuration

Use `/settings` or `~/.amaze/agent/config.yml`:

```yaml
memory:
  backend: rockey
```

### Rockey settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `rockey.autoRecall` | `false` | Inject bounded Rockey search results before each agent turn. |
| `rockey.autoRecallLimit` | `5` | Max entries considered for automatic recall. |
| `rockey.correctionDetection` | `true` | Save user corrections as categorized failure memories. |
| `rockey.staticPromptMaxChars` | `1200` | Max static policy/context characters injected for Rockey. |
| `rockey.searchResultMaxEntries` | `5` | Default result count for `memory_search`. |
| `rockey.searchResultMaxChars` | `2400` | Max rendered search result characters. |
| `rockey.sessionSearchMaxAnchors` | `8` | Max anchors returned by `session_search`. |

### Hindsight settings and env

Set `memory.backend: hindsight` and `hindsight.apiUrl`. Environment variables override settings:

- `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN`
- `HINDSIGHT_BANK_ID`, `HINDSIGHT_BANK_MISSION`, `HINDSIGHT_SCOPING`
- `HINDSIGHT_AUTO_RECALL`, `HINDSIGHT_AUTO_RETAIN`
- `HINDSIGHT_RETAIN_MODE`, `HINDSIGHT_RETAIN_EVERY_N_TURNS`
- `HINDSIGHT_RECALL_BUDGET`, `HINDSIGHT_RECALL_MAX_TOKENS`, `HINDSIGHT_RECALL_CONTEXT_TURNS`, `HINDSIGHT_RECALL_MAX_QUERY_CHARS`
- `HINDSIGHT_DEBUG`

## Rockey usage

When `memory.backend = "rockey"`, the tool factory auto-enables:

| Tool | Purpose |
| --- | --- |
| `memory` | Add, replace, or remove durable entries in `memory`, `user`, `project`, or `failure` targets. |
| `memory_search` | Search durable memory by query, scope, and optional category. |
| `session_search` | Search indexed prior sessions and return bounded anchors for follow-up reads. |

Typical use:

1. Search memory before relying on durable context: `memory_search`.
2. Read current repo/tool evidence before acting on a memory.
3. Save durable facts only when they should survive future sessions: user preferences, project conventions, prior decisions, known failures, or reusable workflow knowledge.
4. Do not save temporary task progress or facts that matter only to the current conversation.

`memory://root` resolves to the active local artifact root when the backend has one. With Rockey it points at the Rockey artifact view; with legacy local memory it points at the markdown summary tree.

## Legacy local memory

`memory.backend = "local"` runs the older autonomous consolidation pipeline. It is useful when you want generated markdown artifacts rather than explicit tool-managed memory.

At startup or when manually triggered, it:

1. Scans eligible past session files.
2. Extracts durable decisions, constraints, resolved failures, and recurring workflows.
3. Consolidates output into:
   - `MEMORY.md`
   - `memory_summary.md`
   - generated `skills/<name>/SKILL.md` playbooks

The injected summary appears as memory guidance in the system prompt. Outputs are scanned for secrets before being written.

## `/memory` slash command

The slash command routes to the active backend where supported. Common operations include viewing current memory injection, rebuilding/refreshing local artifacts, clearing local memory, and Hindsight mental-model operations when the Hindsight backend is active.

## Key files

- `packages/coding-agent/src/memory-backend/resolve.ts` — backend selection.
- `packages/coding-agent/src/memory-backend/rockey-backend.ts` — Rockey backend lifecycle and prompt hooks.
- `packages/coding-agent/src/tools/rockey-memory.ts` — `memory` tool.
- `packages/coding-agent/src/tools/rockey-memory-search.ts` — `memory_search` tool.
- `packages/coding-agent/src/tools/rockey-session-search.ts` — `session_search` tool.
- `packages/coding-agent/src/memories/` — legacy local summary pipeline.
- `packages/coding-agent/src/hindsight/` — Hindsight backend integration.
- `packages/coding-agent/src/memory-backend/artifact-root.ts` — `memory://root` artifact target selection.
