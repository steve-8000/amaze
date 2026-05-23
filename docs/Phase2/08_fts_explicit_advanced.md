# T11.8 — FTS5 advanced query: explicit opt-in
> **Ticket**: T11.8
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase2/closing-report.md

## Current state (grounded)

`packages/coding-agent/src/nexus/session-search.ts:477-480` and `packages/coding-agent/src/nexus/store.ts:1639-1642`:

```ts
function escapeFts5Query(query: string): string {
  if (/\b(OR|AND|NOT|NEAR)\b/.test(query)) return query;
  return `"${query.replace(/"/g, '""')}"`;
}
```

The substring heuristic decides whether to quote. A literal user query of "my OR friend" enters raw mode unintentionally. SQL injection is prevented by parameter binding, but FTS5 syntax errors propagate to the caller as opaque failures.

## Acceptance

1. `escapeFts5Query(query, opts?: { advanced?: boolean })`:
   - `advanced: false` (default): ALWAYS quote-and-escape. No regex-based mode-flip.
   - `advanced: true`: pass-through (caller asserts they want operator syntax).
2. The two call sites updated:
   - `nexus/session-search.ts:167`: pass `advanced` from the public search options. Plumb through `SessionSearchOptions.advancedQuery?: boolean`.
   - `nexus/store.ts:693`: pass `advanced` from the public memory-search options. Plumb through `NexusSearchInput.advancedQuery?: boolean`.
3. CLI exposure: `amaze memory search` and the nexus session-search CLI surfaces accept a `--advanced` flag that toggles the new option. Default false.
4. Existing default behaviour for plain-word queries is unchanged (already quoted). The behaviour change affects only queries that previously slipped into raw mode by accident.
5. Tests in `packages/coding-agent/test/nexus/fts-escape.test.ts`:
   - `escapeFts5Query("foo")` → `"foo"`.
   - `escapeFts5Query("foo OR bar")` → `"foo OR bar"` (quoted) by default.
   - `escapeFts5Query("foo OR bar", { advanced: true })` → `foo OR bar` (raw).
   - `escapeFts5Query("a\"b")` → `"a""b"` (escaping preserved).
6. Integration tests in `test/nexus` updated: any test that previously relied on accidental raw mode must add `advancedQuery: true` explicitly.

## Implementation outline

Replace both copies of `escapeFts5Query` with a single shared implementation under `packages/coding-agent/src/nexus/fts-escape.ts` exported as `escapeFts5Query(query: string, opts?: { advanced?: boolean }): string`. Both call sites import the shared symbol. The duplicate inline functions are deleted.

Update the calling signatures:

```ts
// session-search.ts
const sql = escapeFts5Query(trimmed, { advanced: options.advancedQuery === true });

// store.ts
const sql = escapeFts5Query(query, { advanced: input.advancedQuery === true });
```

Public option types (in the same files) gain the new optional field.

## Boundaries

- Touch: `src/nexus/fts-escape.ts` (new), `src/nexus/session-search.ts`, `src/nexus/store.ts`, `src/cli/memory.ts` (`--advanced` flag), `test/nexus/fts-escape.test.ts` (new), and any test under `test/nexus/**` that relied on accidental raw mode.
- Do not change FTS5 indexing or migration logic.

## Verification

- `bun --cwd packages/coding-agent test test/nexus test/cli/memory.test.ts` exit 0.
- `bun run check:ts` exit 0.
