# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release porting omo's LSP tool stack as a pi-coding-agent extension.
- Six tools: `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`,
  `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`.
- Shared `LspManager` singleton with refCount-based lifecycle, idle cleanup
  (5 minutes), init reaping (60 seconds), and abort-aware acquisition.
- Typed crash boundary: `LspConnectionClosedError` and
  `LspProcessExitedError` in `errors.ts`. The wrapper retries idempotent read
  tools exactly once on a typed dead-connection error; mutating tools are
  never retried.
- Built-in registry of 40+ language servers with per-server install hints
  ported verbatim from omo, plus an `AUTO_INSTALLABLE_SERVERS` whitelist that
  drives `/lsp install <id>` for safe automatic installation.
- Custom user config: `.pi/lsp-client.json` (project) and
  `~/.pi/lsp-client.json` (user) merge with project taking priority over
  user, both taking priority over the builtin registry.
- Three commands: `/lsp` (interactive inspector via `ctx.ui.custom`),
  `/lsp install <id>`, `/lsp warmup <id>`.
- Custom TUI rendering for all six tools, with bespoke expanded views for
  diagnostics, references, symbols, and rename, plus compact `Text`
  renderers for goto-definition and prepare-rename.
- Status footer (`ctx.ui.setStatus("pi-lsp", ...)`) showing alive vs
  initializing server counts, updated on `session_start` and `turn_end`,
  cleared on `session_shutdown`.
- `LspManager.getSnapshot()` API exposing per-client `{ root, serverId,
  refCount, pendingWaiters, lastUsedAt, isInitializing, alive, command }`
  for both the `/lsp` inspector and tests.
- TypeBox tool schemas with `StringEnum` for enum parameters so the tool
  surface stays compatible with Google's tool-calling API.
- `lsp_rename.executionMode = "sequential"` so workspace edits never race
  against pi's parallel tool execution or other mutating tools.
