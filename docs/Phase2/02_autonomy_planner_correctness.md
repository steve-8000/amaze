# T11.2 — Autonomy planner correctness
> **Ticket**: T11.2
> **Phase**: P0
> **Status**: landed (2026-05-23)
> **Closing**: docs/Phase2/closing-report.md

## Current state (grounded)

`packages/coding-agent/src/autonomy/planner.ts:10-26` defines `BUILTIN_REMEDIATIONS` keyed by `force_complete_rate`, `verifier_bypass_rate`, `shell_criteria_bypass_rate`.

`packages/coding-agent/src/metrics/definitions.ts:13-132` registers metrics named `goal.completion.passRate`, `goal.forceCompleteRate`, `subagent.contractAdoption`, `subagent.revisionSuccess`, `subagent.noYieldRate`, `memory.hitPrecision`, `memory.staleRate`, `prompt.cacheChurn`, `cost.perAcceptedGoal`, `verifier.bypassRate`. No `shell_criteria_bypass_rate` exists.

`packages/coding-agent/src/autonomy/planner.ts:12-14`:
```
patch: { "goal.uncertainPolicy": "ask" },
rollback: { "goal.uncertainPolicy": "complete" },
```

`packages/coding-agent/src/config/settings-schema.ts` defines `goal.uncertainPolicy` as `'allow' | 'warn' | 'block-manual' | 'block-all'` (default `block-manual`). `"ask"` and `"complete"` are invalid.

## Acceptance

1. Every key in `BUILTIN_REMEDIATIONS` is a metric registered in `metricDefinitions` (exact-name match).
2. Every `patch`/`rollback` value in `BUILTIN_REMEDIATIONS` is a valid setting value per `settings-schema.ts`.
3. New test `packages/coding-agent/test/autonomy/planner-correctness.test.ts` enforces both invariants by introspecting both modules. Test runs in `test/autonomy` sweep.
4. New test `packages/coding-agent/test/autonomy/planner-emits-valid-proposal.test.ts` calls `planFromMetrics` for each remediation and asserts the resulting proposal's `patch` validates against the settings schema (use the runtime validator already present in `config/settings`).

## Implementation

### Rename map (BUILTIN_REMEDIATIONS keys → registered metric names)

```
force_complete_rate          → goal.forceCompleteRate
verifier_bypass_rate         → verifier.bypassRate
shell_criteria_bypass_rate   → (drop; no registered metric)
```

If a shell-criteria-bypass metric is desired in future, register it in `metrics/definitions.ts` first (out of scope for T11.2).

### Patch value map (settings-schema-correct)

```
goal.forceCompleteRate
  patch:    { "goal.uncertainPolicy": "block-manual" }
  rollback: { "goal.uncertainPolicy": "allow" }
```

Rationale: when force-complete rate is too high, **tighten** uncertain policy. The Phase1 default is already `block-manual`; the remediation is meaningful only when the user explicitly relaxed it to `allow` or `warn`. The planner SHOULD read the current value first and only emit a tightening remediation. Add that read in the planner.

```
verifier.bypassRate
  patch:    { "task.yield.allowSchemaBypass": false }
  rollback: { "task.yield.allowSchemaBypass": true }
```

(Already correct; key set is fine.)

Drop `shell_criteria_bypass_rate` remediation entirely until a backing metric exists.

### Planner change

```ts
const remediation = BUILTIN_REMEDIATIONS[mismatch.metric];
if (remediation) {
  // Suppress no-op remediations: skip if patch matches current settings.
  const currentSettings = readCurrentSettingsSnapshot();
  const meaningful = Object.entries(remediation.patch).some(
    ([k, v]) => currentSettings[k] !== v,
  );
  if (!meaningful) return null;
  return { ...base, type: "settings", patch: remediation.patch, ... };
}
```

`readCurrentSettingsSnapshot()` lives in `config/settings` (re-export if needed; do not duplicate).

## Boundaries

- Touch: `packages/coding-agent/src/autonomy/planner.ts`, `packages/coding-agent/test/autonomy/planner-correctness.test.ts` (new), `packages/coding-agent/test/autonomy/planner-emits-valid-proposal.test.ts` (new).
- Do not change `metrics/definitions.ts` or `settings-schema.ts`.
- Do not change planner's mismatch logic; only the remediation map and the no-op suppression.

## Verification

- `bun --cwd packages/coding-agent test test/autonomy` exit 0.
- `bun --cwd packages/coding-agent test test/autonomy/planner-correctness.test.ts test/autonomy/planner-emits-valid-proposal.test.ts` exit 0.
