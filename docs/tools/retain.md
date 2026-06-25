# retain

Store durable facts through the active long-term memory backend.

## Source
- Entry: `packages/coding-agent/src/tools/memory-retain.ts`
- Rocky client: `packages/coding-agent/src/rocky/backend.ts`
- Rocky service implementation: `packages/rocky-memory/src/http-bridge.ts` behind the Rocky API
- Hindsight collaborators: `packages/coding-agent/src/hindsight/*`

## Flow
1. `MemoryRetainTool.createIf(...)` exposes the tool when `memory.backend` is `"hindsight"` or `"rocky"`.
2. For `rocky`, Amaze calls `POST /v1/rocky/memory/store` for each item.
3. Rocky delegates storage to the `rocky-memory` Beam engine, preserving the durable SQLite, scoring, metadata, and diagnostics capabilities from the previous local memory runtime.
4. For `hindsight`, Amaze queues items in the existing Hindsight retain queue.

## Rocky Contract
- Request: `{ text, scope, source, tags }`
- Response: `{ ok: true, item: { id, text, content, source, tags, scope } }`
- Amaze never opens the memory database directly; all Rocky memory work is HTTP API based.
- The same Rocky endpoint also serves `rocky-codebase` under `/v1/rocky/codebase/*`.

## Errors
- Empty content is rejected before the HTTP call.
- Rocky store failures are surfaced to the tool caller.
- Hindsight queue failures retain the existing Hindsight behavior.
