import { describe, expect, test } from "bun:test";
import { DeterministicReplanner } from "../../src/agi/replanner";
import type { Mission } from "../../src/mission/core/mission";
import { validContract } from "./objective-contract.test";

describe("DeterministicReplanner", () => {
	test("creates a recovery plan tied to mission, contract, reason, and evidence", async () => {
		const replanner = new DeterministicReplanner();
		const mission = { id: "mission-1" } as Mission;
		const contract = validContract();

		const first = await replanner.replan({ mission, contract, reason: "blocked", evidenceRefs: ["evidence://1"] });
		const second = await replanner.replan({ mission, contract, reason: "blocked", evidenceRefs: ["evidence://1"] });

		expect(first.plan.id).toBe(second.plan.id);
		expect(first.plan.steps).toEqual([
			expect.objectContaining({ id: "recover-runtime-plan", kind: "replan", roleHint: "Planner" }),
		]);
		expect(first.summary).toContain("blocked");
	});
});
