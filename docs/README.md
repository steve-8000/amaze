# Amaze documentation map

This is the canonical map for repository documentation. Current/operator docs describe shipped or source-backed behavior. Phase, analysis, AGI, and UX notes are historical implementation/design records unless a current doc links to them for a specific detail.

## Where to start

1. Read the repository front door: [`../README.md`](../README.md).
2. For local operation, use [`config-usage.md`](config-usage.md), [`environment-variables.md`](environment-variables.md), [`session.md`](session.md), and [`tui.md`](tui.md).
3. For memory behavior, start with [`memory.md`](memory.md).
4. For tools and integrations, use the tool-specific docs below.
5. For implementation history or rationale, use the historical section at the bottom of this page.

## Current and operator docs

### Runtime and operation

- [`config-usage.md`](config-usage.md) — configuration usage patterns.
- [`environment-variables.md`](environment-variables.md) — supported environment variables.
- [`session.md`](session.md) — session model and behavior.
- [`session-operations-export-share-fork-resume.md`](session-operations-export-share-fork-resume.md) — session export/share/fork/resume operations.
- [`session-switching-and-recent-listing.md`](session-switching-and-recent-listing.md) — recent session listing and switching.
- [`install-id.md`](install-id.md) — install identity behavior.
- [`secrets.md`](secrets.md) — secret handling.
- [`hooks.md`](hooks.md) — hook behavior.
- [`theme.md`](theme.md) — terminal theme support.
- [`tree.md`](tree.md) — tree rendering/reference.
- [`render-mermaid.md`](render-mermaid.md) — Mermaid rendering support.

### Memory, rules, skills, and learning

- [`memory.md`](memory.md) — Nexus memory backend, migration notes, search, and key files.
- [`skills.md`](skills.md) — skill layout and lifecycle.
- [`rulebook-matching-pipeline.md`](rulebook-matching-pipeline.md) — rule matching pipeline.
- [`handoff-generation-pipeline.md`](handoff-generation-pipeline.md) — handoff generation flow.
- [`v3-measurement.md`](v3-measurement.md) — measurement notes.

### Tools, integrations, and protocol surfaces

- [`custom-tools.md`](custom-tools.md) — custom tool support.
- [`mcp-config.md`](mcp-config.md) — MCP configuration.
- [`mcp-server-tool-authoring.md`](mcp-server-tool-authoring.md) — MCP server tool authoring.
- [`mcp-runtime-lifecycle.md`](mcp-runtime-lifecycle.md) — MCP runtime lifecycle.
- [`mcp-protocol-transports.md`](mcp-protocol-transports.md) — MCP transports.
- [`extension-loading.md`](extension-loading.md) — extension loading.
- [`extensions.md`](extensions.md) — extension model.
- [`marketplace.md`](marketplace.md) — marketplace/plugin notes.
- [`plugin-manager-installer-plumbing.md`](plugin-manager-installer-plumbing.md) — plugin manager install plumbing.
- [`rpc.md`](rpc.md) — RPC support.
- [`sdk.md`](sdk.md) — SDK surface.
- [`cua.md`](cua.md) — computer-use automation support.
- [`x-search.md`](x-search.md) — X Search tool support.
- [`python-repl.md`](python-repl.md) — Python REPL tool/runtime.
- [`notebook-tool-runtime.md`](notebook-tool-runtime.md) — notebook runtime.
- [`bash-tool-runtime.md`](bash-tool-runtime.md) — bash tool runtime.
- [`resolve-tool-runtime.md`](resolve-tool-runtime.md) — resolve tool runtime.
- [`task-agent-discovery.md`](task-agent-discovery.md) — task/subagent discovery.

### UI and terminal internals

- [`tui.md`](tui.md) — TUI overview and usage.
- [`tui-runtime-internals.md`](tui-runtime-internals.md) — TUI runtime internals.
- [`ttsr-injection-lifecycle.md`](ttsr-injection-lifecycle.md) — terminal text sequence/rich injection lifecycle.
- [`natives-shell-pty-process.md`](natives-shell-pty-process.md) — native shell PTY process support.
- [`natives-media-system-utils.md`](natives-media-system-utils.md) — native media/system helpers.

### Providers, models, and prompt behavior

- [`models.md`](models.md) — model reference.
- [`ai-schema-normalize.md`](ai-schema-normalize.md) — AI schema normalization.
- [`provider-streaming-internals.md`](provider-streaming-internals.md) — provider streaming internals.
- [`v2-prompt-caching.md`](v2-prompt-caching.md) — prompt cache design.
- [`compaction.md`](compaction.md) — compaction behavior.
- [`non-compaction-retry-policy.md`](non-compaction-retry-policy.md) — retry policy without compaction.
- [`ERRATA-GPT5-HARMONY.md`](ERRATA-GPT5-HARMONY.md) — GPT-5 Harmony errata.

### Native package and filesystem/search internals

- [`natives-architecture.md`](natives-architecture.md) — native package architecture.
- [`natives-addon-loader-runtime.md`](natives-addon-loader-runtime.md) — native addon loader runtime.
- [`natives-binding-contract.md`](natives-binding-contract.md) — native binding contract.
- [`natives-build-release-debugging.md`](natives-build-release-debugging.md) — native build/release debugging.
- [`natives-rust-task-cancellation.md`](natives-rust-task-cancellation.md) — Rust task cancellation.
- [`natives-text-search-pipeline.md`](natives-text-search-pipeline.md) — native text search pipeline.
- [`fs-scan-cache-architecture.md`](fs-scan-cache-architecture.md) — filesystem scan cache architecture.
- [`blob-artifact-architecture.md`](blob-artifact-architecture.md) — blob artifact storage/identity.

### Porting and compatibility notes

- [`porting-from-pi-mono.md`](porting-from-pi-mono.md) — porting from pi-mono.
- [`porting-to-natives.md`](porting-to-natives.md) — porting to native helpers.
- [`gemini-manifest-extensions.md`](gemini-manifest-extensions.md) — Gemini manifest extension notes.
- [`auth-broker-gateway.md`](auth-broker-gateway.md) — auth broker gateway notes.
- [`slash-command-internals.md`](slash-command-internals.md) — slash command internals.

## Historical implementation records

These files preserve implementation history, reviews, design sketches, and phase closeout records. Treat them as context, not the current operator contract.

- [`Phase0/`](Phase0/) — early GPT-authored exploration records.
- [`Phase1/`](Phase1/) — security boundaries, verifier hardening, memory governance, observability ingest, rule DSL, learning proposals, eval gate, metrics, autonomous goals, and release runbook work.
- [`Phase2/`](Phase2/) — typecheck cleanup, autonomy planner correctness, contract adoption metrics, eval sandbox replay, verifier documentation alignment, rule aggregation, regression command gates, FTS, observability coverage, and operator CLI review.
- [`Phase3/`](Phase3/) — rules aggregation, memory doctor/workflow CLI, objective preview, root doctor, and prompt cache emit work.
- [`Phase4/`](Phase4/) — autonomy guardrails, candidate target paths, typecast cleanup, evolve CLI, and closing report.
- Phase5 — no Phase5 directory is present in this checkout; Phase5-era context is represented by adjacent phase closeout/design records.
- [`Phase6/storage-roadmap-decisions.md`](Phase6/storage-roadmap-decisions.md) — storage roadmap decisions.
- [`Phase7/memory-exchange-event-spec.md`](Phase7/memory-exchange-event-spec.md) — memory exchange event specification.
- [`analysis/`](analysis/) — architecture reviews and planning analysis.
