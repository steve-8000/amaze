import { describe, expect, test } from "bun:test";
import type { AgiEvalId, AgiEvalRunResult } from "../../src/agi/eval-suite";
import { SelfImprovementRuntime } from "../../src/agi/self-improvement-runtime";

function evalResult(specId: AgiEvalId, passed: boolean): AgiEvalRunResult {
	return {
		specId,
		datasetVersion: "fixture",
		passed,
		metricResults: {},
		blockers: passed ? [] : ["failed"],
		humanReviewRefs: [],
		createdAt: 1,
	};
}

describe("self-improvement runtime", () => {
	test("requires eval pass and rollback refs before apply", async () => {
		const runtime = new SelfImprovementRuntime({
			evalRunner: { runSubset: async evalIds => evalIds.map(evalId => evalResult(evalId, true)) },
		});
		const proposed = runtime.propose({
			signal: { metric: "verifier.bypassRate", actual: 0.2, expected: 0, direction: "down" },
			affectedRuntimeModules: ["packages/coding-agent/src/agi/evidence-verifier.ts"],
			requiredEvalIds: ["self-report-rejection"],
			riskTier: "high",
		});
		const evalPassed = await runtime.verifyWithEvals(proposed);
		expect(evalPassed.status).toBe("eval_passed");
		expect(() => runtime.apply(evalPassed)).toThrow(/approved/);
		const approved = runtime.approve(evalPassed, { approvedBy: "operator", rollbackRefs: ["rollback://1"] });
		expect(runtime.apply(approved).status).toBe("applied");
	});

	test("eval failure rejects proposal", async () => {
		const runtime = new SelfImprovementRuntime({
			evalRunner: { runSubset: async evalIds => evalIds.map(evalId => evalResult(evalId, false)) },
		});
		const proposed = runtime.propose({
			signal: { metric: "goal.forceCompleteRate", actual: 1, expected: 0, direction: "down" },
			affectedRuntimeModules: ["packages/coding-agent/src/agi/runtime.ts"],
			requiredEvalIds: ["self-improvement"],
		});

		expect((await runtime.verifyWithEvals(proposed)).status).toBe("rejected");
	});
});
