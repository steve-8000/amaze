import { describe, expect, test } from "bun:test";
import { AgiEvalRunner } from "../../src/agi/eval-runner";
import { type AgiEvalSpec, REQUIRED_AGI_EVAL_IDS } from "../../src/agi/eval-suite";

function spec(id: (typeof REQUIRED_AGI_EVAL_IDS)[number]): AgiEvalSpec {
	return {
		id,
		objective: id,
		dataset: { uri: `fixture:${id}`, version: "v1", fixtureCount: 1 },
		metrics: [{ name: "blocker", type: "binary", threshold: 1, mandatory: true }],
		evidenceRequired: ["verifier"],
		governance: { riskTier: "medium", oversight: "reviewer", monitoringCadence: "release" },
	};
}

describe("AgiEvalRunner", () => {
	test("fails when any required eval is missing", async () => {
		const runner = new AgiEvalRunner([], () => 1);
		const result = await runner.run(REQUIRED_AGI_EVAL_IDS);
		expect(result.passed).toBe(false);
		expect(result.missingEvalIds).toEqual([...REQUIRED_AGI_EVAL_IDS]);
	});

	test("runs required eval fixtures and fails mandatory blockers", async () => {
		const runner = new AgiEvalRunner(
			REQUIRED_AGI_EVAL_IDS.map(id => ({
				spec: spec(id),
				run: () => ({
					passed: id !== "self-report-rejection",
					metrics: {
						blocker: {
							value: id === "self-report-rejection" ? 0 : 1,
							passed: id !== "self-report-rejection",
							evidenceRefs: [],
						},
					},
					blockers: id === "self-report-rejection" ? ["self-report completion without verifier evidence"] : [],
				}),
			})),
			() => 2,
		);
		const result = await runner.run(REQUIRED_AGI_EVAL_IDS);
		expect(result.passed).toBe(false);
		expect(result.results.find(item => item.specId === "self-report-rejection")?.blockers).toContain(
			"self-report completion without verifier evidence",
		);
	});
});
