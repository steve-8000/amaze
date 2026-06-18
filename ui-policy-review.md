# UI Policy Review Findings

- Low: `vendor/amaze-subagents/test/unit/context-builder-contract.test.ts` does not guard the new fresh/narrow scout and memory-fallback policy. It only checks contract shape/source-of-truth text, so deleting `Prefer fresh`, scout narrowing, or `fallback_when_unavailable` would still pass.
- Low: `vendor/amaze-subagents/test/unit/index-child-registration.test.ts` guards `renderCall` label removal/async badge, but does not cover `renderResult` reusing an existing `SubagentBoxWrapper` and resetting its header to `Executable`. The implementation does call `setHeader("Executable")`, but the reused-wrapper behavior is unguarded.
