# Phase 6 — Knowledge Writeback and Evaluations

## Objective

Add disciplined, testable writeback and regression evaluation only after retrieval, provenance, and scope control are trustworthy.

## Out of scope

- no free-form repository mutation from prompt recall
- no uncontrolled auto-writing of search results back into the knowledge layer
- no skipping evaluation because the feature "looks right"

## Prerequisites

- Phases 1 through 5 are complete
- repository results are already auditable and scoped

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/nexus/pipeline.ts`
- `packages/coding-agent/src/nexus/doctor.ts`
- new eval scripts/tests under `packages/coding-agent/test/`
- any new command or internal maintenance entrypoints needed for safe writeback

## Implementation slices

### Slice 1: Writeback contract
- define exactly what can be written back into repository knowledge and from which sources
- separate durable repository knowledge from operational memory observations
- require provenance and acceptance criteria for every writeback path

### Slice 2: Structured write flows
- add narrow writeback helpers for high-confidence cases only
- reject broad or ambiguous auto-write behavior
- preserve idempotence and traceability

### Slice 3: Regression evaluation
- build repeatable retrieval and code-intelligence fixtures
- compare ranking and lookup behavior across changes
- keep benchmark scripts separate from prompt-path runtime

### Slice 4: Release readiness checks
- add doctor/eval hooks that block unsafe rollout when retrieval quality or scope guarantees regress
- document the operator workflow for reindex, inspect, repair, and verify

## Verification

- explicit tests for accepted and rejected writeback cases
- retrieval eval fixtures for repo search and code lookup
- doctor/eval checks showing regressions are detectable

## Exit criteria

- any writeback path is narrow, explainable, and idempotent
- retrieval and code intelligence have repeatable regression coverage
- operators have a documented safe workflow for maintaining Nexus knowledge

## Carry-forward notes

- if future work expands knowledge writeback to more content classes, open a new plan rather than stretching Phase 6 beyond its acceptance envelope
