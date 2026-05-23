# Phase 2 — Code Intelligence

## Objective

Raise code intelligence from lightweight symbol lookup to a dependable repository navigation layer.

## Out of scope

- no general-purpose language server replacement
- no broad multi-language parser program unless a narrow contract is proven first
- no prompt-surface expansion unrelated to code navigation

## Prerequisites

- Phase 1 retrieval budgets are in place
- current code tools are already wired and tested

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/knowledge/indexer.ts`
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/nexus/knowledge/types.ts`
- `packages/coding-agent/src/tools/code-def.ts`
- `packages/coding-agent/src/tools/code-refs.ts`
- `packages/coding-agent/src/tools/code-callers.ts`
- `packages/coding-agent/src/tools/code-callees.ts`
- focused Nexus code tests

## Implementation slices

### Slice 1: Symbol extraction accuracy
- improve JS/TS symbol extraction for methods, object members, exported aliases, and default exports
- record parent symbol path where possible
- keep a strict fallback path when richer parsing fails

### Slice 2: Reference accuracy
- reduce false positives from substring matches
- distinguish definition hits from reference hits more reliably
- attach document and line-level context suitable for tool output

### Slice 3: Caller/callee graph depth
- store lightweight call edges where extraction is reliable
- prefer stored edges over recomputing regex heuristics at query time
- keep query behavior bounded for large files

### Slice 4: Contract hardening
- define which symbol kinds are supported
- codify unsupported patterns instead of silently guessing

## Verification

- exact definition lookup tests
- reference tests with same-name identifiers in different scopes
- caller/callee tests across multiple files
- bounded performance tests for large synthetic files

## Exit criteria

- code tool outputs are stable for common JS/TS project patterns
- caller/callee answers do not rely solely on naive line scanning
- unsupported cases fail clearly instead of returning misleading results

## Carry-forward notes

- if richer parsing needs a dedicated parser dependency, capture the exact integration boundary for Phase 3 or a separate follow-up instead of burying it in one large refactor
