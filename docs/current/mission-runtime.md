# Mission Runtime

> Post-refactor architecture. Paths are relative to
> `packages/coding-agent/src/` unless stated otherwise.

## MissionRuntime is the execution owner

`mission/core/mission-runtime.ts` introduces `MissionRuntime` as the single
owner of mission execution. It exposes the canonical lifecycle verbs
(`mission/core/mission-runtime.iface.ts`):

| Verb | Signature |
| --- | --- |
| `classify` | `classify(missionId, options?)` |
| `plan` | `plan(missionId, options?)` |
| `execute` | `execute(missionId, options?)` |
| `verify` | `verify(missionId, options?)` |
| `complete` | `complete(missionId, options)` |
| `block` | `block(missionId, options)` |
| `cancel` | `cancel(missionId, options?)` |

It backs onto `MissionStore` (`mission/store.ts`, sqlite at the autonomy DB)
and emits lifecycle events through the `MissionEventBus`
(`mission/event-bus.ts`), which the JSONL sink (`mission/jsonl-sink.ts`)
persists as an append-only audit log.

Before this refactor there was no single execution owner: `GoalRuntime`
(`goals/runtime.ts`) owned goal-mode execution accounting, `MissionStore`
owned state, and `mission/runtime.ts` was only an event-bus + sink singleton.
`MissionRuntime` consolidates the execution-control role; `MissionTokenUsage`
mirrors `GoalTokenUsage` so the same provider counters feed either runtime
during the transition.

## Read surface

The read side is unchanged and remains side-effect free:

- `MissionReadModel` / `buildMissionView` (`mission/read-model.ts`)
- `MissionReader` (`mission/reader.ts`), `projectMissionView` (`mission/projection.ts`)
- consumed by `cli/mission.ts`, the SDK surface, and the mission-control TUI.

## CLI / slash surface

- `/mission` (canonical) — `slash-commands/builtin-registry.ts`, dispatching
  through `slash-commands/helpers/mission-command.ts` to the read-model verbs
  (`show`, `stream`, `evidence`, `decision`, `verify`, `rollback`). `create`
  and `complete` are stubbed: those mutations are still driven by goal mode and
  have no standalone mission write surface yet.
- `mission` CLI (`cli/mission.ts`) — read-only inspection used by both the
  process entrypoint and the `/mission` slash handler.
- `/goal` — the legacy alias; see `goal-legacy-alias.md`.
