# T11.7 — Mandatory regression-command gate at apply

## Current state (grounded)

`applyProposal()` (`packages/coding-agent/src/learning/apply/index.ts`) applies an `approved` proposal, snapshots state, atomic-writes the change, records promotion. It does NOT require a fresh sandbox-replay outcome to exist; an approved proposal can be applied even if no regression evidence was ever produced.

T11.4 adds sandbox replay; T11.7 closes the loop by requiring it at apply time when the proposal claims regression commands.

## Acceptance

1. `applyProposal(proposal, opts)` refuses to apply when:
   - `proposal.regressionCommands?.length > 0`, AND
   - `proposal.lastEvalReport?.sandbox?.ok !== true`, OR
   - the patch hash of the current proposal does not match the patch hash recorded in `lastEvalReport.patchHash` (i.e. proposal mutated after eval).
   Refusal surfaces as a proposal event of type `apply-rejected` with reason `stale-eval | missing-sandbox | sandbox-fail`.
2. When `proposal.regressionCommands` is empty, the existing apply path is unchanged (back-compat with proposals that opted into human-only gates).
3. CLI `amaze proposals apply <id>` displays the rejection reason and exits non-zero on rejection.
4. Snapshot/rollback unaffected.
5. Tests in `packages/coding-agent/test/learning/apply-regression-gate.test.ts` cover:
   - Apply allowed when sandbox passed and patch hash matches.
   - Apply rejected with `stale-eval` when proposal patch differs from eval's recorded hash.
   - Apply rejected with `missing-sandbox` when proposal carries regressionCommands but no sandbox report exists.
   - Apply rejected with `sandbox-fail` when last sandbox `ok=false`.
   - Apply allowed when proposal has no regressionCommands (existing path).

## Implementation outline

### Type additions (learning/types.ts)

```ts
export interface LearningProposal {
  // ...
  regressionCommands?: Array<...>;     // from T11.4
  lastEvalReport?: EvalReport;          // new — populated by evaluateProposal
}
export interface EvalReport {
  // ...
  patchHash: string;                    // sha256 of canonical-stringified patch at eval time
  sandbox?: SandboxReplayReport;
}
```

### Eval pipeline (learning/eval/pipeline.ts)

`evaluateProposal` writes `patchHash` and `sandbox` into the returned report AND persists onto the proposal via `proposalStore.setLastEval(proposal.id, report)`. New store method.

### Apply guard (learning/apply/index.ts)

```ts
if (proposal.regressionCommands?.length) {
  const evalRep = proposal.lastEvalReport;
  if (!evalRep?.sandbox) return reject("missing-sandbox");
  if (!evalRep.sandbox.ok) return reject("sandbox-fail");
  if (evalRep.patchHash !== hashPatch(proposal)) return reject("stale-eval");
}
```

`hashPatch` is a small helper that canonical-stringifies the proposal's `patch | ruleMarkdown | skillManifest | memoryAdds`. Add it next to apply.

### CLI surface (cli/proposals.ts)

`apply` subcommand surfaces the rejection reason string in stderr and exits 1.

## Boundaries

- Touch: `src/learning/types.ts`, `src/learning/eval/pipeline.ts`, `src/learning/apply/index.ts`, `src/learning/store.ts` (new `setLastEval` / persistence), `src/cli/proposals.ts`, `test/learning/apply-regression-gate.test.ts` (new).
- Do not modify sandbox-replay internals (owned by T11.4).
- Do not change snapshot/rollback code paths.

## Verification

- `bun --cwd packages/coding-agent test test/learning` exit 0.
- `bun --cwd packages/coding-agent test test/cli/proposals.test.ts` exit 0.
- `bun run check:ts` exit 0.
