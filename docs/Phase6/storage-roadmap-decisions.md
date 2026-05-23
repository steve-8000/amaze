# Phase6 — Storage Roadmap Decisions

## Overview

Single decision record covering four follow-ups deferred or rejected after recon during the `autonomy.db` consolidation work.

The goal is to capture rationale and re-evaluation triggers so future work does not re-litigate these calls from scratch.

These decisions are intentionally conservative:

- Do not reverse existing data-lifecycle boundaries without measured need.
- Do not add native database extension surface without a latency ceiling.
- Do not turn research items into implementation work before a product trigger exists.
- Keep current source code unchanged.

## D1. Nexus memory plane consolidation — REJECTED

> **status: rejected**

### Proposed

Consolidate the Nexus memory plane back into one `nexus.db` surface so operational memory, knowledge, and session search could be ranked or queried from one database file.

The motivation was simpler cross-source retrieval and fewer storage files for future memory work.

### Evidence found this turn

- `packages/coding-agent/src/nexus/knowledge/migration.ts:14` defines `MIGRATION_MARKER_FILE` for knowledge migration state.
- `packages/coding-agent/src/nexus/knowledge/migration.ts:16-25` implements `migrateKnowledgeIntoSeparateDb`, opening the operational DB only to move legacy knowledge out once and skip when the marker exists.
- `packages/coding-agent/src/nexus/knowledge/migration.ts:42-46` opens `getNexusKnowledgeDbPath(agentDir)`, attaches the legacy operational database, and ensures the separate knowledge schema.
- `packages/coding-agent/src/nexus/knowledge/migration.ts:50-79` copies legacy knowledge tables into the separate knowledge DB.
- `packages/coding-agent/src/nexus/session-search.ts:17-18` states that session data lives in sibling `nexus-sessions.db` so its schema evolves independently of the canonical Nexus store.

### Why rejected

The proposal is the inverse of a prior architectural decision already encoded in migration code.

Knowledge was intentionally moved out of `nexus.db`, with a marker file preventing repeated migration. Session search also carries an explicit comment documenting independent schema evolution as the reason for a sibling DB.

Undoing that split would not be a neutral simplification. It would collapse lifecycle boundaries that currently let operational memory, regenerated knowledge, and transcript-derived session search evolve at different speeds.

The desired retrieval behavior can be explored without consolidation by attaching the databases at query time and ranking across the results in a thin read-only helper.

### Re-evaluate when

- Cross-source ranking becomes a measured user need and `ATTACH`-at-query-time is insufficient.
- Or knowledge regeneration cost drops to where lifecycle separation no longer matters.

## D2. sqlite-vec attachment — DEFERRED

> **status: deferred**

### Proposed

Attach `sqlite-vec` to the Nexus store so embedded memories can use an approximate-nearest-neighbor index instead of a linear cosine scan.

The intended benefit was faster vector retrieval once memory embeddings become common.

### Evidence found this turn

- `packages/coding-agent/src/nexus/store.ts:197-200` stores embeddings on `memory_items` as `embedding BLOB`, `embedding_model`, and `embedding_dim`.
- `packages/coding-agent/src/nexus/store.ts:606-608` documents the embedding format as little-endian `Float32` bytes.
- `packages/coding-agent/src/nexus/store.ts:653-686` implements current pure cosine top-K by selecting rows where `mi.embedding IS NOT NULL`, decoding each vector, scoring with `cosineSimilarity`, sorting, and slicing to the requested limit.
- `packages/coding-agent/src/config/settings-schema.ts:1381` sets `nexus.embeddings.enabled` default to `false`.
- `packages/coding-agent/src/config/settings-schema.ts:1390` also sets `nexus.vector.enabled` default to `false`.

### Why deferred

The current implementation is simple and correct for the observed product state: most users have embeddings disabled by default, and there is no measured latency ceiling showing the linear scan is a problem.

Adding `sqlite-vec` now would introduce native extension loading and platform-binary support surface before there is evidence that the existing scan is insufficient.

This is a performance optimization with operational cost, not a required storage migration.

### Re-evaluate when

- A user reports `vectorSearch` / top-K cosine latency greater than 50ms at p95.
- Or active embedded `memory_items` count crosses roughly 20k for a real user.
- Or a downstream feature, such as autosuggest or persona profile retrieval, requires sub-second vector retrieval under interactive load.

## D3. libSQL evaluation — RESEARCH-ONLY

> **status: research-only**

### What libSQL would buy

- Native vector support through DiskANN / HNSW-style indexing, depending on the deployed libSQL surface.
- Embedded replica plus remote primary sync for users who want the same agent memory across machines.
- A path to combine local-first SQLite ergonomics with optional network replication.

### Cost

- Driver swap from `bun:sqlite` to `@libsql/client`, or an adapter layer that supports both APIs.
- Query layer audit for every callsite that relies on Bun SQLite statement behavior, transactions, blob handling, and synchronous execution.
- Operational dependency on a remote primary for sync scenarios, even if self-hosting remains possible.
- Young ecosystem risk relative to plain SQLite and Bun's built-in driver.

### Trigger to start implementation spike

- A user explicitly requests: "sync my agent across two machines".
- Or D2 becomes urgent and libSQL is cheaper than loading and distributing `sqlite-vec`.

### Out of scope right now

Any code change.

The next useful action is a written evaluation or spike plan only after one of the triggers is true.

## D4. DuckDB observability ad-hoc layer — RESEARCH-ONLY

> **status: research-only**

### Use case

Run read-only analytical queries over `~/.amaze/observability/sessions/*.jsonl` without first importing those logs into the operational store.

DuckDB would be useful for column-store scans, ad-hoc aggregation, and direct JSON or Parquet ingest when observability data grows beyond simple CLI aggregation.

### Cost

- Adds another runtime dependency if bundled with the product.
- Or creates an opt-in tool dependency if left external.
- Gives maintainers two storage runtimes to understand when debugging metrics and observability behavior.
- Risks turning simple JSONL summaries into a separate analytics subsystem before the current aggregation path proves insufficient.

### Trigger

- Metric aggregation in `cli/metrics.ts` becomes too slow for typical user data volume.
- Or an analytical command, such as `amaze observe analyze`, needs sub-second response over weeks of JSONL.

### Out of scope right now

Any code change.

This remains a research-only option until an observability command has a measured query shape that plain JSONL processing cannot satisfy.

## Summary table

| Decision | Status | Trigger to revisit |
| --- | --- | --- |
| Nexus memory plane consolidation | rejected | Measured cross-source ranking need and read-only `ATTACH` is insufficient, or knowledge lifecycle separation no longer matters. |
| sqlite-vec attachment | deferred | p95 top-K cosine latency exceeds 50ms, active embedded memories cross roughly 20k, or an interactive feature needs sub-second vector retrieval. |
| libSQL evaluation | research-only | User requests cross-machine sync, or vector indexing becomes urgent and libSQL is cheaper than sqlite-vec. |
| DuckDB observability ad-hoc layer | research-only | Current metrics aggregation is too slow, or an analytical observability command needs sub-second scans over weeks of JSONL. |

## Notes for future work

### Cross-source ranking without consolidation

Try `ATTACH`-at-query-time before moving storage boundaries.

A thin `withMemoryPlane()` helper could open operational memory, knowledge, and session DBs read-only, expose a unified prepared statement, and close all handles after the query.

That keeps lifecycle boundaries intact while testing whether unified ranking is useful.

### sqlite-vec opt-in path

If D2 is triggered, load the extension conditionally and keep the current brute-force scan as the fallback.

That preserves the default install footprint for users with no embeddings and avoids making native extension support a baseline requirement.

### Research discipline

libSQL and DuckDB should not be introduced as speculative infrastructure.

Both need a concrete user-facing command or measured bottleneck before implementation work starts.
