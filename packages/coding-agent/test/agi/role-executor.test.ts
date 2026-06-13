import { describe, expect, test } from "bun:test";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import { GuardedRoleExecutor, roleCanApproveCompletion } from "../../src/agi/role-executor";
import type { RuntimeAction } from "../../src/autonomy";
import { validContract } from "./objective-contract.test";

function action(): RuntimeAction {
	const contract = validContract();
	return {
		id: "action-1",
		missionId: "mission-1",
		objectiveContractId: contract.id,
		planId: "plan-1",
		stepId: "step-1",
		role: "Builder",
		instruction: "Edit safely",
		dependencies: [],
		scopeGuard: contract.scopeGuard,
		budgetGuard: contract.budgetGuard,
		acceptanceCriteria: contract.acceptanceCriteria,
		requiredEvidence: ["test_output"],
		status: "queued",
	};
}

function lease(runtimeAction: RuntimeAction): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: runtimeAction.missionId,
		objectiveContractId: runtimeAction.objectiveContractId,
		planId: runtimeAction.planId,
		planStepId: runtimeAction.stepId,
		actionId: runtimeAction.id,
		mode: "interactive",
		actorRole: runtimeAction.role,
		allowedTools: ["edit"],
		allowedRisk: "HIGH",
		mutationScope: {
			allowedPaths: ["packages/coding-agent/src/autonomy/**"],
			deniedPaths: [],
			allowedServices: [],
			allowedDataClasses: [],
		},
		budget: { maxToolCalls: 1, maxRetries: 0, timeoutMs: 30_000 },
		sandbox: { mode: "none", rollbackRefs: [] },
		evidenceContract: { requiredEventTypes: ["tool.completed"], requiredEvidenceRefs: [] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
	};
}

describe("role executor guards", () => {
	test("rejects role tool permissions outside the contract capability", async () => {
		const runtimeAction = action();
		const badLease = { ...lease(runtimeAction), allowedTools: ["write"] };
		const executor = new GuardedRoleExecutor({
			execute: async () => ({ actionId: runtimeAction.id, status: "succeeded", evidenceRefs: [] }),
		});

		await expect(
			executor.execute({
				action: runtimeAction,
				lease: badLease,
				mission: { id: "mission-1" } as never,
				contract: validContract(),
			}),
		).rejects.toThrow(/not allowed/);
	});

	test("only verifier role can approve completion", () => {
		expect(roleCanApproveCompletion("Verifier")).toBe(true);
		expect(roleCanApproveCompletion("Builder")).toBe(false);
	});
});
