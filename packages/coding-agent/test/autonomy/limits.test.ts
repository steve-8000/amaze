import { describe, expect, it } from "bun:test";
import { shouldEmitProposal } from "../../src/autonomy/limits";
import type { Objective } from "../../src/autonomy/types";
import type { LearningProposal } from "../../src/learning";

const objective: Objective = {
	id: "obj-1",
	title: "Stay in budget",
	metricTargets: [{ metric: "force_complete_rate", target: 0.01, direction: "down" }],
	budget: { tokens: 100, usd: 1 },
	guardrails: {
		requireHumanForApply: true,
		maxAutoSubgoalsPerDay: 1,
		forbiddenScopes: ["packages/coding-agent/src/learning/**"],
	},
	status: "active",
};

const candidate: LearningProposal = {
	id: "p1",
	createdAt: 1,
	status: "pending",
	gate: "human-required",
	evidence: { sessionIds: [], eventRefs: [], ruleFindings: [], sampleN: 1 },
	provenance: { source: "reflection" },
	type: "settings",
	patch: { "goal.uncertainPolicy": "ask" },
	reason: "test",
	rollback: { "goal.uncertainPolicy": "complete" },
};

describe("shouldEmitProposal", () => {
	it("denies when the daily subgoal count is exhausted", () => {
		expect(shouldEmitProposal(objective, candidate, { todayCount: 1, usedTokens: 0 }).allow).toBe(false);
	});

	it("denies when token or usd budget is exhausted", () => {
		expect(shouldEmitProposal(objective, candidate, { todayCount: 0, usedTokens: 100 }).allow).toBe(false);
		expect(shouldEmitProposal(objective, candidate, { todayCount: 0, usedTokens: 0, usedUsdCents: 100 }).allow).toBe(
			false,
		);
	});

	it("denies when a settings patch targets a forbidden path", () => {
		const forbidden = { ...candidate, patch: { "packages/coding-agent/src/learning/store.ts": true } };
		expect(shouldEmitProposal(objective, forbidden, { todayCount: 0, usedTokens: 0 }).allow).toBe(false);
	});

	it("allows candidates within limits", () => {
		expect(shouldEmitProposal(objective, candidate, { todayCount: 0, usedTokens: 50, usedUsdCents: 50 })).toEqual({
			allow: true,
		});
	});
});
