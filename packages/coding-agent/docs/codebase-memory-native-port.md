# codebase-memory-mcp native port plan

This document tracks the first implementation step for replacing ad-hoc TypeScript
codebase indexing with the upstream `codebase-memory-mcp` native engine.

Upstream source used for this audit:

- `/Users/steve/amaze4/base-repo/codebase-memory-mcp`
- source contract: `src/mcp/mcp.c` `TOOLS[]`
- upstream binary smoke: `build/c/codebase-memory-mcp --help`

The upstream source and binary both expose exactly 14 MCP tools. The upstream
dispatcher also accepts `trace_call_path` as an alias for `trace_path`, but the
alias is not part of the advertised 14-tool MCP contract.

## Scope

The first PR intentionally does not vendor the upstream source tree and does not
build native code during package installation. It adds:

- the native 14-tool contract
- a binary resolver and CLI adapter
- a separated native tool registry
- focused tests for resolver, JSON CLI unwrapping, tool catalog registration,
  and optional real-native smoke

The existing tool surface is not removed in this step. The upstream multi-agent
installer is out of scope because it can conflict with amaze's built-in package,
extension, and agent orchestration.

Until release packaging ships a native binary, the API tool catalog only includes
the native codebase-memory tools when a binary is resolvable through explicit
`codebaseMemory` tool options. The explicit
`createCodebaseMemoryNativeToolDefinitions()` factory always exposes the 14-tool
contract for tests and opt-in callers.

## Native Binary Strategy

Amaze should ship or discover a prebuilt native `codebase-memory-mcp` executable.
The resolver order is:

1. `AMAZE_CODEBASE_MEMORY_MCP_BIN`
2. `native/codebase-memory-mcp/<platform>/codebase-memory-mcp`
3. `codebase-memory-mcp/<platform>/codebase-memory-mcp`
4. `bin/codebase-memory-mcp/<platform>/codebase-memory-mcp`

Windows uses `codebase-memory-mcp.exe`.

Supported platform ids are:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `windows-arm64`
- `windows-x64`

Release packaging should use one of these approaches:

- release-time prebuilt binary copied into the package
- platform optional packages resolved at runtime

Do not run a C build from `npm install`, `pnpm install`, or `bun install`.
Node package installs and Bun archives must both include or resolve the same
native binary path. The final packaging PR still needs multi-platform release
binary provisioning and third-party license notice coverage.

This branch starts the release-time prebuilt path with
`scripts/codebase-memory-native-assets.mjs`:

- `AMAZE_CODEBASE_MEMORY_MCP_BIN` supplies the current-platform binary.
- `AMAZE_CODEBASE_MEMORY_MCP_BIN_<PLATFORM>` supplies a platform-specific
  binary, for example `AMAZE_CODEBASE_MEMORY_MCP_BIN_DARWIN_ARM64`.
- `AMAZE_CODEBASE_MEMORY_MCP_NOTICE_DIR` supplies upstream `LICENSE` and
  `THIRD_PARTY.md` files for release assets.
- `AMAZE_REQUIRE_CODEBASE_MEMORY_MCP_BIN=1` or
  `node scripts/local-release.mjs --require-codebase-memory-native` turns
  missing binary or notice assets into packaging failures.
- npm tarballs include `native/codebase-memory-mcp/<platform>/...` through the
  package `files` list when the helper copies an asset, and include shared
  native notices under `native/codebase-memory-mcp/`.
- Bun archives copy the same relative path during `scripts/build-binaries.sh`.

## Storage Policy

Use upstream storage by default:

- `CBM_CACHE_DIR`, defaulting to `~/.cache/codebase-memory-mcp`
- `_config.db` in the cache directory
- project indexes as `<project>.db` files in the cache directory
- optional `.codebase-memory/graph.db.zst` only when
  `index_repository(persistence: true)` is requested

Amaze should not silently remap this to `.amaze` until the migration policy and
cross-install cache sharing behavior are explicit.

## Tool Parity Matrix

| Upstream tool | Current amaze state before this port | First PR status | Notes |
| --- | --- | --- | --- |
| `index_repository` | Legacy tool name existed in the amaze codebase group. | Native registry + adapter. | Native `repo_path` required; mode defaults upstream to `full`. |
| `search_graph` | Legacy tool name existed; behavior was not native graph parity. | Native registry + adapter. | Supports `query`, `label`, `name_pattern`, `qn_pattern`, structural filters, pagination. |
| `query_graph` | Missing from the amaze codebase tool group. | Added to native registry + adapter. | Read-only Cypher-like query. |
| `trace_path` | Missing from the amaze codebase tool group. | Added to native registry + adapter. | `trace_call_path` is an upstream dispatch alias, not one of the 14 listed tools. |
| `get_code_snippet` | Legacy tool name existed. | Native registry + adapter. | Requires qualified name from native graph discovery. |
| `get_graph_schema` | Missing from the amaze codebase tool group. | Added to native registry + adapter. | Use before exploratory graph queries. |
| `get_architecture` | Legacy tool name existed. | Native registry + adapter. | Native overview and ADR context. |
| `search_code` | Legacy tool name existed. | Native registry + adapter. | Graph-augmented source search. |
| `list_projects` | Legacy tool name existed. | Native registry + adapter. | No args. |
| `delete_project` | Legacy tool name existed. | Native registry + adapter. | Deletes native project DB. |
| `index_status` | Legacy tool name existed. | Native registry + adapter. | Schema requires project; handler has a missing-project response. |
| `detect_changes` | Legacy tool name existed. | Native registry + adapter. | Uses git diff impact mapping. |
| `manage_adr` | Missing from the amaze codebase tool group. | Added to native registry + adapter. | ADR get/update/sections. |
| `ingest_traces` | Missing from the amaze codebase tool group. | Added to native registry + adapter. | Accepts traces; upstream currently reports ingestion acceptance. |

Skill tools are not part of `codebase-memory-mcp` parity:

- `skill_search`
- `skill_get`
- `put_skill`
- `delete_skill`

They remain an amaze/CLAB concern, not a native codebase-memory tool contract.

## Local Native Build Note

On this machine, upstream `scripts/build.sh` failed when Homebrew `libgit2` was
auto-detected because the installed headers do not expose `git_allocator` as the
upstream code expects. A no-libgit2 build succeeded with:

```bash
make -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 8)" -f Makefile.cbm cbm LIBGIT2_CFLAGS= LIBGIT2_LIBS= LIBGIT2_FLAGS=
```

Release builds should either pin a compatible libgit2, patch upstream for the
installed libgit2 API, or intentionally build without libgit2.

## Verified Upstream Gap

The upstream native engine currently indexes function symbols in a small
TypeScript fixture, but it did not graph-index this typed top-level export:

```typescript
export const defaultModelPerProvider: Record<string, string> = { openai: "gpt-5" };
```

Observed behavior with upstream native binary:

- `index_repository`: indexed
- `get_graph_schema`: includes `Function`
- `query_graph`: returns fixture functions
- `trace_path`: traces function callers
- `search_code(pattern: "defaultModelPerProvider")`: finds the text
- `search_graph(name_pattern: ".*defaultModelPerProvider.*")`: returns zero

Do not claim the `defaultModelPerProvider` graph-symbol acceptance check is
complete until upstream variable extraction is fixed or an amaze-side
augmentation is designed.

## First PR Verification Plan

Required checks:

- narrow vitest for native codebase adapter/registry
- optional real-native vitest with `AMAZE_CODEBASE_MEMORY_MCP_BIN`
- `npm run check`
- amaze-qa evidence for CLI, RPC, and mock-loop after touching
  `packages/coding-agent`

Known harness caveat for this branch: clean-sandbox CLI smoke can fail the
`--list-models` assertion when no sandbox model registry is seeded. Manual
`--list-models` with the source tree can still be recorded separately, but treat
the self-test as red until the harness or sandbox model bootstrap is updated.

Evidence should be stored under:

```text
local-ignore/qa-evidence/<date>-codebase-memory-native-port/
```

## Next PR Items

- Ship or resolve prebuilt binaries for every supported Node package and Bun
  archive platform.
- Run full local-release with `--require-codebase-memory-native` and release
  binary env configured for the target platform set.
- Add `THIRD_PARTY` or license notice coverage for upstream native code and
  transitive native dependencies.
- Decide whether native codebase tools are active by default or opt-in until
  packaging is complete.
- Fix or augment upstream TypeScript variable extraction for
  `defaultModelPerProvider` graph search.
