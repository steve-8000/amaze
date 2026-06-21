<div align="center">

![AMAZE Agent System](docs/images/amaze-agent-system.svg)

# amaze

**A unified AI coding agent — orchestration, code intelligence, tools, and verification in one terminal.**

</div>

---

amaze is the main repository for the local agent system. It works with two companion repositories:

| Product | Repository | Role |
|---|---|---|
| **amaze** | <https://github.com/steve-8000/amaze> | CLI agent. Provides file, shell, code, language-server, subagent, sandbox, channel, and verification tools. |
| **Xenonite** | <https://github.com/steve-8000/xenonite> | Legacy Docker/API project intelligence core. Direct core tool execution is not part of the active default runtime. |
| **rocky** | <https://github.com/steve-8000/rocky> | OpenAI-compatible local model server for chat and embeddings. |

```
amaze (CLI) ──local tools/subagents──▶ bounded repository inspection and verification
```

## Runtime workflow

The intended end-to-end flow is:

1. **Goal / user turn** — `/goal`, `create_goal`, or an ordinary user request enters the amaze CLI. Active goals are resumed by hidden continuation prompts that require a completion audit before `update_goal(status="complete")`.
2. **Orchestrator** — `agent_run` uses direct agent invocation. Explicit single-agent, parallel, and chain calls are the primary orchestration surfaces; `action: "orchestrate"` is a convenience path that dispatches the raw task to one agent (`delegate` by default, or the supplied `agent`).
3. **Direct child execution** — child agents run through the selected agent configuration. The runtime no longer creates intermediate mission plans, folder-level workers, or FreshBoot contract fanout for `orchestrate`.
4. **Repository inspection** — runtime agents use bounded local `grep`, `find`, `ls`, and exact `read` calls for repository evidence.
5. **Model services** — configured model providers handle chat and reasoning; Rocky-backed tools are registered through the amaze extension/tool layer, not automatic core memory middleware.
6. **Verification** — validators and the parent agent must verify changed files, tests, and user-visible behavior before reporting completion.

## Features

- **Multi-agent orchestration** — delegate bounded work to planner, reviewer, worker, researcher, scout, context-builder, oracle, and delegate agents.
- **Code intelligence** — AST-aware structural search/rewrite, language-server diagnostics, jump-to-definition, and safe renames.
- **Bounded repository inspection** — use local search/list/read tools for exact evidence; Rocky tools may be available through the extension/tool layer.
- **Sandboxed execution** — run commands inside isolated local sandboxes.
- **No automatic memory middleware** — memory recall/store is not injected at turn start/end by core runtime.
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
mkdir -p ~/llm

cd ~/llm
git clone https://github.com/steve-8000/rocky

cd ~/rocky
git clone https://github.com/steve-8000/xenonite
git clone https://github.com/steve-8000/amaze
```

Expected layout:

```text
~/llm/rocky
~/rocky/xenonite
~/rocky/amaze
```

### 2. Install and start rocky

rocky provides the OpenAI-compatible local endpoints used by both amaze and Xenonite.
rocky is a companion service, not vendored into this repository; if it is already running from another checkout or service manager, verify the endpoints below instead of starting a second instance.

```bash
cd ~/llm/rocky
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

Runtime smoke checks used by the workflow are `/v1/chat/completions` on port `7777` and `/v1/embeddings` on port `7778`.

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

Start the Docker API service:

```bash
cd ~/rocky/xenonite
docker compose up -d
```

Xenonite health check:

```bash
curl -s http://127.0.0.1:8700/health
curl -s http://127.0.0.1:8700/v1/config
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
# amaze global config
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
enabled = false

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
enabled = true
url = "http://127.0.0.1:8700"
port = 8700
host_prefix = "/host"
auto_index = true
auto_watch = true
require = false
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
        "thinking": "high"
      },
      "planner": {
        "model": "gpt-5.5",
        "thinking": "high"
      },
      "context-builder": {
        "model": "gpt-5.4-mini",
        "thinking": "medium"
      },
      "worker": {
        "model": "gpt-5.5",
        "thinking": "high"
      },
      "researcher": {
        "model": "gpt-5.3-codex-spark",
        "thinking": "medium"
      },
      "scout": {
        "model": "gpt-5.4-mini",
        "thinking": "low"
      },
      "delegate": {
        "model": "gpt-5.5",
        "thinking": "medium"
      },
      "reviewer": {
        "model": "gpt-5.5",
        "thinking": "high"
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
Use agent_run list to confirm subagents are loaded.
```

## Legacy Xenonite API backend

Rocky tools may be registered through the amaze extension/tool layer. Legacy Xenonite direct core tools should stay separate from normal agent tool availability unless explicitly re-enabled.

```bash
cd ~/rocky/xenonite
docker compose up -d
```

Useful checks:

```bash
curl -s http://127.0.0.1:8700/health
curl -s http://127.0.0.1:8700/v1/config
```

## Troubleshooting

- If a legacy Xenonite check is needed, start Xenonite:
  ```bash
  cd ~/rocky/xenonite
  docker compose up -d
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
