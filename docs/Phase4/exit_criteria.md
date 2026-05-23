# Phase4 Exit Criteria
> **Status**: landed (2026-05-23) — reference


Phase4 closes only when every check below holds against current-state evidence.

## Mandatory checks

1. **Default guardrails cannot be bypassed.** `ObjectiveStore.create({ guardrails: {} })` returns the four default forbidden scopes. Test: `packages/coding-agent/test/autonomy/store.test.ts`.

2. **Default guardrails deny settings mutations.** `shouldEmitProposal(default-guardrail-objective, settingsProposal)` denies and the reason mentions `.amaze/settings.json`. Test: `packages/coding-agent/test/autonomy/limits.test.ts`.

3. **Typecheck clean and dead cast removed.** `bun run check:ts` exits 0, and no `as never` cast remains on `"autonomy.enabled"` writes in `src/cli/objective.ts`.

4. **Operator router works on a fresh HOME.** `amaze evolve status`, `amaze evolve preview`, `amaze evolve proposals`, and `amaze evolve doctor` paths are covered by `packages/coding-agent/test/cli/evolve.test.ts`; fresh-HOME covered commands exit 0 and the missing-preview-id path fails with a usage error instead of mutating state.

5. **Documentation closure is canonical.** All Phase4 ticket docs follow the metadata block, and `docs/Phase4/closing-report.md` follows the canonical seven-section ordering: Summary, Typecheck, Test sweep, Per-ticket status, Exit criteria checklist, Open follow-ups, Next steps.

## Closing artifact

- `docs/Phase4/closing-report.md` with sections: Summary, Typecheck, Test sweep, Per-ticket status, Exit criteria checklist, Open follow-ups, Next steps.
