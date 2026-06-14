import { describe, expect, test } from "bun:test";
import {
	createLlmCompletionReviewer,
	createLlmObjectiveDecomposer,
	type LlmText,
} from "../../src/autonomy/objective-llm";
import { reevaluateObjective } from "../../src/autonomy/objective-runtime";
import type { Objective } from "../../src/autonomy/types";

function objective(overrides: Partial<Objective> = {}): Objective {
	return {
		id: "obj-1",
		title: "Improve runtime",
		metricTargets: [
			{ metric: "alpha", target: 1, direction: "up" },
			{ metric: "beta", target: 0, direction: "down" },
		],
		budget: {},
		guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 5, forbiddenScopes: [] },
		status: "active",
		...overrides,
	};
}

const now = () => 1000;

function ctx(obj: Objective, missions: Parameters<typeof reevaluateObjective>[1]) {
	return { objective: obj, missions, reevaluation: reevaluateObjective(obj, missions, now) };
}

const constant =
	(text: string): LlmText =>
	async () =>
		text;

describe("createLlmObjectiveDecomposer", () => {
	test("maps model missions to unmet metrics and overrides title/objective", async () => {
		const decompose = createLlmObjectiveDecomposer(
			constant(
				JSON.stringify({
					missions: [
						{ title: "Close alpha", objective: "raise alpha", metric: "alpha" },
						{ title: "Close beta", objective: "lower beta", metric: "beta" },
					],
				}),
			),
		);
		const obj = objective();
		const next = await decompose(ctx(obj, []));
		expect(next.map(m => m.title)).toEqual(["Close alpha", "Close beta"]);
		// Acceptance criterion id still follows the convention so re-eval can match it.
		expect(next.map(m => m.acceptanceCriteria?.[0]?.id)).toEqual(["obj-1-alpha", "obj-1-beta"]);
	});

	test("drops model rows that name no valid unmet metric", async () => {
		const decompose = createLlmObjectiveDecomposer(
			constant(JSON.stringify({ missions: [{ title: "Noise", objective: "do stuff", metric: "ghost" }] })),
		);
		const obj = objective({ metricTargets: [{ metric: "alpha", target: 1, direction: "up" }] });
		const next = await decompose(ctx(obj, []));
		// "ghost" is dropped; the deterministic backstop still covers the real unmet metric alpha.
		expect(next.map(m => m.acceptanceCriteria?.[0]?.id)).toEqual(["obj-1-alpha"]);
	});

	test("falls back to deterministic missions on malformed model output", async () => {
		const decompose = createLlmObjectiveDecomposer(constant("not json at all"));
		const obj = objective();
		const next = await decompose(ctx(obj, []));
		expect(next.map(m => m.acceptanceCriteria?.[0]?.id).sort()).toEqual(["obj-1-alpha", "obj-1-beta"]);
	});

	test("returns nothing when no metric is unmet", async () => {
		const decompose = createLlmObjectiveDecomposer(constant(JSON.stringify({ missions: [] })));
		const obj = objective();
		const next = await decompose(ctx(obj, [{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }]));
		expect(next).toEqual([]);
	});

	test("survives an LLM that throws by using the deterministic backstop", async () => {
		const decompose = createLlmObjectiveDecomposer(async () => {
			throw new Error("model down");
		});
		const obj = objective({ metricTargets: [{ metric: "alpha", target: 1, direction: "up" }] });
		const next = await decompose(ctx(obj, []));
		expect(next.map(m => m.acceptanceCriteria?.[0]?.id)).toEqual(["obj-1-alpha"]);
	});
});

describe("createLlmCompletionReviewer", () => {
	test("returns fail with follow-ups when the model rejects completion", async () => {
		const review = createLlmCompletionReviewer(
			constant(
				JSON.stringify({
					verdict: "fail",
					reason: "integration untested",
					followUps: [{ title: "Add e2e", objective: "cover the integration path" }],
				}),
			),
		);
		const obj = objective();
		const result = await review(ctx(obj, [{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }]));
		expect(result.verdict).toBe("fail");
		expect(result.reason).toContain("integration untested");
		expect(result.followUpMissions).toHaveLength(1);
	});

	test("returns pass when the model approves", async () => {
		const review = createLlmCompletionReviewer(constant(JSON.stringify({ verdict: "pass", reason: "done" })));
		const result = await review(ctx(objective(), [{ id: "m1", state: "completed" }]));
		expect(result.verdict).toBe("pass");
	});

	test("defaults to pass on model failure so a reviewer outage cannot wedge a complete objective", async () => {
		const review = createLlmCompletionReviewer(async () => {
			throw new Error("model down");
		});
		const result = await review(ctx(objective(), [{ id: "m1", state: "completed" }]));
		expect(result.verdict).toBe("pass");
		expect(result.reason).toContain("unavailable");
	});

	test("defaults to pass on unparseable output", async () => {
		const review = createLlmCompletionReviewer(constant("garbage"));
		const result = await review(ctx(objective(), [{ id: "m1", state: "completed" }]));
		expect(result.verdict).toBe("pass");
	});
});
