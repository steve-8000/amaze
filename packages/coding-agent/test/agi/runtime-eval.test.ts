import { describe, expect, test } from "bun:test";
import { runAgiRuntimeEval } from "../../src/cli/agi-runtime-eval";

describe("AGI runtime eval", () => {
	test("all runtime invariants pass under the production mutation harness", async () => {
		const report = await runAgiRuntimeEval();
		const failed = report.checks.filter(check => !check.passed).map(check => check.name);
		expect(failed).toEqual([]);
		expect(report.passed).toBe(true);
		// Coverage of the four invariant families: no-synthetic, sandbox isolation,
		// lease enforcement / governance, rollback, and evidence-backed completion.
		expect(report.checks.length).toBeGreaterThanOrEqual(13);
	});
});
