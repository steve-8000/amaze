import { afterEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@amaze/coding-agent/config/settings";
import type { Goal, GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "@amaze/coding-agent/goals/state";
import { type AcceptanceCriterion, summarize, type VerificationVerdict } from "@amaze/coding-agent/goals/verifier";
import {
	GoalAcceptanceFailureError,
	type GoalRuntimeHost,
	ObjectiveRuntimeImpl,
} from "@amaze/coding-agent/mission/core/objective-runtime";

function criterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
	return {
		id: "criterion-1",
		description: "criterion",
		check: { type: "lsp-clean", file: "src/index.ts" },
		...overrides,
	};
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		objective: "finish",
		status: "active",
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

function createRuntime(state: GoalModeState): ObjectiveRuntimeImpl {
	let current = cloneState(state);
	const usage: GoalTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const host: GoalRuntimeHost = {
		getState: () => cloneState(current),
		setState: next => {
			current = cloneState(next);
		},
		getCurrentUsage: () => ({ ...usage }),
		emit: (_event: GoalRuntimeEvent) => {},
		persist: () => {},
		sendHiddenMessage: async () => {},
		now: () => 0,
	};
	return new ObjectiveRuntimeImpl(host);
}

afterEach(() => {
	resetSettingsForTest();
});

describe("uncertain verifier policy", () => {
	it("keeps audit mode non-blocking for uncertain results when criteria are omitted", () => {
		const verdict = summarize([
			{ id: "criterion-1", description: "criterion", status: "uncertain", evidence: "not checked", confidence: 0 },
		]);

		expect(verdict.verdict).toBe("pass");
		expect(verdict.uncertainCount).toBe(1);
		expect(verdict.failedCount).toBe(0);
	});

	it("blocks uncertain lsp-clean criteria in contract mode", () => {
		const criteria = [criterion()];
		const verdict = summarize(
			[{ id: "criterion-1", description: "criterion", status: "uncertain", evidence: "no lsp", confidence: 0 }],
			criteria,
			"contract",
		);

		expect(verdict.verdict).toBe("fail");
		expect(verdict.failedCount).toBe(1);
	});

	it("allows uncertain manual criteria in contract mode", () => {
		const criteria = [criterion({ check: { type: "manual", description: "review" } })];
		const verdict = summarize(
			[{ id: "criterion-1", description: "criterion", status: "uncertain", evidence: "manual", confidence: 0 }],
			criteria,
			"contract",
		);

		expect(verdict.verdict).toBe("pass");
		expect(verdict.failedCount).toBe(0);
	});

	it("blocks runtime completion when goal.uncertainPolicy is block-all", async () => {
		await Settings.init({ inMemory: true, overrides: { "goal.uncertainPolicy": "block-all" } });
		const criteria = [criterion({ check: { type: "manual", description: "review" } })];
		const runtime = createRuntime({
			enabled: true,
			mode: "active",
			goal: createGoal({ acceptanceCriteria: criteria }),
		});

		let verdict: VerificationVerdict | undefined;
		try {
			await runtime.completeGoalFromTool({ verificationContext: { cwd: "/tmp", changedFiles: ["src/index.ts"] } });
		} catch (error) {
			expect(error).toBeInstanceOf(GoalAcceptanceFailureError);
			verdict = (error as GoalAcceptanceFailureError).verdict;
		}

		expect(verdict?.verdict).toBe("fail");
		expect(verdict?.failedCount).toBe(1);
	});
});
