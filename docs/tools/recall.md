# recall

Search the active long-term memory backend and return matching memories.

## Source
- Entry: `packages/coding-agent/src/tools/memory-recall.ts`
- Rocky client: `packages/coding-agent/src/rocky/backend.ts`
- Hindsight collaborators: `packages/coding-agent/src/hindsight/*`

## Flow
1. `MemoryRecallTool.createIf(...)` exposes the tool when `memory.backend` is `"hindsight"` or `"rocky"`.
2. For `rocky`, Amaze calls `POST /v1/rocky/memory/recall` on the Rocky endpoint.
3. Rocky serves that request through the `rocky-memory` Beam engine and returns scored memory rows.
4. For `hindsight`, Amaze keeps using the Hindsight session state and remote Hindsight API.

## Rocky Contract
- Request: `{ query, scope, limit }`
- Response: `{ ok: true, items: [{ id, content, text, source, score, created_at, updated_at }] }`
- Scope is project based by default, using `rocky.projectPath` or the current cwd.
- The tool formats returned ids so later `memory_edit` calls can update, invalidate, or forget them.

## Errors
- Rocky HTTP failures are logged and rethrown.
- Hindsight failures preserve the existing Hindsight error mapping.
