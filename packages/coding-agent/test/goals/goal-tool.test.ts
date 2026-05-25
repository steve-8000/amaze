import { describe, expect, it, vi } from "bun:test";
import { validateToolArguments } from "@amaze/ai";
import { convertOpenAICodexResponsesTools } from "@amaze/ai/providers/openai-codex-responses";
import type { Model, ToolCall } from "@amaze/ai/types";
import { completionBudgetReport, ObjectiveRuntimeImpl } from "@amaze/coding-agent/goals/runtime";
import type { Goal, GoalModeState, GoalTokenUsage } from "@amaze/coding-agent/goals/state";
import { GoalTool } from "@amaze/coding-agent/goals/tools/goal-tool";
import type { ToolSession } from "@amaze/coding-agent/tools";

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		...overrides,
	};
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		objective: "Ship it",
		status: "active",
		tokenBudget: undefined,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
	return state ? { ...state, goal: { ...state.goal } } : undefined;
}

function createToolSession(overrides: Partial<ToolSession>): ToolSession {
	return overrides as ToolSession;
}

function createRuntimeHarness(initialState?: GoalModeState) {
	let state = cloneState(initialState);
	const runtime = new ObjectiveRuntimeImpl({
		getState: () => cloneState(state),
		setState: next => {
			state = cloneState(next);
		},
		getCurrentUsage: () => createUsage(),
		emit: async () => {},
		persist: (_mode, _state) => {},
		sendHiddenMessage: async _message => {},
		now: () => 0,
	});
	return {
		runtime,
		getState: () => cloneState(state),
	};
}

describe("GoalTool", () => {
	it("routes get/complete/block operations and returns completion budget details", async () => {
		const getGoalState: GoalModeState = {
			enabled: true,
			mode: "active",
			goal: createGoal({ objective: "Get route", tokensUsed: 4, tokenBudget: 10 }),
		};
		const completedGoal = createGoal({
			objective: "Complete route",
			status: "complete",
			tokensUsed: 7,
			timeUsedSeconds: 3,
			tokenBudget: 10,
		});
		const blockedGoal = createGoal({
			objective: "Blocked route",
			status: "blocked",
			tokensUsed: 6,
			tokenBudget: 10,
		});
		const runtime = {
			completeGoalFromTool: vi.fn(async () => ({ goal: completedGoal })),
			blockGoalFromTool: vi.fn(async () => blockedGoal),
		};
		const getGoalModeState = vi.fn(() => getGoalState);
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => runtime as unknown as ObjectiveRuntimeImpl,
				getGoalModeState,
			}),
		);

		const fetched = await tool.execute("call-get", { op: "get" });
		expect(getGoalModeState).toHaveBeenCalledTimes(1);
		expect(fetched.details).toMatchObject({
			op: "get",
			goal: getGoalState.goal,
			remainingTokens: 6,
			completionBudgetReport: null,
		});
		expect(runtime.completeGoalFromTool).not.toHaveBeenCalled();

		const completed = await tool.execute("call-complete", { op: "complete", goal_id: "goal-1" });
		expect(runtime.completeGoalFromTool).toHaveBeenCalledWith({ expectedGoalId: "goal-1" });
		expect(completed.details).toMatchObject({
			op: "complete",
			goal: completedGoal,
			remainingTokens: 3,
			completionBudgetReport: completionBudgetReport(completedGoal),
		});
		expect(completed.content[0]).toEqual({
			type: "text",
			text: "Goal: Complete route\nStatus: complete\nTokens: 7 used / 10 budget\nRemaining tokens: 3\n\nGoal achieved. Report final budget usage to the user: tokens used: 7 of 10; time used: 3 seconds.",
		});

		const blocked = await tool.execute("call-block", { op: "block", goal_id: "goal-1" });
		expect(runtime.blockGoalFromTool).toHaveBeenCalledWith({ expectedGoalId: "goal-1" });
		expect(blocked.details).toMatchObject({
			op: "block",
			goal: blockedGoal,
			remainingTokens: 4,
			completionBudgetReport: null,
		});
	});

	it("exposes a Codex-compatible object root schema without root combinators", () => {
		const tool = new GoalTool(createToolSession({}));
		const [payload] = convertOpenAICodexResponsesTools([tool], {
			id: "gpt-5.1-codex",
		} as Model<"openai-codex-responses">);

		expect(payload?.type).toBe("function");
		if (!payload || payload.type !== "function") throw new Error("expected function tool payload");
		expect(payload.parameters.type).toBe("object");
		expect(payload.parameters).not.toHaveProperty("anyOf");
		expect(payload.parameters).not.toHaveProperty("oneOf");
	});

	it("rejects mutation operations without goal_id before execution reaches the runtime", async () => {
		const runtime = {
			completeGoalFromTool: vi.fn(),
			blockGoalFromTool: vi.fn(),
		};
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => runtime as unknown as ObjectiveRuntimeImpl,
			}),
		);

		expect(tool.parameters.safeParse({ op: "get" }).success).toBe(true);
		expect(tool.parameters.safeParse({ op: "complete" }).success).toBe(false);
		expect(tool.parameters.safeParse({ op: "block" }).success).toBe(false);
		expect(tool.parameters.safeParse({ op: "complete", goal_id: "" }).success).toBe(false);
		expect(
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call-get",
				name: "goal",
				arguments: { op: "get", goal_id: null },
			} as ToolCall),
		).toEqual({ op: "get" });
		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call-complete",
				name: "goal",
				arguments: { op: "complete", goal_id: null },
			} as ToolCall),
		).toThrow("goal_id is required for complete and block operations.");
		await expect(tool.execute("call-complete", { op: "complete" } as never)).rejects.toThrow(
			"goal_id is required for complete operations.",
		);
		await expect(tool.execute("call-block", { op: "block" } as never)).rejects.toThrow(
			"goal_id is required for block operations.",
		);
		expect(runtime.completeGoalFromTool).not.toHaveBeenCalled();
		expect(runtime.blockGoalFromTool).not.toHaveBeenCalled();
	});

	it("rejects unsupported model-facing mutation operations", async () => {
		const harness = createRuntimeHarness({
			enabled: true,
			mode: "active",
			goal: createGoal({ objective: "Existing" }),
		});
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(
			tool.execute("call-create", { op: "create", objective: "New goal", token_budget: 10 } as never),
		).rejects.toThrow("Unsupported goal operation: create");
		await expect(tool.execute("call-update", { op: "update", objective: "Different goal" } as never)).rejects.toThrow(
			"Unsupported goal operation: update",
		);
	});

	it("rejects complete when no goal is active", async () => {
		const harness = createRuntimeHarness();
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(tool.execute("call-complete", { op: "complete", goal_id: "goal-1" })).rejects.toThrow(
			"cannot complete goal because goal mode is not active",
		);
	});

	it("rejects complete when the tool call references a stale goal id", async () => {
		const harness = createRuntimeHarness();
		await harness.runtime.createGoal({ objective: "Ship the release", tokenBudget: 100 });
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		await expect(tool.execute("call-complete", { op: "complete", goal_id: "old-goal" })).rejects.toThrow(
			"stale goal completion rejected because the active goal changed",
		);
		expect(harness.getState()?.goal.status).toBe("active");
	});

	it("marks the goal blocked and disables model-facing goal mode", async () => {
		const harness = createRuntimeHarness();
		await harness.runtime.createGoal({ objective: "Ship the release", tokenBudget: 100 });
		const goalId = harness.getState()?.goal.id;
		if (!goalId) throw new Error("expected active goal");
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-block", { op: "block", goal_id: goalId });

		expect(result.details).toMatchObject({ op: "block" });
		const after = harness.getState();
		expect(after?.enabled).toBe(false);
		expect(after?.mode).toBe("active");
		expect(after?.reason).toBe("blocked");
		expect(after?.goal.status).toBe("blocked");
	});

	it("flips state to exiting and clears enabled when op=complete succeeds (fix #1)", async () => {
		const harness = createRuntimeHarness();
		await harness.runtime.createGoal({ objective: "Ship the release", tokenBudget: 100 });
		const goalId = harness.getState()?.goal.id;
		if (!goalId) throw new Error("expected active goal");
		const tool = new GoalTool(
			createToolSession({
				getGoalRuntime: () => harness.runtime,
				getGoalModeState: () => harness.getState(),
			}),
		);

		const result = await tool.execute("call-complete", { op: "complete", goal_id: goalId });

		expect(result.details).toMatchObject({ op: "complete" });
		const after = harness.getState();
		expect(after?.enabled).toBe(false);
		expect(after?.mode).toBe("exiting");
		expect(after?.reason).toBe("completed");
		expect(after?.goal.status).toBe("complete");
	});
});
