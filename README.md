<div align="center">

# amaze

**A unified AI coding agent — code intelligence, durable memory, and self‑improving skills in one terminal.**

</div>

---

amaze is a terminal‑first AI coding agent built around three cooperating products:

| Product | Role |
|---|---|
| **amaze** | The CLI agent. A single, self‑contained command (`amaze`) with file, shell, code, language‑server, subagent, sandbox, and channel tooling. |
| **Xenonite** | The memory + code engine service. Durable memory, reusable skills, semantic code search, and a code‑relationship graph — exposed over HTTP. |
| **rocky** | The model server. An OpenAI‑compatible endpoint for chat and embeddings that powers both amaze and Xenonite. |

```
amaze (CLI)  ──HTTP──▶  Xenonite (memory + code engine)  ──HTTP──▶  rocky (LLM + embeddings)
```

## Features

- **Code intelligence** — AST‑aware structural search and rewrite, language‑server diagnostics, jump‑to‑definition, and safe renames.
- **Semantic search + graph** — index a codebase and search it by meaning; explore symbols, dependencies, and impact across files.
- **Durable memory** — the agent remembers durable facts and decisions across sessions and recalls them when relevant.
- **Self‑improving skills** — turns successful procedures into reusable skills and refines them over time.
- **Subagents** — delegate bounded work to specialized agents (planner, reviewer, worker, researcher, scout, and more), each on the most appropriate model.
- **Sandboxed execution** — run commands inside isolated sandboxes.
- **Channels** — receive work from chat platforms (Slack, GitHub, and others) when run in service mode.
- **Single config** — every capability is toggled from one `amaze.toml`.

## Quick start

```bash
# 1. Build the agent
pnpm install
pnpm build:pnpm

# 2. Make `amaze` available on your PATH
cd packages/coding-agent && npm link

# 3. Run it
amaze
```

Point amaze at your model server and enable features in `amaze.toml`:

```toml
[tools.code]
enabled = true

[tools.search]   # semantic search via Xenonite
enabled = true

[tools.mem]      # durable memory via Xenonite
enabled = true

[services.xenonite]
port = 8700
```

## Configuration

All behavior is driven by a single `amaze.toml`, resolved in this order:

```
$AMAZE_CONFIG → ./amaze.toml → ~/.config/amaze/amaze.toml → ~/.amaze/amaze.toml
```

Models and provider endpoints are configured in `~/.amaze/agent/models.json`; per‑role subagent models and permissions in `~/.amaze/agent/settings.json`.

## Status

amaze is under active development. Interfaces may change.
