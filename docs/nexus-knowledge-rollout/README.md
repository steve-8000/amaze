# Nexus Knowledge Rollout

This folder is the long-run execution plan for extending Nexus without broadening the active working set more than necessary.

## Operator rules

1. Read this file first.
2. Read exactly one phase file at a time while implementing.
3. Keep the active todo list aligned to the current phase only.
4. Do not preload later-phase details into the prompt unless the current phase explicitly depends on them.
5. Verify each phase against its own acceptance section before moving forward.
6. Record follow-up discoveries in the current phase file or a linked issue, not in ad hoc prompt summaries.

This keeps goal-mode work progressing without carrying a swollen cross-phase context block from turn to turn.

## Current baseline

Already present in Nexus:
- operational memory backend
- repository knowledge store
- repository indexing
- repo search
- code definition/reference/caller/callee tools
- first-pass unified recall injection

The remaining work is refinement, correctness, scale, and maintainability.

## Phase map

| Phase | File | Goal |
| --- | --- | --- |
| 1 | `phase-1-retrieval-quality.md` | Improve retrieval quality and recall budgeting |
| 2 | `phase-2-code-intelligence.md` | Raise code intelligence accuracy and graph depth |
| 3 | `phase-3-indexing-and-chunking.md` | Make indexing incremental, bounded, and structure-aware |
| 4 | `phase-4-provenance-and-explainability.md` | Make every surfaced result auditable |
| 5 | `phase-5-scope-isolation-and-ops.md` | Strengthen source isolation and operational safety |
| 6 | `phase-6-knowledge-writeback-and-evals.md` | Add disciplined writeback and regression evaluation |

## Phase execution contract

Each phase file contains the same sections:
- objective
- out of scope
- prerequisites
- target files
- implementation slices
- verification
- exit criteria
- carry-forward notes

## How to use this in goal mode

When starting a phase:
1. Read `docs/nexus-knowledge-rollout/README.md`
2. Read the chosen phase file only
3. Initialize todo items from that phase's implementation slices
4. Implement and verify only that phase
5. Mark completion and only then read the next phase file

## Sequencing guidance

- Phase 1 is required before 4 and 6.
- Phase 2 and 3 may overlap, but Phase 2 should not depend on unlanded indexing schema changes from Phase 3 without first codifying the contract in the phase notes.
- Phase 5 should land before enabling any broader writeback in Phase 6.
- Phase 6 is last because it depends on retrieval confidence, provenance, and isolation discipline.
