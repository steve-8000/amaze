/**
 * ObjectiveRuntime adapter (Goal/Mission consolidation).
 *
 * Presents the proven, battle-tested {@link ObjectiveRuntimeImpl} engine (formerly
 * `GoalRuntime`) behind the canonical {@link LiveObjectiveControl} +
 * {@link InteractiveObjectiveLifecycle} surface, rather than rewriting its budget/verifier/
 * turn-hook logic. This is the strangler seam: the unified interface is the public surface
 * while the working engine stays. The live hot path drives objectives through this adapter,
 * whose methods delegate 1:1 to the engine, so behavior is identical to the parity corpus
 * (test/mission/objective-parity-corpus). The former `AMAZE_UNIFIED_OBJECTIVE` rollout flag
 * has been removed — this is now the only path.
 */
import type { ObjectiveRuntimeImpl } from "../../goals/runtime";
import { renderGoalBlock } from "../../goals/runtime";
import type { GoalBudgetSteering, GoalModeState, GoalTokenUsage } from "../../goals/state";
import type { InteractiveObjectiveLifecycle, LiveObjectiveControl } from "./objective-runtime.iface";

/**
 * Canonical name for the active-objective prompt block. Byte-identical alias of
 * `renderGoalBlock` so the DYNAMIC_TAIL stays cache-stable (locked by the parity corpus
 * snapshots). Callers should migrate to this name.
 */
export const renderObjectiveBlock = renderGoalBlock;

/**
 * Adapts a {@link ObjectiveRuntimeImpl} to the unified live-control + interactive-lifecycle
 * surface. Pure delegation — no behavior of its own — so shadow/authority runs match
 * ObjectiveRuntimeImpl exactly.
 */
export class ObjectiveRuntimeAdapter implements LiveObjectiveControl, InteractiveObjectiveLifecycle {
	readonly #goal: ObjectiveRuntimeImpl;

	constructor(goal: ObjectiveRuntimeImpl) {
		this.#goal = goal;
	}

	// --- LiveObjectiveControl ------------------------------------------------
	onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void {
		this.#goal.onTurnStart(turnId, baselineUsage);
	}

	onToolCompleted(toolName: string): Promise<void> {
		return this.#goal.onToolCompleted(toolName);
	}

	onAgentEnd(options?: { turnCompleted?: boolean; currentUsage?: GoalTokenUsage }): Promise<void> {
		return this.#goal.onAgentEnd(options);
	}

	flushUsage(steering: GoalBudgetSteering, currentUsage?: GoalTokenUsage): Promise<void> {
		return this.#goal.flushUsage(steering, currentUsage);
	}

	addExternalUsage(delta: number): Promise<void> {
		return this.#goal.addExternalUsage(delta);
	}

	buildActivePrompt(): string | undefined {
		return this.#goal.buildActivePrompt();
	}

	// --- InteractiveObjectiveLifecycle ---------------------------------------
	createObjective(input: { objective: string; tokenBudget?: number }): Promise<GoalModeState> {
		return this.#goal.createGoal(input);
	}

	resumeObjective(): Promise<GoalModeState> {
		return this.#goal.resumeGoal();
	}

	pauseObjective(): Promise<GoalModeState | undefined> {
		return this.#goal.pauseGoal();
	}

	async dropObjective(): Promise<void> {
		await this.#goal.dropGoal();
	}
}
