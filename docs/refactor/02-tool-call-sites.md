# 02 — Tool Call-Site Inventory

> Lane E / Phase 0. Inventory of how tools are wired and invoked **today**, so
> Lane C1/H know exactly which sites must route through the future
> `ToolGateway`. Paths relative to `packages/coding-agent/src/`.

## Key finding: tools are not imported by feature code

Unlike a "direct import" architecture, the target tools (`read`, `write`,
`bash`, `repo_search`, `gh/github`, `fetch`/`read_url`, `edit`) are **not**
imported call-site-by-call-site across `src/`. They are:

1. **Constructed** once each via the `BUILTIN_TOOLS` factory map in
   `tools/index.ts` (`:311`–`~:353`), keyed by tool name.
2. **Dispatched** generically by the agent loop in `session/agent-session.ts`
   via `target.execute(toolCallId, args, signal, onUpdate, ctx)` at three sites:
   `:3193`, `:3205`, `:3262`.
3. **Re-dispatched** inside subagent subprocesses via
   `subprocessToolRegistry.getHandler(toolName)` (`task/subprocess-tool-registry.ts:65`;
   used at `task/executor.ts:905`, `task/render.ts:644`, `:880`).

So the gateway interception points are **few and central**: the
`BUILTIN_TOOLS` factory + the three `execute()` dispatch sites + the subprocess
registry. This is the good news for Lane C1/H.

---

## 1. Factory registration sites (`tools/index.ts`)

These are where each tool instance is created — the natural place for the
gateway to wrap a descriptor around the tool.

| Tool name | Factory line | Class & import |
| --- | --- | --- |
| `read` | `:315` | `new ReadTool(s)` — import `:47` from `./read` |
| `bash` | `:316` | `new BashTool(s)` — import `:29` from `./bash` |
| `edit` | `:317` | `new EditTool(s)` — import `:6` from `../edit` |
| `ast_edit` | `:319` | `new AstEditTool(s)` — import `:27` from `./ast-edit` |
| `write` | `:345` | `new WriteTool(s)` — import `:59` from `./write` |
| `github` | `:326` | `GithubTool.createIf` — import `:41` from `./gh` |
| `repo_search` | `:347` | `RepoSearchTool.createIf` — import `:50` from `./repo-search` |
| `web_search` | `:341` | `new WebSearchTool(s)` — import `:24` from `../web/search` |
| `session_search` | `:352` | `SessionSearchTool.createIf` |
| `code_callers/callees/def/refs` | `:348`–`:351` | AST navigation (`createIf`) |
| (gated) `ask/debug/lsp/job/recipe/irc/checkpoint/rewind/memory_explain/...` | `:321`–`:352` | `createIf` gated factories |

Essential set: `DEFAULT_ESSENTIAL_TOOL_NAMES` (`tools/index.ts:285`) =
`read`, `write`, `todo_write`, `todo_read`, …

### `fetch` is not a standalone tool — it is `read_url`

The "fetch" capability requested in the workplan lives inside `tools/fetch.ts`
as `executeReadUrl` (`tools/fetch.ts:1293`; 1473-line file) and is invoked from **inside the
`read` tool** when the path parses as a URL:
`tools/read.ts:1484` → `executeReadUrl(this.session, ...)` (imported at
`read.ts:49` from `./fetch`). There is no `fetch:` entry in `BUILTIN_TOOLS`.
Gateway routing for URL fetches must therefore hook `read.ts:1484`, not a
top-level factory.

---

## 2. Generic dispatch sites (the hot path)

| Site | file:line | What it dispatches |
| --- | --- | --- |
| primary tool execute | `session/agent-session.ts:3193` | all model tool calls |
| secondary execute | `session/agent-session.ts:3205` | (branch) all model tool calls |
| tertiary execute | `session/agent-session.ts:3262` | (branch) all model tool calls |
| slash command execute | `session/agent-session.ts:4336` | command, not tool |

These three `execute()` sites are where Lane H would insert
`gateway.invoke(descriptor, args, ...)` for **mutation enforcement** without
touching individual tools.

### Goal-budget hooks already wrap this path (relevant to mission migration)

After each tool completes, the agent loop already calls the goal runtime:
- `agent-session.ts:1525` → `goalRuntime.onToolCompleted(event.toolName)`
- `agent-session.ts:1523` → `goalRuntime.onGoalToolCompleted()`

This is the existing "post-tool" hook the mission runtime can reuse for
`mission.tool.*` events (Lane B/H).

---

## 3. Subagent / subprocess tool invocation

Subagents run tools out-of-process and dispatch through a separate registry:

| Site | file:line |
| --- | --- |
| registry singleton | `task/subprocess-tool-registry.ts:85` (`subprocessToolRegistry`) |
| `getHandler` lookup | `task/subprocess-tool-registry.ts:65` |
| handler invocation | `task/executor.ts:905` |
| render-side lookup | `task/render.ts:644`, `:880` |
| `task` self-registration | `task/render.ts:1068` |

Lane H/I must route subagent mutations through `mutation-guard` here too — this
is a **second** enforcement surface distinct from the in-process `execute()`
sites.

---

## 4. Direct subprocess/exec usages (bash-equivalent, bypass the bash tool)

These run shell/process directly and would bypass any gateway that only wraps
the `bash` tool — flagged for Lane H awareness:

| Site | file (grep hit) |
| --- | --- |
| recipe runners | `tools/recipe/runners/{task,cargo,just}.ts` |
| CUA tool | `tools/cua.ts` |
| browser registry | `tools/browser/registry.ts` |
| git status (goal closing audit) | `goals/runtime.ts:77` (`Bun.spawn(["git","status"...])`) |

`goals/runtime.ts:77` is notable: the goal runtime itself spawns `git status`
for the closing audit `changedFiles` context — an execution-side effect that
moves with the runtime in Lane C2.

---

## 5. Summary for Lane C1/H

- **Register** descriptors at the `BUILTIN_TOOLS` factory map (`tools/index.ts:311`+).
- **Enforce** at the 3 `execute()` sites (`agent-session.ts:3193/3205/3262`) and
  the subprocess registry (`task/subprocess-tool-registry.ts:65`).
- **Special-case** URL fetch (`read.ts:1484`) and the direct-exec sites in §4.
- Mutation tools to gate first (workplan §H): `write` (`:345`), `edit` (`:317`),
  `ast_edit` (`:319`), `bash` (`:316`), `github` (`:326`).
