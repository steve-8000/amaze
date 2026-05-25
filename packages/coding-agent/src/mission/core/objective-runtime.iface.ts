/**
 * Unified Objective runtime contract (consolidation target). TYPES ONLY.
 *
 * Today, "objective execution" is split across two runtimes:
 *   - ObjectiveRuntimeImpl (`goals/runtime.ts`) — the LIVE, per-turn, interactive single-objective
 *     controller. Owns turn hooks, token-budget accrual/steering, the acceptance verifier
 *     gate, scope, and prompt-block rendering. It is the actual hot-path owner.
 *   - MissionRuntime (`mission-runtime.iface.ts`) — the ORCHESTRATION state machine
 *     (create → classify → plan → execute → verify → complete). Currently observational.
 *
 * They are two execution MODES of one concept (an objective with budget, scope,
 * verification, and lifecycle). The end state is a single runtime that owns both. This
 * interface documents the LIVE-CONTROL surface that the canonical {@link MissionRuntime}
 * must absorb from ObjectiveRuntimeImpl, and composes them into one {@link ObjectiveRuntime}.
 *
 * State mapping between the two lifecycles lives in `compat.ts`
 * ({@link ./compat.goalStatusToLifecycle} / {@link ./compat.lifecycleToGoalStatus}).
 *
 * NOTE: the live-control surface is typed against the existing Goal types
 * (`GoalTokenUsage`, `GoalModeState`, `GoalBudgetSteering`) during the transition; a
 * later PR renames these to objective-native types once ObjectiveRuntimeImpl is deleted.
 */
import type { GoalBudgetSteering, GoalModeState, GoalTokenUsage } from "../../goals/state";
import type { MissionRuntime } from "./mission-runtime.iface";

/**
 * The live, per-turn execution-control surface — currently implemented by ObjectiveRuntimeImpl.
 * An objective in interactive mode accrues token usage per turn, can steer/limit on
 * budget, gates completion behind the acceptance verifier, and renders an active prompt
 * block into the system prompt's DYNAMIC_TAIL.
 */
export interface LiveObjectiveControl {
	/** Begin a turn: snapshot the baseline usage to compute this turn's delta. */
	onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void;

	/** A tool finished within the turn; flush accrued usage (steering allowed). */
	onToolCompleted(toolName: string): Promise<void>;

	/** The agent turn ended; flush remaining usage (steering suppressed by default). */
	onAgentEnd(options?: { turnCompleted?: boolean; currentUsage?: GoalTokenUsage }): Promise<void>;

	/** Flush accrued token usage into the objective budget, optionally steering. */
	flushUsage(steering: GoalBudgetSteering, currentUsage?: GoalTokenUsage): Promise<void>;

	/** Account usage produced outside the normal turn loop (e.g. subagent work). */
	addExternalUsage(delta: number): Promise<void>;

	/** Render the active-objective prompt block for the DYNAMIC_TAIL, or undefined. */
	buildActivePrompt(): string | undefined;
}

/**
 * Interactive lifecycle transitions — currently ObjectiveRuntimeImpl's create/resume/pause/drop/
 * complete/block surface. These drive a single objective through the human-in-the-loop
 * lifecycle, as opposed to MissionRuntime's autonomous plan→execute progression.
 */
export interface InteractiveObjectiveLifecycle {
	createObjective(input: { objective: string; tokenBudget?: number }): Promise<GoalModeState>;
	resumeObjective(): Promise<GoalModeState>;
	pauseObjective(): Promise<GoalModeState | undefined>;
	/** Drop (cancel) the active objective. */
	dropObjective(): Promise<void>;
}

/**
 * The unified Objective runtime: the autonomous orchestration progression
 * ({@link MissionRuntime}) PLUS the interactive live-control surface
 * ({@link LiveObjectiveControl} + {@link InteractiveObjectiveLifecycle}). The live-control
 * surface is served by {@link ObjectiveRuntimeImpl} (formerly GoalRuntime) via the
 * ObjectiveRuntimeAdapter; the orchestration surface by the MissionRuntime core.
 */
export interface ObjectiveRuntime extends MissionRuntime, LiveObjectiveControl, InteractiveObjectiveLifecycle {}
