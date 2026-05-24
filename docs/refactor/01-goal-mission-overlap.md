# 01 — Goal ↔ Mission Overlap

> Lane E / Phase 0. Concrete overlap between `goals/runtime.ts` (`GoalRuntime`)
> and `mission/store.ts` (`MissionStore`) + `mission/types.ts`. Grounded in real
> symbols. Paths relative to `packages/coding-agent/src/`.

The headline (matches workplan §0): **`goals/runtime.ts` already imports
`mission/store`** and dual-writes mission verification on goal completion. The
consolidation is therefore a **promotion** (move execution ownership into the
mission runtime), not a greenfield adapter.

---

## 1. The existing linkage (proof)

| Linkage | file:line |
| --- | --- |
| `import { MissionStore, resolveMission } from "../mission/store";` | `goals/runtime.ts:3` |
| `recordMissionVerificationFromGoalObjective(...)` definition | `goals/runtime.ts:33` |
| — instantiates `new MissionStore(args.dbPath)` | `goals/runtime.ts:40` |
| — calls `resolveMission(store, { missionId })` | `goals/runtime.ts:42` |
| — calls `store.recordVerification(...)` then `store.updateMission(..., { state })` | `goals/runtime.ts:45`, `:52` |
| `Goal.missionId?: string \| null` linkage field | `goals/state.ts:22` |
| seam invoked from `completeGoalFromTool` | `goals/runtime.ts:773` |
| goal created with `missionId: undefined` (never auto-creates a mission) | `goals/runtime.ts:620` |

`recordMissionVerificationFromGoalObjective` is the **only** point where the goal
path mutates the mission store. State mapping it performs (`runtime.ts:52-59`):
`pass`/`force` → `completed`; `uncertain>0 && failed==0` → `verifying`; else →
`blocked`.

---

## 2. `GoalRuntime` public surface (`goals/runtime.ts:364`)

| Method | line | Category |
| --- | --- | --- |
| `get snapshot` | `:376` | accounting state |
| `onTurnStart` | `:453` | **execution control** (budget) |
| `onToolCompleted` / `onGoalToolCompleted` | `:464` / `:470` | **execution control** (budget) |
| `onAgentEnd` | `:475` | **execution control** (budget) |
| `onTaskAborted` | `:484` | **execution control** (lifecycle: pause-on-interrupt) |
| `onThreadResumed` | `:507` | **execution control** (state normalization) |
| `onBudgetMutated` | `:530` | **execution control** (budget) |
| `flushUsage` | `:600` | **execution control** (budget accounting) |
| `createGoal` | `:607` | **lifecycle** (≈ mission.created) |
| `resumeGoal` | `:643` | **lifecycle** |
| `pauseGoal` | `:660` | **lifecycle** |
| `dropGoal` | `:679` | **lifecycle** (≈ mission.cancelled) |
| `completeGoalFromTool` | `:713` | **lifecycle + verification** (≈ mission.verify/completed) |
| `blockGoalFromTool` | `:794` | **lifecycle** (≈ mission.blocked) |
| `addExternalUsage` | `:829` | **execution control** (cross-session budget) |
| `updateGoal` | `:860` | **lifecycle** (mid-flight pivot) |
| `captureDesignAnswers` | `:952` | contract capture |
| `buildActivePrompt` / `buildContinuationPrompt` | `:965` / `:972` | prompt rendering |

Free functions in the same file relevant to promotion: `renderGoalBlock` (`:256`,
**must be preserved** per §7.5), `renderGoalPrompt` (`:298`), `goalTokenDelta`
(`:284`), `GoalAcceptanceFailureError` (`:134`),
`recordMissionVerificationFromGoalObjective` (`:33`).

---

## 3. `MissionStore` public surface (`mission/store.ts:175`)

Persistence-only; no execution control, no budget, no prompt rendering.

| Method | line | Notes |
| --- | --- | --- |
| `createMission` | `:197` | emits nothing today |
| `getMission` / `listMissions` / `getPreferredMission` | `:232` / `:237` / `:260` | reads |
| `findLatestMissionBy{ObjectiveId,BriefId,Title}` | `:290` / `:297` / `:304` | reads (used by `resolveMission`) |
| `updateMission` | `:311` | state/confidence/decision patch |
| `createLaneRun` / `updateLaneRun` / `listLaneRuns` ... | `:355` / `:802` / `:398` | research lanes; `updateLaneRun` emits `research.lane.completed` |
| `createResearchRun` / `updateResearchRun` / `get/list*` | `:419` / `:484` | research runs |
| `recordContract` / `listContracts` | `:504` / `:550` | emits `contract.created` |
| `recordVerification` / `getLatestVerification` | `:557` / `:592` | emits `verification.completed` ← **goal seam target** |
| `recordTaskAttemptCheckpoint` / list / getLatest | `:599` / `:637` / `:644` | task-attempt audit |
| `recordCriticDialogueTurn` / `recordCriticDialogueExchange` / list | `:653` / `:680` / `:713` | emits `runtime_critic.dialogue.completed` |
| `recordWorldModel` / `listWorldModel` | `:720` / `:753` | world-model graph |
| `recordRollback` / `listRollbacks` | `:760` / `:795` | emits `rollback.snapshot.created` |
| top-level `resolveMission(store, lookup)` | `:1001` | id→objectiveId→title resolution |

`mission/types.ts` types most relevant to the merge: `Mission` (`:35`),
`MissionState` (12 states incl. `executing`/`verifying`/`completed`/`blocked`/
`cancelled`/`rolled_back`, `:3`), `MissionVerificationRecord` (`:143`),
`MissionContractRecord` (`:85`), `MissionTaskAttemptCheckpoint` (`:110`),
`MissionPolicyGuidance` (`:222`).

---

## 4. Overlap / concept mapping

| Goal concept (`goals/`) | Mission concept (`mission/`) | Gap |
| --- | --- | --- |
| `Goal.status` (`active/paused/budget-limited/blocked/complete/dropped`, `state.ts:4`) | `MissionState` (12 states, `types.ts:3`) | goal `dropped` ≈ mission `cancelled`; goal `complete` ≈ mission `completed`; goal has no `executing`/`verifying`/`contracted` granularity |
| `Goal.objective` | `Mission.title` (`types.ts:36`) | mission has no free-form objective; resolution is by title (`store.ts:1013`) |
| `Goal.tokenBudget` / `tokensUsed` / `timeUsedSeconds` (`state.ts`) | — none — | **mission has no budget/accounting columns**; budget lives only in `GoalRuntime` |
| `Goal.acceptanceCriteria` (`state.ts:48`) + `AcceptanceVerifier` (`verifier.ts`) | `MissionVerificationRecord` (result only, `types.ts:143`) | mission stores the *verdict*, not the criteria or the verifier |
| `Goal.scopeGuard` (`state.ts:62`) | `MissionContractRecord.{include,exclude}` (`types.ts:90`) | parallel scope models, not unified |
| `Goal.designAnswers` (`state.ts:38`) | `MissionContractRecord.successCriteria` (`types.ts:92`) | partial overlap |
| `Goal.contractRevision` (`state.ts:74`) | `MissionContractRecord.parentContractRevision` (`types.ts:89`) | already aligned in spirit |
| `createGoal` (`runtime.ts:607`) | `createMission` (`store.ts:197`) | **goal never calls createMission** → no `mission.created` on goal entry |
| `completeGoalFromTool` verification (`runtime.ts:713`) | `recordVerification` (`store.ts:557`) | only this is wired (the seam) |

---

## 5. Execution-control logic that must migrate to MissionRuntime

`mission/runtime.ts` (39 lines) is just an event-bus/sink singleton — it owns no
execution. The following logic currently lives in `GoalRuntime` and is what
Lane C2 must promote into a real `MissionRuntime`:

1. **Budget accounting & enforcement** — `#flushUsageLocked` (`runtime.ts:554`),
   `flushUsage` (`:600`), `addExternalUsage` (`:829`), `goalTokenDelta` (`:284`),
   the `#withAccounting` serialization queue (`:403`), turn/wall-clock snapshots
   (`#turnSnapshot`, `#wallClock`). Mission types have **no budget fields** — the
   migration needs `MissionBudget` (Lane A) + budget columns or a side table.
2. **State-transition ownership** — `createGoal` (`:607`), `resumeGoal` (`:643`),
   `pauseGoal` (`:660`), `dropGoal` (`:679`), `blockGoalFromTool` (`:794`),
   `completeGoalFromTool` (`:713`). These mutate `GoalModeState` and persist via
   the host; the mission DB only learns about completion (the seam).
3. **Closing-audit verification gate** — `completeGoalFromTool` runs
   `AcceptanceVerifier` (`runtime.ts:745`) BEFORE the status flip, throwing
   `GoalAcceptanceFailureError` (`:759`). This *blocking* behavior (workplan: "Verifier
   동작 동일 유지") must be preserved when ownership moves.
4. **Lifecycle/interrupt handling** — `onTaskAborted` pause-on-interrupt
   (`:484`), `onThreadResumed` normalization (`:507`).
5. **Mid-flight pivot** — `updateGoal` (`:860`) merges objective/budget/criteria/
   scopeGuard and bumps `contractRevision`.

**Stays in the goal layer (do not migrate, per §7.4–7.5):** `renderGoalBlock`
(`:256`), `renderGoalPrompt` (`:298`), `GoalRuntimeHost` glue to `AgentSession`,
`captureDesignAnswers`. `renderMissionBlock` is added *in parallel* (Lane F), not
as a replacement.

---

## 6. Migration ordering implication

Because `goals/runtime.ts` is the write owner for goal state AND already the
mission-verification writer, two lanes touch this file: **F** (adapter expansion)
and **L** (thin-wrapper reduction). §1.2/§7 require **L after F + C2 + K merge**.
The seam at `runtime.ts:773` is the natural extension point for Lane F's full
dual-write (`mission.created` on `createGoal`, `mission.blocked` on
`blockGoalFromTool`, `mission.cancelled` on `dropGoal`).
