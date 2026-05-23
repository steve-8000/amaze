# Phase 4 — Provenance and Explainability

## Objective

Make every surfaced repository result explainable enough for a maintainer to trust or reject it quickly.

## Out of scope

- no generalized UI redesign
- no broad analytics dashboard
- no speculative hypothesis engine changes unless directly required by knowledge provenance

## Prerequisites

- retrieval ranking from Phase 1 is stable
- code/document indexing from Phases 2 and 3 provides enough metadata to cite sources

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/nexus/knowledge/types.ts`
- `packages/coding-agent/src/tools/repo-search.ts`
- `packages/coding-agent/src/tools/nexus-memory-explain.ts`
- any new knowledge explain tool if warranted
- focused tests for result explanations

## Implementation slices

### Slice 1: Provenance model hardening
- carry document path, chunk span, and symbol lineage consistently
- distinguish stored facts from inferred ranking reasons
- keep the provenance format stable across tools

### Slice 2: Explain APIs
- add a repository-knowledge explain path
- return why a result matched: exact term, symbol, path, rank blend, or fallback
- make explain output compact enough for tool use

### Slice 3: Recall transparency
- surface enough ranking metadata in debug/test mode to audit behavior
- keep normal user-facing output concise

### Slice 4: Failure visibility
- make missing provenance a detectable error case in tests
- prefer no answer over an untraceable answer

## Verification

- tests that explanation paths include chunk/document provenance
- tests that exact symbol matches and fallback text matches explain themselves differently
- tests that prompt recall can still stay within budget while preserving source cues

## Exit criteria

- repository knowledge results are auditable end-to-end
- explanation output is consistent across search and code tools
- no result is surfaced without a traceable source path and span

## Carry-forward notes

- if provenance wants richer source categories later, record the schema hook but keep Phase 4 centered on explainability, not taxonomy growth
