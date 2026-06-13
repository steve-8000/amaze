import { describe, expect, test } from "bun:test";
import { RoleRouterError, routePlanStepToAction } from "../../src/agi/role-router";
import { validContract } from "./objective-contract.test";

describe("role router", () => {
	test("converts a valid plan step into a runtime action", () => {
		const contract = validContract();
		const action = routePlanStepToAction({
			contract,
			missionId: "mission-1",
			planId: "plan-1",
			modelRoles: { Builder: "model-builder", Verifier: "model-verifier" },
			step: {
				id: "step-1",
				kind: "implementation",
				description: "Edit the scheduler.",
				touches: ["packages/coding-agent/src/autonomy/scheduler.ts"],
				requiresWrite: true,
				acceptanceCriteria: ["criterion-1"],
			},
		});

		expect(action).toMatchObject({
			id: "mission-1:step-1",
			missionId: "mission-1",
			objectiveContractId: "contract-1",
			planId: "plan-1",
			stepId: "step-1",
			role: "Builder",
			dependencies: [],
			requiredEvidence: ["test_output"],
			status: "queued",
		});
	});

	test("denies routing when selected capability cannot mutate repository", () => {
		const contract = validContract();
		expect(() =>
			routePlanStepToAction({
				contract,
				missionId: "mission-1",
				planId: "plan-1",
				modelRoles: { Builder: "model-builder", Verifier: "model-verifier" },
				step: {
					id: "step-1",
					kind: "verify",
					description: "Verifier attempts an edit.",
					touches: ["packages/coding-agent/src/autonomy/scheduler.ts"],
					requiresWrite: true,
				},
			}),
		).toThrow(RoleRouterError);
	});

	test("denies routing when step target is outside scope", () => {
		const contract = validContract();
		expect(() =>
			routePlanStepToAction({
				contract,
				missionId: "mission-1",
				planId: "plan-1",
				modelRoles: { Builder: "model-builder", Verifier: "model-verifier" },
				step: {
					id: "step-1",
					kind: "implementation",
					description: "Edit an excluded CLI file.",
					touches: ["packages/coding-agent/src/cli/agi.ts"],
					requiresWrite: true,
				},
			}),
		).toThrow(RoleRouterError);
	});
});
