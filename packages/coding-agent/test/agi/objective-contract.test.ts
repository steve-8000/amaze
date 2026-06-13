import { describe, expect, test } from "bun:test";
import { assertValidObjectiveContract, ObjectiveContractValidationError } from "../../src/agi/objective-contract";
import type { ObjectiveContract } from "../../src/autonomy";

export function validContract(overrides: Partial<ObjectiveContract> = {}): ObjectiveContract {
	return {
		id: "contract-1",
		objective: "Reduce flaky tests without touching production deploys.",
		nonGoals: ["Do not deploy"],
		acceptanceCriteria: [
			{
				id: "criterion-1",
				description: "A focused test covers the scheduler branch.",
				required: true,
				evidenceKinds: ["test_output"],
				ownerRole: "Verifier",
				verification: "deterministic",
			},
		],
		requiredEvidence: { "criterion-1": ["test_output"] },
		scopeGuard: {
			include: ["packages/coding-agent/src/autonomy/**"],
			exclude: ["packages/coding-agent/src/cli/**"],
			allowedCommands: ["bun test packages/coding-agent/test/autonomy/scheduler.test.ts"],
			forbiddenActions: ["deploy"],
		},
		budgetGuard: { maxRuntimeActions: 4, maxRetriesPerAction: 1, maxParallelActions: 1 },
		autonomyMode: "supervised",
		risk: "medium",
		freshnessPolicy: { researchRequired: false },
		rolePolicy: {
			capabilities: [
				{
					role: "Builder",
					modelRole: "Builder",
					canRead: true,
					canWriteRepository: true,
					canRunCommands: true,
					canOperateInfrastructure: false,
					canApproveCompletion: false,
					allowedTools: ["read", "edit", "bash"],
				},
				{
					role: "Verifier",
					modelRole: "Verifier",
					canRead: true,
					canWriteRepository: false,
					canRunCommands: true,
					canOperateInfrastructure: false,
					canApproveCompletion: true,
					allowedTools: ["read", "bash"],
				},
			],
			defaultRoleByStepKind: { implementation: "Builder", verify: "Verifier" },
			requireReviewerForRisk: ["high", "critical"],
			requireSecurityFor: [],
			requireSreFor: [],
		},
		...overrides,
	};
}

describe("ObjectiveContract validation", () => {
	test("accepts a complete contract", () => {
		const contract = validContract();
		expect(assertValidObjectiveContract(contract)).toBe(contract);
	});

	test("fails closed for missing objective, criteria, scope, and autonomy", () => {
		const invalid = {
			...validContract(),
			objective: "",
			acceptanceCriteria: [],
			scopeGuard: undefined,
			autonomyMode: undefined,
		};

		expect(() => assertValidObjectiveContract(invalid)).toThrow(ObjectiveContractValidationError);
		try {
			assertValidObjectiveContract(invalid);
		} catch (error) {
			expect(error).toBeInstanceOf(ObjectiveContractValidationError);
			expect((error as ObjectiveContractValidationError).issues).toEqual(
				expect.arrayContaining([
					"objective is required",
					"acceptanceCriteria must contain at least one criterion",
					"scopeGuard is required",
					"autonomyMode is required",
				]),
			);
		}
	});
});
