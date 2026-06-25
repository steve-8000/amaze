# reflect

Synthesize an answer over the active long-term memory backend.

## Source
- Entry: `packages/coding-agent/src/tools/memory-reflect.ts`
- Rocky client: `packages/coding-agent/src/rocky/backend.ts`
- Hindsight collaborators: `packages/coding-agent/src/hindsight/*`

## Flow
1. `MemoryReflectTool.createIf(...)` exposes the tool when `memory.backend` is `"hindsight"` or `"rocky"`.
2. For `rocky`, Amaze performs a Rocky memory recall through `POST /v1/rocky/memory/recall` and formats the returned memories into a concise answer.
3. For `hindsight`, Amaze calls the Hindsight reflect API as before.

## Rocky Contract
- The optional `context` field is appended to the recall query as additional context.
- No local memory state is required inside Amaze.
- All durable memory lookup comes from the Rocky endpoint and is backed by `rocky-memory`.

## Errors
- Rocky HTTP failures are logged and rethrown.
- Empty Rocky recall results return `No relevant information found to reflect on.`
