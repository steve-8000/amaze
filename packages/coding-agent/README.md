# @amaze/coding-agent

Core implementation package for the `amaze` coding agent in the `amaze` monorepo.

For installation, setup, provider configuration, model roles, slash commands, and full CLI reference, see:

- [Monorepo README (local)](../../README.md)
- [Monorepo README (GitHub)](https://github.com/steve-8000/amaze#readme)

Package-specific references:

- [CHANGELOG](./CHANGELOG.md)
- [SDK guide](../../docs/sdk.md)
- [Memory guide](../../docs/memory.md)
- [Task agent discovery and contracts](../../docs/task-agent-discovery.md)
- [Prompt caching design](../../docs/v2-prompt-caching.md)
- [V3 coordination measurement](../../docs/v3-measurement.md)
- [MCP configuration guide](../../docs/mcp-config.md)
- [MCP runtime lifecycle](../../docs/mcp-runtime-lifecycle.md)
- [MCP server/tool authoring](../../docs/mcp-server-tool-authoring.md)
- [RenderMermaid guide](../../docs/render-mermaid.md)
- [DEVELOPMENT](./DEVELOPMENT.md)

## Memory backends

The agent has one runtime selector: `memory.backend` (Settings → Memory tab, or `~/.amaze/agent/config.yml`). Supported values:

- `off` (default) — no memory subsystem runs.
- `rockey` — canonical local SQLite memory with explicit `memory`, `memory_search`, and `session_search` tools.
- `local` — legacy rollout-summary pipeline that writes `MEMORY.md`, `memory_summary.md`, and generated skill artifacts.
- `hindsight` — remote Hindsight backend with `retain`, `recall`, and `reflect` tools.

Legacy `memories.enabled = true|false` is still accepted as migration input. On first config load it becomes `memory.backend = "rockey"|"off"`; new config should set `memory.backend` directly.

### Rockey quickstart

```yaml
memory:
  backend: rockey
rockey:
  autoRecall: false
  correctionDetection: true
```

When active, Rockey injects policy guidance and enables:

- `memory` for durable writes to `memory`, `user`, `project`, or `failure` targets.
- `memory_search` for bounded search over durable memory.
- `session_search` for prior-session anchors.
- `memory://root` for read-only artifact inspection.

### Hindsight quickstart

1. Run a Hindsight server (Cloud or `docker run -p 8888:8888 ghcr.io/vectorize-io/hindsight:latest`).
2. Set `memory.backend = "hindsight"` and `hindsight.apiUrl = "http://localhost:8888"` (or your Cloud URL).
3. Optional environment overrides (env wins over settings):
   - `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN`
   - `HINDSIGHT_BANK_ID`, `HINDSIGHT_BANK_MISSION`, `HINDSIGHT_SCOPING`
   - `HINDSIGHT_AUTO_RECALL`, `HINDSIGHT_AUTO_RETAIN`, `HINDSIGHT_RETAIN_MODE`, `HINDSIGHT_RETAIN_EVERY_N_TURNS`
   - `HINDSIGHT_RECALL_BUDGET`, `HINDSIGHT_RECALL_MAX_TOKENS`, `HINDSIGHT_RECALL_CONTEXT_TURNS`, `HINDSIGHT_RECALL_MAX_QUERY_CHARS`
   - `HINDSIGHT_DEBUG`

Switching backends mid-session is honored on the next system-prompt rebuild and the next `/memory` slash command.
