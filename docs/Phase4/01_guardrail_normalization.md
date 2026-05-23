# T4.1 Guardrail Normalization

> **Ticket**: T4.1
> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase4/closing-report.md

## Problem

Phase1 documented default autonomy forbidden scopes, but `ObjectiveStore.create({ guardrails: {} })` could bypass them. The old merge path treated an explicitly empty `forbiddenScopes` array as present, so `[] ?? fallback` selected the empty array instead of the default safety boundary.

## Change

`src/autonomy/guardrails.ts` centralizes the guardrail defaults and normalization logic. `normalizeObjectiveGuardrails` preserves explicit scalar guardrail fields, deduplicates custom forbidden scopes, and always includes `DEFAULT_AUTONOMY_FORBIDDEN_SCOPES` in the stored objective.

Invariant: stored objectives cannot drop the default forbidden scopes by omitting guardrails, passing `{}`, or passing a custom `forbiddenScopes` array.

## Verification

`packages/coding-agent/test/autonomy/store.test.ts` adds two regression cases:

- `applies default forbidden scopes when guardrails are omitted` covers `ObjectiveStore.create({ guardrails: {} })`.
- `merges custom forbidden scopes with defaults` covers custom scope preservation plus default scope retention and deduplication.
