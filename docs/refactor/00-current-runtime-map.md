# 00 — Current Runtime Map (`packages/coding-agent/src`)

> Lane E / Phase 0 baseline. Docs-only. Every claim is grounded in a real
> `file:line` reference from the tree as of 2026-05-24. All paths are relative to
> `packages/coding-agent/src/` unless stated otherwise.

This maps **how a goal / mission flows today**, before the `goal → mission`
consolidation. The two systems run as **parallel paths** that touch at exactly
one seam (goal completion dual-writes a mission verification). There is no single
"execution owner" yet — `GoalRuntime` owns goal-mode execution accounting;
`MissionStore` owns mission state; `mission/runtime.ts` is only an event-bus +
JSONL sink singleton (not an execution owner).

---

## 1. Two runtimes, one seam

```
                        ┌─────────────────────────────────────────────┐
   user `/goal set`     │              GOAL PATH (live)               │
   (interactive)        │                                             │
        │               │   GoalTool (goals/tools/goal-tool.ts)       │
        ▼               │        │  op = get|complete|block            │
  GoalTool.execute ─────┼────────┤                                    │
                        │        ▼                                    │
                        │   GoalRuntime (goals/runtime.ts:364)        │
                        │   - createGoal / resumeGoal / pauseGoal     │
                        │   - dropGoal / completeGoalFromTool         │
                        │   - blockGoalFromTool / updateGoal          │
                        │   - flushUsage / addExternalUsage (budget)  │
                        │   - captureDesignAnswers                    │
                        │        │ host = AgentSession                │
                        │        ▼                                    │
                        │   GoalModeState (goals/state.ts)            │
                        │   persisted in session log via host.persist │
                        │   rendered to prompt via renderGoalBlock    │
                        └───────────────┬─────────────────────────────┘
                                        │ completeGoalFromTool()
                                        │ runs AcceptanceVerifier
                                        │ then calls ↓ (THE SEAM)
                                        ▼
              recordMissionVerificationFromGoalObjective (goals/runtime.ts:33)
                                        │ new MissionStore(dbPath)
                                        │ resolveMission({missionId})
                                        │ store.recordVerification + updateMission
                                        ▼
                        ┌─────────────────────────────────────────────┐
                        │            MISSION PATH (record)            │
                        │                                             │
                        │   MissionStore (mission/store.ts:175)       │
                        │   sqlite @ ~/.amaze/autonomy/autonomy.db    │
                        │   tables: missions, lane_runs, contracts,   │
                        │   verifications, task_attempt_checkpoints,  │
                        │   critic_dialogue, world_model, rollbacks,  │
                        │   research_runs                             │
                        │        │ emits on writes                    │
                        │        ▼                                    │
                        │   MissionEventBus (mission/event-bus.ts)    │
                        │     ← singleton from mission/runtime.ts:27  │
                        │        │                                    │
                        │        ▼                                    │
                        │   MissionJsonlSink (mission/jsonl-sink.ts)  │
                        │   single append-only audit log (JSONL)      │
                        └───────────────┬─────────────────────────────┘
                                        │ read side (no writes)
                                        ▼
                  MissionReader (reader.ts) → projectMissionView (projection.ts)
                            → MissionReadModel / buildMissionView (read-model.ts)
                            → consumed by cli/mission.ts, sdk.ts:482,
                              modes/components/mission-control-view.ts
```

The mission research/contract path is **also driven independently** by the
`task` tool and `research/store.ts`, not just by the goal seam — see §5.

---

## 2. CLI entrypoints (`cli/`)

| Entry | File:line | Role |
| --- | --- | --- |
| `/goal` slash subcommand | dispatched via `slash-commands/builtin-registry.ts`; handled in `modes/interactive-mode.ts` (e.g. `:1880`, `:2048`) | `set / show / pause / resume / drop / budget` → drives `GoalRuntime` through `AgentSession` |
| `goal` tool | `goals/tools/goal-tool.ts:60` (`GoalTool`) | model-callable; ops `get / complete / block` (`:86`,`:89`,`:93`) |
| `mission` CLI | `cli/mission.ts` | read-only inspection: builds `MissionReadModel` (`:23`,`:71`,`:210`) |
| `objective` CLI | `cli/objective.ts` | objective CRUD (`runObjective*Command`, `:46`+), feeds `objectiveId` into missions |
| `research` CLI | `cli/research.ts:73` | constructs `MissionStore(opts.db)` for research runs |
| `proposals` CLI | `cli/proposals.ts:142`,`:162` | constructs `MissionStore(store.dbPath)` |
| SDK surface | `sdk.ts:482` | exposes `MissionReadModel`; also re-exports tool classes (`:124`+) |

`main.ts` / `cli.ts` are the process entrypoints that fan out to the above.

---

## 3. `goals/` runtime internals

| File | Lines | Key exports / responsibility |
| --- | --- | --- |
| `goals/runtime.ts` | 988 | `GoalRuntime` class (`:364`), `recordMissionVerificationFromGoalObjective` (`:33`, the mission seam), `renderGoalBlock` (`:256`), `renderGoalPrompt` (`:298`), `goalTokenDelta` (`:284`), `GoalAcceptanceFailureError` (`:134`), `GoalRuntimeHost` iface (`:147`). **Owns execution-control logic**: budget accounting, state transitions, closing-audit verification. |
| `goals/state.ts` | 98 | `Goal`, `GoalModeState`, `GoalStatus`, `GoalDesignAnswers`, `GoalToolDetails`, `GoalRuntimeEvent`, `GoalTokenUsage`. `Goal.missionId` (`:22`) is the linkage field. |
| `goals/verifier.ts` | 756 | `AcceptanceVerifier`, `AcceptanceCriterion`, `summarize`, `VerificationContext`, `VerificationVerdict`, `defaultBlockingPolicy`. Closing-audit engine. |
| `goals/llm-judge.ts` | — | LLM-judged criteria backend for the verifier. |
| `goals/telemetry.ts` | 161 | force-rate / verdict telemetry emission. |
| `goals/tools/goal-tool.ts` | 273 | `GoalTool` (model surface), `goalToolRenderer`. |
| `goals/index.ts` | 3 | re-exports `./tools/goal-tool`. |

`GoalRuntime` is instantiated exactly once, in `session/agent-session.ts:1133`,
with `AgentSession` as the `GoalRuntimeHost`. Per-turn hooks fire from the agent
loop:

- `onTurnStart` — `agent-session.ts:1479`
- `onToolCompleted` / `onGoalToolCompleted` — `:1525` / `:1523`
- `onAgentEnd` — `:1784`
- `onTaskAborted` — `:4819`
- `buildActivePrompt` — `:3951`

External (subagent) token usage is rolled into the goal budget via
`addExternalUsage`, called from `task/index.ts:1553`.

---

## 4. `mission/` internals

| File | Lines | Key exports / responsibility |
| --- | --- | --- |
| `mission/store.ts` | 1245 | `MissionStore` class (`:175`) + `resolveMission` (`:1001`). The real backing store: sqlite at `DEFAULT_DB_PATH` (`:49`). CRUD for missions, lane runs, contracts, verifications, task-attempt checkpoints, critic dialogue, world-model, rollbacks, research runs. Emits `MissionEvent`s on writes. |
| `mission/types.ts` | 229 | `Mission`, `MissionState` (12 states, `:3`), `NewMission`, `MissionContractRecord`, `MissionVerificationRecord`, `MissionTaskAttemptCheckpoint`, `MissionRollbackRecord`, `MissionCriticDialogueTurn`, `MissionWorldModelRecord`, `MissionLaneRun`, `ResearchRun`, `MissionPolicyGuidance`, plus `EPISTEMIC_ROLES` etc. |
| `mission/runtime.ts` | 39 | `initializeMissionRuntime` (`:19`), `getMissionEventBus` (`:27`), `getMissionJsonlSink` (`:31`), `closeMissionRuntime` (`:35`). **Thin singleton — NOT an execution owner.** Holds `{ bus, sink }`. |
| `mission/event-bus.ts` | 50 | `MissionEventBus`. |
| `mission/events.ts` | 129 | `MissionEvent` union (`:117`) — research/contract/verification/rollback/critic events. **No goal-style lifecycle events yet** (`created/classified/planned/...` are absent → Lane B's job). |
| `mission/jsonl-sink.ts` | — | `MissionJsonlSink` — single append-only audit log. |
| `mission/reader.ts` | 51 | `MissionReader` — read-only DB access. |
| `mission/projection.ts` | 63 | `projectMissionView` (`:31`), `MissionProjectionView` (`:22`). |
| `mission/read-model.ts` | 370 | `MissionReadModel` class (`:252`), `buildMissionView` (`:90`), `deriveMissionPolicyGuidance` (`:208`), `MissionView`. Constructs its own `MissionStore` (`:259`). |
| `mission/context-packet.ts` | 125 | `MissionContextPacket` assembly (target for Lane G context-budget + Lane J memory recall). |

`initializeMissionRuntime()` is called once from
`modes/interactive-mode.ts:358`; the singleton bus is consumed by
`mission-control-view.ts:30` and lazily by `MissionStore`
(`store.ts:189`) / `research/store.ts:151`.

---

## 5. `task/` and `subagent/` — how missions get their evidence

`task/index.ts` is the second (independent) writer into the mission DB:

- `recordTaskMissionContract` (`task/index.ts:89`) → `store.recordContract`, called from `:1161`, `:1322`.
- `recordTaskAttemptCheckpoint` (private, `:173`) → `store.recordTaskAttemptCheckpoint`, called from `:1226`, `:1389`.
- `evaluateRuntimeCriticGate` (`:248`) reads via `MissionStore` (`:255`), called from `:958`.
- `MissionStore` constructed at `:96`, `:185`, `:255`.

`task/executor.ts` runs subagents; `task/subprocess-tool-registry.ts:85`
(`subprocessToolRegistry`) is the in-subprocess tool dispatch table.
`subagent/contract.ts` defines `SubagentContract` (`:29`), scope enforcement
(`enforceContractScope` `:380`, `enforceContractFreshness` `:228`), and stale
detection (`isSubagentContractStale` `:270`). `subagent/mutation-scope.ts`
guards mutations. **`missionId` / `taskId` are not yet mandatory on the subagent
contract** — that is Lane I's binding work.

---

## 6. `tools/` (≈74 files, flat layout)

Tools are registered through `tools/index.ts` (`BUILTIN_TOOLS` map `:311`+,
`DEFAULT_ESSENTIAL_TOOL_NAMES` `:285`) and dispatched by the agent loop in
`session/agent-session.ts` via `target.execute(...)` (`:3193`, `:3205`, `:3262`).
There is **no gateway** between the model's tool call and the tool's `execute()` —
this is what Lane C1/H introduce. See `02-tool-call-sites.md`.

## 7. `memory-backend/` and `nexus/`

`resolveMemoryBackend(settings)` (`memory-backend/resolve.ts`) returns exactly one
of `NexusBackend` (`memory-backend/nexus-backend.ts`) or `OffBackend`. Nexus is
the durable memory store (sqlite via `NexusStore`, `nexus/store.ts:361`). Memory
is **guidance, not authority** — see `03-memory-call-sites.md` and the explicit
string at `nexus-backend.ts:125`.

---

## 8. End-to-end: a goal-mode session today

1. User runs `/goal set <objective>` → `interactive-mode.ts` → `GoalRuntime.createGoal` (`runtime.ts:607`) → `GoalModeState` persisted, `goal.start` session event emitted (`:631`).
2. Each turn: `onTurnStart` snapshots baseline usage (`:453`); after each tool, `flushUsage` rolls token+wall-clock delta into `goal.tokensUsed` (`:554`).
3. Subagent work (via `task`) pushes its cost back through `addExternalUsage` (`task/index.ts:1553` → `runtime.ts:829`) and records mission contracts/checkpoints into `MissionStore`.
4. Model calls `goal` tool with `op=complete` → `GoalTool.execute` → `completeGoalFromTool` (`:713`) runs `AcceptanceVerifier`; on `fail` throws `GoalAcceptanceFailureError`.
5. On pass/force, status flips to `complete` and **the seam fires**: `recordMissionVerificationFromGoalObjective` (`:773`) writes a `mission_verifications` row + flips mission state, which emits `verification.completed` to the JSONL audit log.
6. Read side (`MissionReadModel`) surfaces the mission to `cli/mission.ts` / mission-control TUI.

The goal path never *creates* a mission — it only resolves an existing one by
`missionId`/title and records verification. Mission creation happens through the
research/task path (`MissionStore.createMission`). Closing this gap (goal →
mission.created) is Lane F.
