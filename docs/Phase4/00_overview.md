# Phase4 Driving Doc

> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase4/closing-report.md

## Intent

Phase4 closes the autonomy safety boundary documented but not enforced in Phase1, and adds an operator control plane (`amaze evolve`) that routes existing autonomy + learning surfaces through a single interface.

## Phase order

```text
Phase 4P0  (safety)
  T4.1 guardrail-normalization
  T4.3 autonomy-enabled-typecast

Phase 4P1  (target paths)
  T4.2 candidate-target-paths

Phase 4P2  (operator interface)
  T4.4 evolve-cli

Phase 4Ω   (integration)
  T4.5 Phase4 docs + closing report
```

## Forbidden scope-bleed

- Subagents NEVER touch `docs/Phase1/**`, `docs/Phase2/**`, `docs/Phase3/**` other than referencing.
- Subagents NEVER edit `package.json` scripts.
- Subagents NEVER alter existing `run*` command signatures in `src/cli/objective.ts` or `src/cli/proposals.ts`.
