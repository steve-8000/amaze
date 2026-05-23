# T4.3 Autonomy Enabled Typecast

> **Ticket**: T4.3
> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase4/closing-report.md

## Problem

`src/cli/objective.ts` carried `as never` casts when setting `"autonomy.enabled"`. That setting was already registered in `config/settings-schema.ts:2182`, so the casts were dead code rather than a real type-system requirement.

## Change

The `settings.set("autonomy.enabled", ...)` calls now pass typed values directly. No command signature or behavior changed; the edit only removes obsolete casts from the CLI implementation.

## Verification

`bun run check:ts` is the acceptance check for this ticket. The command must exit 0, and `src/cli/objective.ts` must not contain the removed `as never` casts on `"autonomy.enabled"` writes.
