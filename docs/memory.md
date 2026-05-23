# Memory

Amaze has a pluggable memory plane selected by `memory.backend`. Memory is durable context, not authority: the agent must prefer current user instructions and current repository state whenever they conflict with recalled memory.

## Backends

| Backend | Status | Runtime tools | Notes |
| --- | --- | --- | --- |
| `off` | Default upstream | none | No memory subsystem runs. |
| `nexus` | Canonical local backend | `memory`, `memory_search`, `session_search`, repository knowledge tools | Temporal local memory with project/user/failure entries, prior-session search, rendered artifacts, healing, and optional AI enhancement. |

Legacy `memories.enabled` is accepted only for migration. On first config load, `memories.enabled: true` becomes `memory.backend: nexus`; `false` becomes `off`.

## Legacy migration

Canonical cutover: legacy backend settings migrate to Nexus.

Legacy backend data is not imported automatically.

Prior sessions are reindexed through Nexus session search.

Manual data import: `amaze memory migrate-legacy --from <rockey|hindsight>`.


## Configuration

Use `/settings` or `~/.amaze/agent/config.yml`:

```yaml
memory:
  backend: nexus
```

## Nexus usage

When `memory.backend = "nexus"`, the tool factory auto-enables:

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

`memory://root` resolves to the active Nexus artifact root.

## Key files

- `packages/coding-agent/src/memory-backend/resolve.ts` — backend selection.
- `packages/coding-agent/src/memory-backend/nexus-backend.ts` — Nexus backend lifecycle and prompt hooks.
- `packages/coding-agent/src/nexus/store.ts` — Nexus durable memory store and artifact root helpers.
- `packages/coding-agent/src/memory-backend/artifact-root.ts` — `memory://root` artifact target selection.
