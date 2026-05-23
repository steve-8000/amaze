# Phase 5 — Scope Isolation and Operations

## Objective

Strengthen safety boundaries so repository knowledge stays correctly scoped and operational behavior remains predictable under long-lived usage.

## Out of scope

- no writeback yet
- no broad policy engine rewrite
- no unrelated prompt copy changes

## Prerequisites

- repository knowledge indexing is already incremental
- provenance fields are strong enough to reason about scope and source boundaries

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/scope.ts`
- `packages/coding-agent/src/nexus/config.ts`
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/memory-backend/nexus-backend.ts`
- operational tests and doctor-style checks

## Implementation slices

### Slice 1: Scope isolation rules
- formalize current-project vs shared knowledge behavior
- prevent accidental cross-repo bleed when multiple worktrees or roots are involved
- make explicit when a query can search beyond the current repo root

### Slice 2: Doctor and diagnostics
- add checks for stale indexes, oversized repos, missing provenance, and scope leakage
- keep the output operational, not academic

### Slice 3: Maintenance boundaries
- separate cold-start indexing, periodic cleanup, and explicit repair commands
- ensure maintenance paths can be disabled or bounded in automation

### Slice 4: Budget and safety controls
- expose knobs for max files, max bytes, and maintenance cadence
- verify these controls are actually enforced in tests

## Verification

- tests for multiple repository roots or synthetic scope collisions
- doctor tests proving leakage/staleness conditions are detected
- bounded-maintenance tests that ensure startup does not silently expand work

## Exit criteria

- repository knowledge is reliably isolated to the intended repo root by default
- operational diagnostics can spot common corruption or drift modes
- maintenance behavior is explicit and bounded

## Carry-forward notes

- if later product requirements need cross-repo search, record that as an opt-in extension instead of weakening the default isolation contract here
