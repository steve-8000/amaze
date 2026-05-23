# T4.2 Candidate Target Paths

> **Ticket**: T4.2
> **Phase**: P1
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase4/closing-report.md

## Problem

`candidateTargetPaths` did not expose the real filesystem or logical mutation targets that guardrails need to evaluate. Settings proposals returned only patch keys, while rule and skill proposals returned `[]`, so default forbidden scopes could not deny those proposal types reliably.

## Change

`candidateTargetPaths` now returns concrete targets per proposal type:

- Settings proposals include `.amaze/settings.json` plus `settings:<key>` for every patch key.
- Rule proposals include `.amaze/rules/**`.
- Skill proposals include `.amaze/skills/<name>.md`.

This gives `shouldEmitProposal` a stable target list for default and custom forbidden-scope checks.

## Verification

`packages/coding-agent/test/autonomy/limits.test.ts` adds denial coverage for settings, rule, and skill proposals:

- A default-guardrail settings proposal is denied and the reason mentions `.amaze/settings.json`.
- A rule proposal is denied when `.amaze/rules/**` is forbidden.
- A skill proposal is denied when its `.amaze/skills/<name>.md` target is forbidden.
