/**
 * PR2 — ObjectiveRuntimeAdapter delegation parity.
 *
 * Proves the adapter is pure delegation: driving an objective through the unified
 * surface produces the same observable state/budget/prompt as driving ObjectiveRuntimeImpl
 * directly. This is what makes the flag-gated shadow/authority switch safe.
 */
import { describe, expect, it } from "bun:test";
import { type GoalRuntimeHost, ObjectiveRuntimeImpl, renderGoalBlock } from "../../src/goals/runtime";
import type { Goal, GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "../../src/goals/state";
import { ObjectiveRuntimeAdapter, renderObjectiveBlock } from "../../src/mission/core/objective-runtime-adapter";

function usage(o: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...o };
}

function createHarness() {
	let state: GoalModeState | undefined;
	let current = usage();
	let now = 0;
	const events: GoalRuntimeEvent[] = [];
	const host: GoalRuntimeHost = {
		getState: () => (state ? { ...state, goal: { ...state.goal } } : undefined),
		setState: next => {
			state = next ? { ...next, goal: { ...next.goal } } : undefined;
		},
		getCurrentUsage: () => ({ ...current }),
		emit: async event => {
			events.push(event);
		},
		persist: () => {},
		sendHiddenMessage: async () => {},
		now: () => now,
	};
	return {
		runtime: new ObjectiveRuntimeImpl(host),
		getState: () => state,
		setUsage: (u: Partial<GoalTokenUsage>) => {
			current = usage(u);
		},
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("ObjectiveRuntimeAdapter", () => {
	it("createObjective delegates to createGoal (objective becomes active)", async () => {
		const h = createHarness();
		const adapter = new ObjectiveRuntimeAdapter(h.runtime);
		const result = await adapter.createObjective({ objective: "Ship it", tokenBudget: 500 });
		expect(result.goal.status).toBe("active");
		expect(result.goal.objective).toBe("Ship it");
		expect(h.getState()?.goal.tokenBudget).toBe(500);
	});

	it("turn-hook + budget delegation accrues usage identically to ObjectiveRuntimeImpl", async () => {
		// Drive both a direct ObjectiveRuntimeImpl and an adapter-wrapped one with identical
		// inputs; assert the resulting tokensUsed matches.
		const direct = createHarness();
		await direct.runtime.createGoal({ objective: "obj", tokenBudget: 1000 });
		direct.runtime.onTurnStart("t1", usage());
		direct.setUsage({ input: 30, output: 10, cacheWrite: 5 });
		await direct.runtime.flushUsage("allowed");

		const viaAdapter = createHarness();
		const adapter = new ObjectiveRuntimeAdapter(viaAdapter.runtime);
		await adapter.createObjective({ objective: "obj", tokenBudget: 1000 });
		adapter.onTurnStart("t1", usage());
		viaAdapter.setUsage({ input: 30, output: 10, cacheWrite: 5 });
		await adapter.flushUsage("allowed");

		expect(viaAdapter.getState()?.goal.tokensUsed).toBe(direct.getState()?.goal.tokensUsed);
		expect(viaAdapter.getState()?.goal.tokensUsed).toBe(45);
	});

	it("buildActivePrompt returns the same bytes as the underlying ObjectiveRuntimeImpl", async () => {
		const h = createHarness();
		const adapter = new ObjectiveRuntimeAdapter(h.runtime);
		await adapter.createObjective({ objective: "Render parity", tokenBudget: 200 });
		expect(adapter.buildActivePrompt()).toBe(h.runtime.buildActivePrompt());
	});

	it("renderObjectiveBlock is byte-identical to renderGoalBlock (cache-stable rename)", () => {
		const goal: Goal = {
			id: "g",
			objective: "Ship <fast> & safely",
			status: "active",
			tokenBudget: 1000,
			tokensUsed: 250,
			timeUsedSeconds: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		expect(renderObjectiveBlock(null)).toBe(renderGoalBlock(null));
		expect(renderObjectiveBlock(goal)).toBe(renderGoalBlock(goal));
	});

	it("dropObjective resolves void and drops the goal", async () => {
		const h = createHarness();
		const adapter = new ObjectiveRuntimeAdapter(h.runtime);
		await adapter.createObjective({ objective: "to drop" });
		await expect(adapter.dropObjective()).resolves.toBeUndefined();
		expect(h.getState()?.goal.status === "dropped" || h.getState() === undefined).toBe(true);
	});
});
