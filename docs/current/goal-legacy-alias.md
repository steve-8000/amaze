# `/goal` → `/mission` Legacy Alias

> Post-refactor architecture. Paths are relative to
> `packages/coding-agent/src/` unless stated otherwise.

`/mission` is the canonical command surface for the mission runtime. `/goal`
remains as a **documented, behavior-preserving alias** for goal mode: it still
drives `GoalRuntime` through the session exactly as before. Only its help text
carries a deprecation note and the subcommand mapping; no goal behavior
changed.

Both commands are registered in `slash-commands/builtin-registry.ts`. `/goal`
dispatches to `ctx.handleGoalModeCommand(...)` (unchanged). `/mission`
dispatches via `slash-commands/helpers/mission-command.ts`.

## Subcommand mapping

| `/goal` | `/mission` equivalent | Notes |
| --- | --- | --- |
| `set <objective>` | `create <objective>` | Mission creation is still owned by goal mode; `/mission create` is a "not yet available" stub that points back here. |
| `show` | `show` | `/goal show` shows goal-mode state; `/mission show <id>` reads the mission view. |
| `drop` | `cancel` | |
| `complete` | `complete` | Closing acceptance verification is still goal-driven; `/mission complete` is a stub. |
| `block` | `block` | The `goal` tool's `op=block`; `MissionRuntime.block` is the canonical verb. |
| `pause` / `resume` / `budget` | — | Goal-mode session controls with no mission-runtime equivalent yet. |

## `/mission` subcommands

`create`, `show`, `stream`, `evidence`, `decision`, `verify`, `complete`,
`rollback`. The read-only inspection verbs (`show`, `stream`, `evidence`,
`decision`, `verify`, `rollback`) are backed by `cli/mission.ts` /
`MissionReadModel`. The mutating verbs (`create`, `complete`) return an explicit
"not yet available" stub directing the operator to the `/goal` alias, rather
than faking behavior, until a standalone mission write surface lands.

## Migration guidance

Prefer `/mission` for new workflows. `/goal` will keep working until goal mode
is folded fully into `MissionRuntime`; until then it is the only way to *start*
and *complete* an objective.
