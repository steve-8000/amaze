/**
 * ObjectiveRuntimeImpl canonical mission-core surface.
 */
import { describe, expect, it } from "bun:test";
import type { Goal, GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "../../src/goals/state";
import {
	type GoalRuntimeHost,
	ObjectiveRuntimeImpl,
	renderGoalBlock,
	renderGoalPrompt,
	renderObjectiveBlock,
} from "../../src/mission/core/objective-runtime";

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

describe("ObjectiveRuntimeImpl", () => {
	it("createObjective activates an objective", async () => {
		const h = createHarness();
		const result = await h.runtime.createObjective({ objective: "Ship it", tokenBudget: 500 });
		expect(result.goal.status).toBe("active");
		expect(result.goal.objective).toBe("Ship it");
		expect(h.getState()?.goal.tokenBudget).toBe(500);
	});

	it("turn-hook + budget accounting accrues usage", async () => {
		const h = createHarness();
		await h.runtime.createObjective({ objective: "obj", tokenBudget: 1000 });
		h.runtime.onTurnStart("t1", usage());
		h.setUsage({ input: 30, output: 10, cacheWrite: 5 });
		await h.runtime.flushUsage("allowed");

		expect(h.getState()?.goal.tokensUsed).toBe(45);
	});

	it("buildActivePrompt renders active objective bytes", async () => {
		const h = createHarness();
		await h.runtime.createObjective({ objective: "Render parity", tokenBudget: 200 });
		expect(h.runtime.buildActivePrompt()).toBe(renderGoalPrompt("active", h.getState()!.goal));
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
		await h.runtime.createObjective({ objective: "to drop" });
		await expect(h.runtime.dropObjective()).resolves.toBeUndefined();
		expect(h.getState()?.goal.status === "dropped" || h.getState() === undefined).toBe(true);
	});
});
