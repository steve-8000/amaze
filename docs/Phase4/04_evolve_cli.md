# T4.4 Evolve CLI

> **Ticket**: T4.4
> **Phase**: P2
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase4/closing-report.md

## Intent

`amaze evolve` is the operator control plane for the autonomy + learning loop. It groups objective visibility, proposal review, proposal mutation, simulation, and guardrail health checks under one command family.

## Subcommands

The registered actions are:

1. `status`
2. `objectives`
3. `preview`
4. `proposals`
5. `inspect`
6. `approve`
7. `apply`
8. `rollback`
9. `simulate`
10. `doctor`

## Delegation map

| Action | Delegate |
|---|---|
| `status` | `runEvolveStatusCommand` |
| `objectives` | `runObjectiveListCommand` |
| `preview` | `runObjectivePreviewCommand` |
| `proposals` | `runProposalsListCommand` |
| `inspect` | `runProposalsShowCommand` |
| `approve` | `runProposalsApproveCommand` |
| `apply` | `runProposalsApplyCommand` |
| `rollback` | `runProposalsRollbackCommand` |
| `simulate` | `runEvolveSimulateCommand` |
| `doctor` | `runEvolveDoctorCommand` |

`evolve` is a thin router and adds no new mutation logic. Mutating actions continue to run through the existing proposal apply, approve, and rollback surfaces.

## Verification

`packages/coding-agent/test/cli/evolve.test.ts` covers fresh-HOME `status`, help action listing, `doctor`, `objectives`, and the `preview` usage error path. The targeted Phase4 sweep also runs the existing objective and proposal-adjacent tests to keep delegated surfaces covered.
