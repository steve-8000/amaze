<div align="center">

![AMAZE Agent System](docs/images/amaze-agent-system.svg)

# amaze

**A unified AI coding agent — orchestration, code intelligence, durable memory, tools, and verification in one terminal.**

</div>

---

amaze is the main repository for the local agent system. It works with two companion repositories:

| Product | Repository | Role |
|---|---|---|
| **amaze** | <https://github.com/steve-8000/amaze> | CLI agent. Provides file, shell, code, language-server, subagent, sandbox, channel, and verification tools. |
| **Xenonite** | <https://github.com/steve-8000/xenonite> | MCP-first project intelligence core. Owns durable memory, semantic code search, code graphs, and context bundles. |
| **rocky** | <https://github.com/steve-8000/rocky> | OpenAI-compatible local model server for chat and embeddings. |

```
amaze (CLI) ──MCP/HTTP JSON-RPC──▶ Xenonite (memory + code intelligence) ──HTTP──▶ rocky (LLM + embeddings)
```

## Features

- **Multi-agent orchestration** — delegate bounded work to planner, reviewer, worker, researcher, scout, context-builder, oracle, and delegate agents.
- **Code intelligence** — AST-aware structural search/rewrite, language-server diagnostics, jump-to-definition, and safe renames.
- **Semantic search + graph** — index a codebase and search it by meaning; explore symbols, dependencies, and impact across files.
- **Durable memory** — recall and store verified project facts and decisions through Xenonite.
- **Sandboxed execution** — run commands inside isolated local sandboxes.
- **External MCP bridge** — expose memory, search, graph, and context tools to MCP clients through Xenonite.
- **Single amaze config** — local feature toggles live in `amaze.toml`; model and subagent routing live in `~/.amaze/agent`.

## Exact local-system install guide

Use this section when handing setup to another agent. The commands reproduce the current Steve local system as closely as the public repositories allow, including exact model names, ports, and config files.

### 0. Requirements

- macOS 13+ on Apple Silicon for rocky MLX inference.
- Node.js `>=24.0.0`.
- npm and pnpm.
- Python `>=3.10`.
- `uv` for rocky.
- Git.

### 1. Clone the three repositories

```bash
mkdir -p ~/rocky
cd ~/rocky

git clone https://github.com/steve-8000/rocky
git clone https://github.com/steve-8000/xenonite
git clone https://github.com/steve-8000/amaze
```

Expected layout:

```text
~/rocky/rocky
~/rocky/xenonite
~/rocky/amaze
```

### 2. Install and start rocky

rocky provides the OpenAI-compatible local endpoints used by both amaze and Xenonite.

```bash
cd ~/rocky/rocky
uv sync

# Terminal 1: LLM server, http://127.0.0.1:7777/v1
make serve

# Terminal 2: embedding server, http://127.0.0.1:7778/v1
make embed
```

Exact current LLM model string:

```text
mlx-community/gemma-4-12B-it-qat-4bit
```

rocky preset for that model:

```text
gemma4-12b
```

Embedding endpoint/model as consumed by Xenonite:

```text
base URL: http://127.0.0.1:7778/v1
model:    default
```

Health checks:

```bash
curl -s http://127.0.0.1:7777/health
curl -s http://127.0.0.1:7778/health
```

### 3. Install Xenonite

```bash
cd ~/rocky/xenonite
npm install
```

Create the Xenonite config. If this file is absent, Xenonite uses these same defaults; writing it makes the target setup explicit.

```bash
mkdir -p ~/.config/xenonite
cat > ~/.config/xenonite/xenonite.toml <<'EOF'
port = 8700
data_dir = "${HOME}/.local/share/xenonite"

llm_url = "http://127.0.0.1:7777/v1"
llm_model = "mlx-community/gemma-4-12B-it-qat-4bit"
llm_key = "x"

embed_url = "http://127.0.0.1:7778/v1"
embed_model = "default"
embed_key = "x"
EOF
```

Start the HTTP MCP compatibility service with full tools:

```bash
cd ~/rocky/xenonite
XENONITE_MCP_TOOL_MODE=full npm run start
```

Optional stdio MCP bridge for external MCP clients:

```bash
cd ~/rocky/xenonite
XENONITE_MCP_TOOL_MODE=standard npm run mcp
```

Xenonite health check:

```bash
curl -s http://127.0.0.1:8700/health
curl -s http://127.0.0.1:8700/v1/mcp/manifest
```

### 4. Install amaze

```bash
cd ~/rocky/amaze
pnpm install
pnpm build:pnpm

cd packages/coding-agent
npm link
```

Confirm the CLI is available:

```bash
amaze --help
```

### 5. Configure amaze feature toggles

Create `~/.config/amaze/amaze.toml`:

```bash
mkdir -p ~/.config/amaze
cat > ~/.config/amaze/amaze.toml <<'EOF'
# amaze global config — all features wired to Xenonite + rocky
[tools.file]
enabled = true
[tools.shell]
enabled = true
[tools.web]
enabled = true
[tools.code]
enabled = true
[tools.lang]
enabled = true
[tools.search]
enabled = true
[tools.mem]
enabled = true

[agents]
enabled = true
[hooks]
enabled = true
[desk]
enabled = false
[sandbox]
enabled = true
provider = "local"

[skills]
enabled = true
auto_improve = false

[session.compression]
enabled = true
engine = "senpi"

[services.xenonite]
port = 8700
EOF
```

amaze resolves config in this order:

```text
$AMAZE_CONFIG → ./amaze.toml → ~/.config/amaze/amaze.toml → ~/.amaze/amaze.toml
```

### 6. Configure the local OpenAI-compatible model provider

Create `~/.amaze/agent/models.json`:

```bash
mkdir -p ~/.amaze/agent
cat > ~/.amaze/agent/models.json <<'EOF'
{
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:7777/v1",
      "api": "openai-completions",
      "apiKey": "x",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "mlx-community/gemma-4-12B-it-qat-4bit",
          "name": "gemma4-12b",
          "contextWindow": 65536
        }
      ]
    }
  }
}
EOF
```

### 7. Configure exact current subagent model routing

Create `~/.amaze/agent/settings.json`:

```bash
cat > ~/.amaze/agent/settings.json <<'EOF'
{
  "permission": {
    "*": "allow"
  },
  "subagents": {
    "agentOverrides": {
      "oracle": {
        "model": "gpt-5.5",
        "thinking": "high",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "intercom",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols"
        ]
      },
      "planner": {
        "model": "gpt-5.5",
        "thinking": "high",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "write",
          "intercom",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols"
        ]
      },
      "context-builder": {
        "model": "gpt-5.4-mini",
        "thinking": "medium",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "write",
          "web_search",
          "intercom",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols",
          "ctx_search"
        ]
      },
      "worker": {
        "model": "gpt-5.5",
        "thinking": "high",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "edit",
          "write",
          "contact_supervisor",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols"
        ]
      },
      "researcher": {
        "model": "gpt-5.3-codex-spark",
        "thinking": "medium"
      },
      "scout": {
        "model": "gpt-5.4-mini",
        "thinking": "low",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "write",
          "intercom",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols"
        ]
      },
      "delegate": {
        "model": "gpt-5.5",
        "thinking": "medium"
      },
      "reviewer": {
        "model": "gpt-5.5",
        "thinking": "high",
        "tools": [
          "read",
          "grep",
          "find",
          "ls",
          "bash",
          "edit",
          "write",
          "intercom",
          "index_status",
          "graph_status",
          "search_query",
          "graph_query",
          "graph_stats",
          "graph_cycles",
          "graph_impact",
          "graph_trace",
          "graph_symbol",
          "graph_symbols"
        ]
      }
    }
  },
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "medium"
}
EOF
```

Exact current role model strings:

| Role | Model | Thinking |
|---|---|---|
| default | `gpt-5.5` | `medium` |
| oracle | `gpt-5.5` | `high` |
| planner | `gpt-5.5` | `high` |
| context-builder | `gpt-5.4-mini` | `medium` |
| worker | `gpt-5.5` | `high` |
| researcher | `gpt-5.3-codex-spark` | `medium` |
| scout | `gpt-5.4-mini` | `low` |
| delegate | `gpt-5.5` | `medium` |
| reviewer | `gpt-5.5` | `high` |

### 8. Run amaze

With rocky and Xenonite already running:

```bash
cd ~/rocky/amaze
amaze
```

Useful first checks inside amaze:

```text
Use index_status to confirm Xenonite indexing is reachable.
Use mem_recall with a harmless query to confirm durable memory is reachable.
Use agent_run list to confirm subagents are loaded.
```

## External MCP bridge

The primary ChatGPT Pro / MCP integration point is Xenonite, not the amaze CLI.

```bash
cd ~/rocky/xenonite
XENONITE_MCP_TOOL_MODE=standard npm run mcp
```

Tool modes:

- `minimal` — `xenonite_server_config`, `xenonite_health`
- `standard` — read-only memory/code intelligence tools
- `full` — state-mutating tools such as indexing and verified memory storage

For amaze's built-in memory/search tools, run the HTTP MCP compatibility transport:

```bash
cd ~/rocky/xenonite
XENONITE_MCP_TOOL_MODE=full npm run start
```

## Troubleshooting

- If `mem_recall` says Xenonite is unreachable, start Xenonite:
  ```bash
  cd ~/rocky/xenonite
  XENONITE_MCP_TOOL_MODE=full npm run start
  ```
- If model calls fail, confirm rocky is listening:
  ```bash
  curl -s http://127.0.0.1:7777/health
  curl -s http://127.0.0.1:7778/health
  ```
- If `amaze` is not found, relink the CLI:
  ```bash
  cd ~/rocky/amaze/packages/coding-agent
  npm link
  ```
- If another local config overrides these values, run with:
  ```bash
  AMAZE_CONFIG=~/.config/amaze/amaze.toml amaze
  ```

## Status

amaze is under active development. Interfaces may change.
