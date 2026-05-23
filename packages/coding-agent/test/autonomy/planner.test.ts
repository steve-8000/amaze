import { describe, expect, it } from "bun:test";
import { planFromMetrics } from "../../src/autonomy/planner";
import type { Objective } from "../../src/autonomy/types";

const objective: Objective = {
	id: "obj-1",
	title: "Reduce force complete rate",
	metricTargets: [{ metric: "force_complete_rate", target: 0.01, direction: "down" }],
	budget: {},
	guardrails: { requireHumanForApply: true, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
	status: "active",
};

describe("planFromMetrics", () => {
	it("creates a human-gated learning proposal when a metric misses its target", () => {
		const proposal = planFromMetrics(objective, { force_complete_rate: 0.05 }, { sessionId: "s1" });

		expect(proposal).not.toBeNull();
		expect(proposal?.gate).toBe("human-required");
		expect(proposal?.evidence).toEqual({ sessionIds: ["s1"], eventRefs: [], ruleFindings: [], sampleN: 1 });
		expect(proposal?.provenance).toEqual({ source: "reflection" });
		expect(proposal?.type).toBe("settings");
	});

	it("returns null when all metric targets are satisfied", () => {
		expect(planFromMetrics(objective, { force_complete_rate: 0.005 })).toBeNull();
	});
});
