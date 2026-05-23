# Phase 3 — Indexing and Chunking

## Objective

Make repository indexing incremental, structure-aware, and cheap enough to maintain continuously.

## Out of scope

- no remote sync system
- no repository writeback
- no unrelated changes to operational memory extraction

## Prerequisites

- current knowledge layer schema is stable enough to extend safely
- Phase 1 retrieval ranking decisions are settled

## Target files

Primary candidates:
- `packages/coding-agent/src/nexus/knowledge/indexer.ts`
- `packages/coding-agent/src/nexus/knowledge/store.ts`
- `packages/coding-agent/src/nexus/config.ts`
- `packages/coding-agent/src/memory-backend/nexus-backend.ts`
- indexing tests and synthetic corpus fixtures

## Implementation slices

### Slice 1: Incremental indexing
- index changed files only
- skip unchanged files by content hash
- prune stale documents/chunks/symbols when files disappear

### Slice 2: Better chunking
- split markdown by heading boundaries where possible
- keep code chunks aligned to symbol or block boundaries when possible
- avoid giant catch-all chunks that dominate ranking

### Slice 3: Operational triggers
- separate startup indexing from ongoing maintenance
- define when indexing runs automatically and when it is manual
- ensure no unbounded repository walk happens on prompt path

### Slice 4: Bounded repo scanning
- formalize skip directories and file-size caps
- expose per-repo indexing stats for observability
- fail soft on unreadable files without poisoning the whole index pass

## Verification

- tests proving unchanged repos do not fully reindex
- tests for stale document cleanup
- chunking tests for markdown headings and code blocks
- no startup regressions beyond bounded indexing budget

## Exit criteria

- repository indexing is incremental
- chunk shape is more semantically aligned than line-count-only slicing
- startup and maintenance paths remain bounded and observable

## Carry-forward notes

- if incremental state needs new tables or watermarks, document the migration and backfill path explicitly for future phases
