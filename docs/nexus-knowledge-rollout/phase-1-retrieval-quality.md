# Phase 1 — Retrieval Quality

## Objective

Improve Nexus repository retrieval quality without increasing prompt-path cost or widening scope semantics.

## Out of scope

- no writeback into repository knowledge
- no new external transports
- no large schema rewrite beyond what retrieval quality strictly needs

## Prerequisites

- current `nexus/knowledge` store is present
- current `repo_search`, `code_def`, `code_refs`, `code_callers`, `code_callees` tools are green

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/nexus/knowledge/types.ts`
- `packages/coding-agent/src/memory-backend/nexus-backend.ts`
- `packages/coding-agent/src/tools/repo-search.ts`
- focused Nexus knowledge tests

## Implementation slices

### Slice 1: Recall budget discipline
- add explicit section budgets for operational memory vs repository knowledge
- deduplicate near-identical snippets before prompt injection
- hard-cap the final recall block per section and in aggregate

### Slice 2: Ranking refinement
- improve FTS ranking normalization
- add lightweight reciprocal-rank style fusion if multiple candidate sources are blended
- preserve deterministic fallback when embeddings are unavailable

### Slice 3: Query shaping
- normalize path-prefixed and symbol-like queries
- bias exact symbol/path matches higher than loose textual mentions
- keep ranking rules local and inspectable

### Slice 4: Retrieval diagnostics
- return compact ranking metadata for test/debug paths
- make it possible to explain why a snippet outranked another

## Verification

- targeted tests for ranking order
- prompt-injection unit tests that prove section budgets are enforced
- no regression in no-embedding mode
- no synchronous write on recall path

## Exit criteria

- retrieval order is more stable for exact symbol/path queries
- repository knowledge injection is budgeted and deduplicated
- tests demonstrate bounded prompt behavior

## Carry-forward notes

- if ranking wants richer structure than current chunk rows provide, record the minimum schema delta needed for Phase 3 instead of widening Phase 1 in place
