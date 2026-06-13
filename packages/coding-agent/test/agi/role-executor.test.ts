import { describe, expect, test } from "bun:test";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import { GuardedRoleExecutor, RegistryRoleExecutor, roleCanApproveCompletion } from "../../src/agi/role-executor";
import type { RuntimeAction } from "../../src/autonomy";
import { ToolRegistry } from "../../src/tools/registry/tool-registry";
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

	test("dispatches a read-only leased tool without requiring a sandbox", async () => {
		const runtimeAction = action();
		let executedInput: unknown;
		let executedActionId: string | undefined;
		let executedCwd: string | undefined;
		const registry = new ToolRegistry();
		registry.register({
			name: "read",
			toolClass: "native",
			domain: "filesystem",
			riskLevel: "LOW",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
			execute: async (input, context) => {
				executedInput = input;
				executedActionId = context.actionId;
				executedCwd = context.cwd;
				return { ok: true, output: { changed: true } };
			},
		});
		const executor = new RegistryRoleExecutor({ registry });

		const result = await executor.execute({
			action: runtimeAction,
			lease: { ...lease(runtimeAction), allowedTools: ["read"], allowedRisk: "LOW" },
			mission: { id: "mission-1" } as never,
			contract: validContract(),
		});

		expect(result).toEqual({ actionId: runtimeAction.id, status: "succeeded", evidenceRefs: ["tool:read:action-1"] });
		expect(executedInput).toMatchObject({ actionId: "action-1", instruction: "Edit safely" });
		expect(executedActionId).toBe("action-1");
		expect(executedCwd).toBeUndefined();
	});

	test("blocks a mutating leased tool when no sandbox is provisioned", async () => {
		const runtimeAction = action();
		const registry = new ToolRegistry();
		registry.register({
			name: "edit",
			toolClass: "native",
			domain: "filesystem",
			riskLevel: "HIGH",
			mutatesWorkspace: true,
			requiresApproval: false,
			supportsRollback: true,
			execute: async () => {
				throw new Error("mutating tool must not run without a sandbox");
			},
		});

		const result = await new RegistryRoleExecutor({ registry }).execute({
			action: runtimeAction,
			lease: lease(runtimeAction),
			mission: { id: "mission-1" } as never,
			contract: validContract(),
		});

		expect(result.status).toBe("blocked");
		expect(result.error).toContain("requires a sandbox lease");
	});

	test("threads sandbox workspace cwd into a mutating registered tool context", async () => {
		const runtimeAction = action();
		let executedCwd: string | undefined;
		const registry = new ToolRegistry();
		registry.register({
			name: "edit",
			toolClass: "native",
			domain: "filesystem",
			riskLevel: "HIGH",
			mutatesWorkspace: true,
			requiresApproval: false,
			supportsRollback: true,
			execute: async (_input, context) => {
				executedCwd = context.cwd;
				return { ok: true, output: { changed: true } };
			},
		});

		await new RegistryRoleExecutor({ registry }).execute({
			action: runtimeAction,
			lease: {
				...lease(runtimeAction),
				sandbox: { mode: "isolated-worktree", baselineRef: "HEAD", rollbackRefs: [] },
			},
			mission: { id: "mission-1" } as never,
			contract: validContract(),
			sandboxWorkspace: {
				id: "sandbox-1",
				missionId: "mission-1",
				actionId: "action-1",
				mode: "isolated-worktree",
				cwd: "/tmp/sandbox-1",
				baselineRef: "HEAD",
				createdAt: 1,
			},
		});

		expect(executedCwd).toBe("/tmp/sandbox-1");
	});

	test("blocks execution when the leased tool is not registered", async () => {
		const runtimeAction = action();
		const executor = new RegistryRoleExecutor({ registry: new ToolRegistry() });

		const result = await executor.execute({
			action: runtimeAction,
			lease: lease(runtimeAction),
			mission: { id: "mission-1" } as never,
			contract: validContract(),
		});

		expect(result.status).toBe("blocked");
		expect(result.error).toContain("No registered tool descriptor");
	});
});
