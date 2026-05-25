import type { GoalBudgetSteering, GoalModeState, GoalTokenUsage } from "../../goals/state";
import type { RiskLevel } from "../../research/types";
import type { MissionIntent } from "../policy/intent";
import type { Mission, MissionLifecycleState, MissionPlan, MissionVerification } from "./mission";
import type { MissionInput } from "./mission-input";
import type { MissionOutcome } from "./mission-outcome";

/**
 * Runtime contract for the refactored mission core. TYPES ONLY — this module
 * intentionally contains no implementation. The concrete runtime is provided by
 * a later lane.
 *
 * Mirrors the operation surface described in the parallel workplan (§7): a
 * create -> classify -> plan -> execute -> verify -> complete progression plus
 * block/cancel transitions, an event emitter, and a getter.
 */

/** Result of classifying a mission's risk/mode. */
export interface MissionClassifyResult {
	riskLevel: RiskLevel;
	intent: MissionIntent;
	rationale?: string;
}

/** Options for {@link MissionRuntime.classify}. */
export interface MissionClassifyOptions {
	/** Override the model/heuristic used for classification. */
	classifier?: string;
}

/** Options for {@link MissionRuntime.plan}. */
export interface MissionPlanOptions {
	/** Maximum number of plan steps to produce. */
	maxSteps?: number;
}

/** Result of {@link MissionRuntime.plan}. */
export interface MissionPlanResult {
	plan: MissionPlan;
}

/** Options for {@link MissionRuntime.execute}. */
export interface MissionExecuteOptions {
	/** Restrict execution to a subset of task ids. */
	taskIds?: string[];
	/** Abort signal for cooperative cancellation. */
	signal?: AbortSignal;
}

/** Result of {@link MissionRuntime.execute}. */
export interface MissionExecuteResult {
	completedTaskIds: string[];
	failedTaskIds: string[];
	blocked: boolean;
}

/** Options for {@link MissionRuntime.verify}. */
export interface MissionVerifyOptions {
	/** Force a verdict even when verification is uncertain. */
	force?: boolean;
}

/** Result of {@link MissionRuntime.verify}. */
export interface MissionVerifyResult {
	verification: MissionVerification;
}

/** Options for {@link MissionRuntime.complete}. */
export interface MissionCompleteOptions {
	outcome: MissionOutcome;
}

/** Options for {@link MissionRuntime.block}. */
export interface MissionBlockOptions {
	reason: string;
	evidenceRefs?: string[];
}

/** Options for {@link MissionRuntime.cancel}. */
export interface MissionCancelOptions {
	reason?: string;
}

/** A lifecycle/event payload emitted by the runtime. */
export interface MissionRuntimeEvent {
	missionId: string;
	lifecycle: MissionLifecycleState;
	at: number;
	detail?: Record<string, unknown>;
}

/** Listener disposer returned by {@link MissionRuntime.emit}/subscribe paths. */
export type MissionEventUnsubscribe = () => void;

export interface LiveObjectiveControl {
	onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void;
	onToolCompleted(toolName: string): Promise<void>;
	onAgentEnd(options?: { turnCompleted?: boolean; currentUsage?: GoalTokenUsage }): Promise<void>;
	flushUsage(steering: GoalBudgetSteering, currentUsage?: GoalTokenUsage): Promise<void>;
	addExternalUsage(delta: number): Promise<void>;
	buildActivePrompt(): string | undefined;
}

export interface InteractiveObjectiveLifecycle {
	createObjective(input: { objective: string; tokenBudget?: number }): Promise<GoalModeState>;
	resumeObjective(): Promise<GoalModeState>;
	pauseObjective(): Promise<GoalModeState | undefined>;
	dropObjective(): Promise<void>;
}

/**
 * The mission runtime contract. Implementations own state transitions; this
 * interface only describes the operations and their option/result shapes.
 */
export interface MissionRuntime {
	/** Create a mission from caller input. */
	create(input: MissionInput): Promise<Mission>;

	/** Classify a mission's risk/mode, advancing it to `classified`. */
	classify(missionId: string, options?: MissionClassifyOptions): Promise<MissionClassifyResult>;

	/** Produce a plan, advancing the mission to/through `planning`. */
	plan(missionId: string, options?: MissionPlanOptions): Promise<MissionPlanResult>;

	/** Execute (some or all) tasks, advancing through `executing`. */
	execute(missionId: string, options?: MissionExecuteOptions): Promise<MissionExecuteResult>;

	/** Verify the mission outcome, advancing through `verifying`. */
	verify(missionId: string, options?: MissionVerifyOptions): Promise<MissionVerifyResult>;

	/** Complete the mission with a terminal outcome. */
	complete(missionId: string, options: MissionCompleteOptions): Promise<Mission>;

	/** Block the mission pending external input. */
	block(missionId: string, options: MissionBlockOptions): Promise<Mission>;

	/** Cancel the mission. */
	cancel(missionId: string, options?: MissionCancelOptions): Promise<Mission>;

	/** Emit a runtime event (and/or subscribe; returns an unsubscribe handle). */
	emit(event: MissionRuntimeEvent): MissionEventUnsubscribe | undefined;

	/** Fetch the current mission aggregate. */
	get(missionId: string): Promise<Mission | undefined>;
}

export interface ObjectiveRuntime extends MissionRuntime, LiveObjectiveControl, InteractiveObjectiveLifecycle {}
