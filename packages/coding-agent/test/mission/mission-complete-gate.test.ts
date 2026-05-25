import { afterEach, describe, expect, test } from "bun:test";
import type { MissionInput } from "../../src/mission/core/mission-input";
import type { MissionOutcome } from "../../src/mission/core/mission-outcome";
import { MissionAcceptanceFailureError, MissionRuntimeImpl } from "../../src/mission/core/mission-runtime";
import { MissionStore } from "../../src/mission/store";

const runtimes: MissionRuntimeImpl[] = [];
const stores: MissionStore[] = [];

afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime.close();
	for (const store of stores.splice(0)) {
		try {
			store.close();
		} catch {}
	}
});

function createRuntime(): MissionRuntimeImpl {
	const store = new MissionStore(":memory:");
	stores.push(store);
	const runtime = new MissionRuntimeImpl({ store });
	runtimes.push(runtime);
	return runtime;
}

function baseInput(overrides: Partial<MissionInput> = {}): MissionInput {
	return { title: "Mission", objective: "Implement feature", ...overrides };
}

function outcome(): MissionOutcome {
	return { status: "success", summary: "done", recordedAt: Date.now() };
}

describe("MissionRuntimeImpl.complete lifecycle template gate", () => {
	test("architecture_change lists all missing completion artifacts", async () => {
		const runtime = createRuntime();
		const mission = await runtime.create(baseInput({ intent: "architecture_change" }));

		const completion = runtime.complete(mission.id, { outcome: outcome() });
		await expect(completion).rejects.toThrow(MissionAcceptanceFailureError);
		await expect(completion).rejects.toThrow(
			`Mission "${mission.id}" cannot complete: missing decisionId, regressionContractId, verification.verdict=pass`,
		);
	});

	test("architecture_change completes when required artifacts are present", async () => {
		const runtime = createRuntime();
		const mission = await runtime.create(baseInput({ intent: "architecture_change" }));
		mission.decisionId = "decision-1";
		mission.regressionContractId = "contract-1";
		mission.verification = { status: "pass", verdict: "pass", summary: "passed" };

		const completed = await runtime.complete(mission.id, { outcome: outcome() });

		expect(completed.lifecycle).toBe("completed");
	});

	test("code_change completes with passing verification", async () => {
		const runtime = createRuntime();
		const mission = await runtime.create(baseInput({ intent: "code_change" }));
		mission.verification = { status: "pass", verdict: "pass", summary: "passed" };

		const completed = await runtime.complete(mission.id, { outcome: outcome() });

		expect(completed.lifecycle).toBe("completed");
	});
});
