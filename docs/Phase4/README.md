# Phase4 driving doc

> **Status:** Historical implementation record. This driving doc records the completed Phase4 autonomy-safety and operator-interface plan; use the canonical repository README and docs index for current system state.

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

## Dispatch contract

Each `task` call MUST include:

- `role`, `scope.include`, `scope.exclude`.
- `successCriteria` with concrete `command-exit` per acceptance.
- `inputArtifact` pointing at the per-ticket doc.
- `escalation.onUncertainty = ask-parent`.
- `outputContract.mustProduce` enumerating expected artifacts.

## Coordination

- T4.1 lands before T4.2 so candidate target-path checks evaluate against the normalized default forbidden scopes.
- T4.3 is independent of T4.1/T4.2 and only removes dead `as never` casts from `src/cli/objective.ts`.
- T4.4 consumes the landed objective and proposal surfaces as delegates. It must not fork existing mutation behavior.

## Forbidden scope-bleed

- Subagents NEVER touch `docs/Phase1/**`, `docs/Phase2/**`, `docs/Phase3/**` other than referencing.
- Subagents NEVER edit `package.json` scripts.
- Subagents NEVER alter existing `run*` command signatures in `src/cli/objective.ts` or `src/cli/proposals.ts`.

## Verification ladder

1. Per-ticket acceptance command.
2. Targeted Phase4 sweep on autonomy and CLI tests touched by this phase.
3. Final `bun run check:ts`.
4. Closing report at `docs/Phase4/closing-report.md` mirroring Phase3's structure.

## Ticket index

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
|T4.1|[01_guardrail_normalization.md](01_guardrail_normalization.md)|P0|landed (2026-05-23)|—|`packages/coding-agent/test/autonomy/store.test.ts`|
|T4.2|[02_candidate_target_paths.md](02_candidate_target_paths.md)|P1|landed (2026-05-23)|T4.1|`packages/coding-agent/test/autonomy/limits.test.ts`|
|T4.3|[03_autonomy_enabled_typecast.md](03_autonomy_enabled_typecast.md)|P0|landed (2026-05-23)|—|`bun run check:ts`|
|T4.4|[04_evolve_cli.md](04_evolve_cli.md)|P2|landed (2026-05-23)|T4.1, T4.2|`packages/coding-agent/test/cli/evolve.test.ts`|
|—|[00_overview.md](00_overview.md)|Ω|landed (2026-05-23)|—|—|
|—|[exit_criteria.md](exit_criteria.md)|Ω|landed (2026-05-23)|T4.1–T4.4|closing-report exit criteria checklist|
|—|[closing-report.md](closing-report.md)|Ω|closed|T4.1–T4.4|—|

## Reference docs

|코드|문서|Phase|Status|의존|Evidence|
|---|---|---|---|---|---|
