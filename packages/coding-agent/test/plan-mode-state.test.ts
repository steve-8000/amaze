import { describe, expect, it } from "bun:test";
import { parsePlanModeState, planGoalBindingFromGoal, planGoalDriftReason } from "@amaze/coding-agent/plan-mode/state";

const baseGoal = {
	id: "goal-1",
	objective: "Ship the feature",
	status: "active" as const,
	tokenBudget: 500,
	tokensUsed: 12,
	timeUsedSeconds: 3,
	createdAt: 0,
	updatedAt: 0,
	contractRevision: 2,
};

describe("plan-mode goal binding", () => {
	it("extracts goal binding fields from a goal snapshot", () => {
		expect(planGoalBindingFromGoal(baseGoal)).toEqual({
			goalId: "goal-1",
			goalObjective: "Ship the feature",
			goalTokenBudget: 500,
			goalContractRevision: 2,
		});
	});

	it("treats objective-only changes as stale even when contract revision is unchanged", () => {
		const planState = {
			goalId: "goal-1",
			goalObjective: "Ship the feature",
			goalTokenBudget: 500,
			goalContractRevision: 2,
		};

		expect(planGoalDriftReason(planState, { ...baseGoal, objective: "Ship the other feature" })).toBe(
			"linked goal objective changed",
		);
	});

	it("parses persisted linked-goal binding data from mode snapshots", () => {
		const parsed = parsePlanModeState({
			planFilePath: "local://PLAN.md",
			workflow: "parallel",
			goal: baseGoal,
		});

		expect(parsed).toEqual({
			enabled: true,
			planFilePath: "local://PLAN.md",
			workflow: "parallel",
			reentry: undefined,
			goalId: "goal-1",
			goalObjective: "Ship the feature",
			goalTokenBudget: 500,
			goalContractRevision: 2,
		});
	});
});
