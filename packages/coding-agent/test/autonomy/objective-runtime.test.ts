import { describe, expect, test } from "bun:test";
import {
	generateNextMissions,
	type ObjectiveMissionSummary,
	reevaluateObjective,
	settleObjective,
	summarizeObjectiveMission,
} from "../../src/autonomy/objective-runtime";
import type { Objective } from "../../src/autonomy/types";

function objective(overrides: Partial<Objective> = {}): Objective {
	return {
		id: "obj-1",
		title: "Improve runtime",
		metricTargets: [
			{ metric: "alpha", target: 1, direction: "up" },
			{ metric: "beta", target: 0, direction: "down" },
		],
		budget: { tokens: 1000, wallClockMs: 60_000 },
		guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 5, forbiddenScopes: [] },
		status: "active",
		...overrides,
	};
}

const now = () => 1000;

describe("reevaluateObjective", () => {
	test("marks metrics addressed by completed missions and leaves the rest unmet", () => {
		const missions: ObjectiveMissionSummary[] = [{ id: "m1", state: "completed", addressedMetrics: ["alpha"] }];
		const result = reevaluateObjective(objective(), missions, now);
		expect(result.hasSuccessfulMission).toBe(true);
		expect(result.hasActiveMission).toBe(false);
		expect(result.addressedMetrics).toEqual(["alpha"]);
		expect(result.unmetMetrics).toEqual(["beta"]);
		expect(result.progress.score).toBe(0.5);
		expect(result.progress.lastMeasuredAt).toBe(1000);
	});

	test("carries evidence refs from successful missions into objective progress", () => {
		const missions: ObjectiveMissionSummary[] = [
			{ id: "m1", state: "completed", addressedMetrics: ["alpha"], evidenceRefs: ["evidence:b", "evidence:a"] },
			{ id: "m2", state: "blocked", evidenceRefs: ["evidence:blocked"] },
		];
		const result = reevaluateObjective(objective(), missions, now);
		expect(result.progress.evidenceRefs).toEqual(["evidence:a", "evidence:b"]);
	});

	test("flags an in-progress mission as active", () => {
		const result = reevaluateObjective(objective(), [{ id: "m1", state: "executing" }], now);
		expect(result.hasActiveMission).toBe(true);
		expect(result.hasSuccessfulMission).toBe(false);
		expect(result.unmetMetrics).toEqual(["alpha", "beta"]);
	});

	test("flags a blocked mission distinct from active/successful", () => {
		const result = reevaluateObjective(objective(), [{ id: "m1", state: "blocked" }], now);
		expect(result.hasBlockedMission).toBe(true);
		expect(result.hasActiveMission).toBe(false);
		expect(result.hasSuccessfulMission).toBe(false);
	});

	test("uses mission success ratio for target-less objectives", () => {
		const result = reevaluateObjective(objective({ metricTargets: [] }), [{ id: "m1", state: "completed" }], now);
		expect(result.progress.score).toBe(1);
		expect(result.unmetMetrics).toEqual([]);
	});
});

describe("generateNextMissions", () => {
	test("emits one mission per unmet metric target", async () => {
		const next = await generateNextMissions(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha"] }],
			{ now },
		);
		expect(next).toHaveLength(1);
		expect(next[0]?.acceptanceCriteria?.[0]?.id).toBe("obj-1-beta");
		expect(next[0]?.projectId).toBe("obj-1");
	});

	test("regenerates a metric whose previous mission blocked (replan, not dead end)", async () => {
		// The blocked mission addressed no metric, so beta stays unmet and is regenerated.
		const next = await generateNextMissions(
			objective({ metricTargets: [{ metric: "beta", target: 0, direction: "down" }] }),
			[{ id: "m1", state: "blocked" }],
			{ now },
		);
		expect(next.map(m => m.acceptanceCriteria?.[0]?.id)).toEqual(["obj-1-beta"]);
	});

	test("emits nothing once every metric target is met", async () => {
		const next = await generateNextMissions(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }],
			{ now },
		);
		expect(next).toEqual([]);
	});

	test("caps generated missions by maxAutoSubgoalsPerDay", async () => {
		const next = await generateNextMissions(
			objective({ guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] } }),
			[],
			{ now },
		);
		expect(next).toHaveLength(1);
	});

	test("honors an injected decompose strategy", async () => {
		const next = await generateNextMissions(objective(), [], {
			now,
			decompose: ({ objective: obj }) => [{ title: "custom", objective: `for ${obj.id}` }],
		});
		expect(next).toEqual([{ title: "custom", objective: "for obj-1" }]);
	});

	test("awaits an async (LLM-style) decompose strategy", async () => {
		const next = await generateNextMissions(objective(), [], {
			now,
			decompose: async ({ objective: obj }) => [{ title: "async", objective: `for ${obj.id}` }],
		});
		expect(next).toEqual([{ title: "async", objective: "for obj-1" }]);
	});
});

describe("settleObjective", () => {
	test("stays in_progress while a mission is active and generates nothing", async () => {
		const settlement = await settleObjective(objective(), [{ id: "m1", state: "executing" }], { now });
		expect(settlement.status).toBe("in_progress");
		expect(settlement.complete).toBe(false);
		expect(settlement.nextMissions).toEqual([]);
	});

	test("generates the next mission when quiescent with unmet targets", async () => {
		const settlement = await settleObjective(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha"] }],
			{ now },
		);
		expect(settlement.status).toBe("in_progress");
		expect(settlement.complete).toBe(false);
		expect(settlement.nextMissions).toHaveLength(1);
	});

	test("completes only when every target is met by a success and nothing is blocked", async () => {
		const settlement = await settleObjective(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }],
			{ now },
		);
		expect(settlement.status).toBe("completed");
		expect(settlement.complete).toBe(true);
		expect(settlement.progress.score).toBe(1);
	});

	test("reports blocked when work remains, a mission blocked, and the cap forbids new missions", async () => {
		// maxAutoSubgoalsPerDay=0 means no missions may be generated; the blocked mission
		// leaves beta unmet → blocked, never silent success.
		const obj = objective({
			metricTargets: [{ metric: "beta", target: 0, direction: "down" }],
			guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 0, forbiddenScopes: [] },
		});
		const settlement = await settleObjective(obj, [{ id: "m1", state: "blocked" }], { now });
		expect(settlement.status).toBe("blocked");
		expect(settlement.complete).toBe(false);
	});

	test("reports needs_replan when work remains, nothing blocked, and no mission could be generated", async () => {
		const obj = objective({
			metricTargets: [{ metric: "beta", target: 0, direction: "down" }],
			guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 0, forbiddenScopes: [] },
		});
		const settlement = await settleObjective(obj, [{ id: "m1", state: "cancelled" }], { now });
		expect(settlement.status).toBe("needs_replan");
		expect(settlement.complete).toBe(false);
	});

	test("completion reviewer can veto a metric-complete objective into needs_replan", async () => {
		const settlement = await settleObjective(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }],
			{ now, reviewCompletion: () => ({ verdict: "fail", reason: "design work remains" }) },
		);
		expect(settlement.status).toBe("needs_replan");
		expect(settlement.complete).toBe(false);
		expect(settlement.reason).toContain("design work remains");
	});

	test("completion reviewer veto with follow-ups goes in_progress and generates them", async () => {
		const settlement = await settleObjective(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }],
			{
				now,
				reviewCompletion: () => ({
					verdict: "fail",
					reason: "needs integration test",
					followUpMissions: [{ title: "integration", objective: "add e2e" }],
				}),
			},
		);
		expect(settlement.status).toBe("in_progress");
		expect(settlement.nextMissions).toHaveLength(1);
	});

	test("completion reviewer pass lets the objective complete", async () => {
		const settlement = await settleObjective(
			objective(),
			[{ id: "m1", state: "completed", addressedMetrics: ["alpha", "beta"] }],
			{ now, reviewCompletion: () => ({ verdict: "pass", reason: "genuinely done" }) },
		);
		expect(settlement.status).toBe("completed");
		expect(settlement.complete).toBe(true);
	});
});

describe("summarizeObjectiveMission", () => {
	test("maps satisfied prefixed criteria to addressed metrics", () => {
		const summary = summarizeObjectiveMission("obj-1", { id: "m1", state: "completed" }, [
			{ id: "obj-1-alpha", description: "alpha up", satisfied: true },
			{ id: "obj-1-beta", description: "beta down", satisfied: false },
			{ id: "unrelated", description: "noise", satisfied: true },
		]);
		expect(summary).toEqual({ id: "m1", state: "completed", addressedMetrics: ["alpha"] });
	});

	test("maps evidence refs from satisfied prefixed criteria", () => {
		const summary = summarizeObjectiveMission("obj-1", { id: "m1", state: "completed" }, [
			{ id: "obj-1-alpha", description: "alpha up", satisfied: true, evidenceRefs: ["evidence:z"] },
			{ id: "obj-1-beta", description: "beta down", satisfied: true, evidenceRefs: ["evidence:a", "evidence:z"] },
			{ id: "unrelated", description: "noise", satisfied: true, evidenceRefs: ["evidence:ignored"] },
		]);
		expect(summary).toEqual({
			id: "m1",
			state: "completed",
			addressedMetrics: ["alpha", "beta"],
			evidenceRefs: ["evidence:a", "evidence:z"],
		});
	});

	test("omits addressedMetrics when no prefixed criterion is satisfied", () => {
		const summary = summarizeObjectiveMission("obj-1", { id: "m1", state: "blocked" }, [
			{ id: "obj-1-alpha", description: "alpha up", satisfied: false },
		]);
		expect(summary).toEqual({ id: "m1", state: "blocked" });
	});
});
