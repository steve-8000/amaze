<p align="center">
  <img src="assets/amaze.png" alt="AMAZE Agent System banner" width="100%">
</p>

# Amaze + Rocky

**Amaze is the agent. Rocky is the brain beside it.**

Amaze runs the terminal coding-agent: it reads files, edits code, runs commands, opens browsers, drives debuggers, spawns subagents, and verifies work. Rocky is the local intelligence backend that makes the agent useful on a real repository: it stores reusable skills and gives the agent graph-based codebase search before it starts opening random files.

If you only remember one thing:

> Install Amaze, run Rocky locally, connect Amaze to Rocky through `.mcp.json`, then tell the agent to index your project.

## What Rocky adds

Rocky exposes a local MCP server at `POST /mcp`. Amaze connects to that server and gets two groups of tools:

| Rocky capability | What the agent gets |
| --- | --- |
| **Skills** | `skill_search`, `skill_get`, `skill_upsert`, `skill_delete`, `skill_list` for reusable operating procedures. |
| **Codebase graph** | `index_repository`, `search_graph`, `search_code`, `trace_path`, `get_code_snippet`, `get_architecture`, `query_graph`, and related code intelligence tools. |

This keeps the workflow simple:

1. Rocky indexes the repository locally.
2. Amaze asks Rocky where the relevant code is.
3. The agent reads only the bounded snippets it needs.
4. The agent edits, tests, and reports evidence.
5. Reusable lessons are written back as Rocky skills.

Rocky runs on your machine. Your source code is indexed locally. Model-provider calls still follow whatever providers you configure in Amaze.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/coding-agent` | The `amaze` CLI and agent runtime. |
| `packages/ai` | LLM providers, streaming, auth, usage, and schema handling. |
| `packages/agent` | Core agent loop, context, compaction, and telemetry. |
| `packages/catalog` | Model catalog and model-routing metadata. |
| `packages/tui` | Terminal UI renderer. |
| `packages/natives` + `crates/*` | Rust/N-API native search, shell, PTY, text, and platform helpers. |
| `.mcp.example.json` | Safe example MCP config. Copy it to `.mcp.json` for local use. |
| `.amaze/config.yml` | Project defaults copied from the local Amaze setup, excluding skills and secrets. |
| `docs/` | Operator docs. Start with `docs/mcp-config.md`, `docs/settings.md`, and `docs/session.md`. |

## Full install guide for an agent machine

These steps set up a machine where an AI agent can use Amaze + Rocky end to end.

### 0. Prerequisites

Install these first:

- Git
- [Bun](https://bun.sh) `1.3.14+`
- Rust via `rustup`
- Python `3.10+`
- [`uv`](https://docs.astral.sh/uv/) for Rocky

Recommended workspace:

```sh
mkdir -p ~/amaze_s3
cd ~/amaze_s3
```

### 1. Install Amaze

```sh
cd ~/amaze_s3
git clone https://github.com/steve-8000/amaze.git
cd amaze
bun install
bun run build:native
bun --cwd=packages/coding-agent run build
```

Link the source launcher so `amaze` is on your PATH:

```sh
bun run setup
amaze --version
amaze --smoke-test
```

You can also run without linking:

```sh
bun run dev -- --help
bun run dev
```

### 2. Project defaults

This repository includes `.amaze/config.yml` so a fresh clone starts with the same operating defaults as the local Amaze setup:

- Rocky-first settings (`rocky.apiUrl`, `rocky.projectPath`)
- model role routing
- task/subagent concurrency defaults
- autolearn enabled
- compact verification-oriented tool policy
- project MCP config enabled so `.mcp.json` can connect Rocky

Skills are intentionally **not** bundled here. Rocky skills live in `ROCKY_SKILLS_DIR` (usually `~/.rocky/skills`) and should be managed through Rocky, not copied into this repository.

If your checkout is not at `/Users/steve/amaze_s3/amaze`, edit `.amaze/config.yml` after cloning and set:

```yaml
rocky:
  projectPath: /absolute/path/to/your/amaze
```

### 3. Install Rocky

Rocky is a separate local service.

```sh
cd ~/amaze_s3
git clone https://github.com/steve-8000/rocky.git
cd rocky
uv sync
```

Rocky expects a codebase backend binary. In this workspace the paired codebase engine is kept beside it:

```sh
cd ~/amaze_s3
git clone https://github.com/DeusData/amaze-codebase.git rocky-codebase
```

If Rocky already has `bin/rocky-codebase`, no extra step is needed. Otherwise build/copy the codebase binary according to the Rocky repository instructions.

### 4. Start Rocky

For a local no-auth development setup:

```sh
cd ~/amaze_s3/rocky
ROCKY_RUNTIME_ROOT=$PWD/.rocky \
ROCKY_SKILLS_DIR=$HOME/.rocky/skills \
uvicorn rocky.mcp_app:app --host 127.0.0.1 --port 7777
```

Health check:

```sh
curl http://127.0.0.1:7777/healthz
```

For a shared or more locked-down setup, add a bearer token:

```sh
cd ~/amaze_s3/rocky
ROCKY_API_KEY=change-this-token \
ROCKY_RUNTIME_ROOT=$PWD/.rocky \
ROCKY_SKILLS_DIR=$HOME/.rocky/skills \
uvicorn rocky.mcp_app:app --host 127.0.0.1 --port 7777
```

### 5. Connect Amaze to Rocky

In the Amaze checkout:

```sh
cd ~/amaze_s3/amaze
cp .mcp.example.json .mcp.json
```

Use this minimal `.mcp.json` when Rocky has no bearer token:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/amaze-agent/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "rocky-skills": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp",
      "timeout": 30000
    }
  },
  "disabledServers": []
}
```

Use this version when Rocky is started with `ROCKY_API_KEY`:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/amaze-agent/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "rocky-skills": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp",
      "headers": {
        "Authorization": "Bearer ${ROCKY_API_KEY}"
      },
      "timeout": 30000
    }
  },
  "disabledServers": []
}
```

Important:

- Use the server name `rocky-skills`.
- Keep `.mcp.json` private. It is ignored by git.
- Commit only `.mcp.example.json` with placeholders.
- If you use `${ROCKY_API_KEY}` in `.mcp.json`, export that variable before launching Amaze.

### 6. Add model credentials

Start Amaze:

```sh
amaze
```

Then sign in with `/login`, or export provider keys before starting:

```sh
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GEMINI_API_KEY=...
amaze
```

Use whatever provider mix you prefer. Rocky is local context; the LLM provider is still selected by Amaze settings and `/model`.

### 7. Index the repository

In an Amaze session, ask:

```text
Use Rocky to index this repository, then use Rocky codebase search before reading files broadly.
```

For agent operators, this is the preferred first instruction in a new repo:

```text
First check Rocky skills for project procedures. Then use codebase_plan/search_graph to locate relevant code. Only read the specific ranges needed, make the change, and verify it.
```

### 8. Verify the whole setup

A healthy setup should pass these checks:

```sh
# Amaze binary/source launcher
amaze --version
amaze --smoke-test

# Rocky service
curl http://127.0.0.1:7777/healthz

# Repo checks before pushing changes
cd ~/amaze_s3/amaze
bun run check
```

## Day-to-day agent workflow

Use this loop for repository work:

1. **Find procedure** — search Rocky skills first.
2. **Find code** — use Rocky codebase tools before broad reads.
3. **Plan** — keep todos and acceptance criteria short and explicit.
4. **Delegate** — use subagents for independent implementation/review/research slices.
5. **Edit** — prefer exact, minimal changes.
6. **Verify** — run the smallest command that proves the behavior, then broader checks when needed.
7. **Capture** — save repeatable lessons as Rocky skills.

## Useful commands

| Purpose | Command |
| --- | --- |
| Run Amaze from source | `bun run dev` |
| Build native addon | `bun run build:native` |
| Build CLI binary | `bun --cwd=packages/coding-agent run build` |
| Link local `amaze` command | `bun run setup` |
| Smoke test | `amaze --smoke-test` |
| Full repo check | `bun run check` |
| TypeScript check only | `bun run check:ts` |
| Start Rocky | `uvicorn rocky.mcp_app:app --host 127.0.0.1 --port 7777` |
| Rocky health | `curl http://127.0.0.1:7777/healthz` |

## Private files and safe samples

Do not commit local secrets or machine-specific endpoints:

- `.env`
- `.mcp.json`
- runtime databases/logs/sessions
- local model caches

Do commit safe examples:

- `.mcp.example.json`
- docs that use placeholder env vars such as `${ROCKY_API_KEY}`

## Release

This fork publishes releases at:

- Repository: `https://github.com/steve-8000/amaze`
- Current tag: `v3.1.0`

Release/build verification:

```sh
bun run build:native
bun --cwd=packages/coding-agent run build
bun packages/coding-agent/src/cli.ts --smoke-test
```
