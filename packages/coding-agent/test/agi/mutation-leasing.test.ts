import { describe, expect, test } from "bun:test";
import {
	type CapabilityLease,
	classifyToolMutation,
	leaseGrantsSandbox,
	mutationClassRequiresSandbox,
} from "../../src/agi/capability-lease";
import { RegistryRoleExecutor } from "../../src/agi/role-executor";
import type { RuntimeAction } from "../../src/autonomy";
import type { ToolDescriptor } from "../../src/tools/registry/tool-descriptor";
import { ToolRegistry } from "../../src/tools/registry/tool-registry";
import { validContract } from "./objective-contract.test";

function action(role: RuntimeAction["role"] = "Builder"): RuntimeAction {
	const contract = validContract();
	return {
		id: "action-1",
		missionId: "mission-1",
		objectiveContractId: contract.id,
		planId: "plan-1",
		stepId: "step-1",
		role,
		instruction: "Mutate the scheduler",
		dependencies: [],
		scopeGuard: contract.scopeGuard,
		budgetGuard: contract.budgetGuard,
		acceptanceCriteria: contract.acceptanceCriteria,
		requiredEvidence: ["source_diff"],
		status: "queued",
	};
}

function lease(runtimeAction: RuntimeAction, overrides: Partial<CapabilityLease> = {}): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: runtimeAction.missionId,
		objectiveContractId: runtimeAction.objectiveContractId,
		planId: runtimeAction.planId,
		planStepId: runtimeAction.stepId,
		actionId: runtimeAction.id,
		mode: "dry-run",
		actorRole: runtimeAction.role,
		allowedTools: ["write"],
		allowedRisk: "HIGH",
		mutationScope: {
			allowedPaths: ["packages/coding-agent/src/autonomy/**"],
			deniedPaths: [],
			allowedServices: [],
			allowedDataClasses: [],
		},
		budget: { maxToolCalls: 1, maxRetries: 0, timeoutMs: 30_000 },
		sandbox: { mode: "isolated-worktree", baselineRef: "HEAD", rollbackRefs: [] },
		evidenceContract: { requiredEventTypes: ["tool.completed"], requiredEvidenceRefs: [] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
		...overrides,
	};
}

function mutationCapableContract() {
	const base = validContract();
	return {
		...base,
		rolePolicy: {
			...base.rolePolicy,
			capabilities: base.rolePolicy.capabilities.map(capability =>
				capability.role === "Builder"
					? { ...capability, allowedTools: ["read", "write", "edit", "bash"] }
					: capability,
			),
		},
	};
}

function descriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
	return {
		name: "write",
		toolClass: "legacy",
		domain: "filesystem",
		riskLevel: "HIGH",
		mutatesWorkspace: true,
		requiresApproval: false,
		supportsRollback: true,
		execute: async () => ({ ok: true, output: { changed: true } }),
		...overrides,
	};
}

describe("tool mutation classification", () => {
	test("read-only descriptors classify as read-only and need no sandbox", () => {
		const mutationClass = classifyToolMutation({ mutatesWorkspace: false, supportsRollback: false });
		expect(mutationClass).toBe("read-only");
		expect(mutationClassRequiresSandbox(mutationClass)).toBe(false);
	});

	test("rollback-capable mutating descriptors classify as rollback and need a sandbox", () => {
		const mutationClass = classifyToolMutation({ mutatesWorkspace: true, supportsRollback: true });
		expect(mutationClass).toBe("rollback");
		expect(mutationClassRequiresSandbox(mutationClass)).toBe(true);
	});

	test("non-rollback mutating descriptors classify as mutating and need a sandbox", () => {
		const mutationClass = classifyToolMutation({ mutatesWorkspace: true, supportsRollback: false });
		expect(mutationClass).toBe("mutating");
		expect(mutationClassRequiresSandbox(mutationClass)).toBe(true);
	});

	test("leaseGrantsSandbox distinguishes isolated leases from none", () => {
		const runtimeAction = action();
		expect(leaseGrantsSandbox(lease(runtimeAction))).toBe(true);
		expect(leaseGrantsSandbox(lease(runtimeAction, { sandbox: { mode: "none", rollbackRefs: [] } }))).toBe(false);
	});
});

describe("RegistryRoleExecutor mutation sandbox enforcement", () => {
	test("mutating descriptor cannot execute outside a sandbox lease", async () => {
		const runtimeAction = action();
		const registry = new ToolRegistry();
		registry.register(
			descriptor({
				execute: async () => {
					throw new Error("must not run without sandbox lease");
				},
			}),
		);
		const result = await new RegistryRoleExecutor({ registry }).execute({
			action: runtimeAction,
			lease: lease(runtimeAction, { sandbox: { mode: "none", rollbackRefs: [] } }),
			mission: { id: "mission-1" } as never,
			contract: mutationCapableContract(),
		});

		expect(result.status).toBe("blocked");
		expect(result.error).toContain("requires a sandbox lease");
	});

	test("mutating descriptor cannot execute without a provisioned sandbox workspace", async () => {
		const runtimeAction = action();
		const registry = new ToolRegistry();
		registry.register(
			descriptor({
				execute: async () => {
					throw new Error("must not run without sandbox workspace");
				},
			}),
		);
		const result = await new RegistryRoleExecutor({ registry }).execute({
			action: runtimeAction,
			lease: lease(runtimeAction),
			mission: { id: "mission-1" } as never,
			contract: mutationCapableContract(),
		});

		expect(result.status).toBe("blocked");
		expect(result.error).toContain("requires an isolated sandbox workspace");
	});

	test("mutating descriptor executes inside a sandbox against the sandbox cwd", async () => {
		const runtimeAction = action();
		let executedCwd: string | undefined;
		const registry = new ToolRegistry();
		registry.register(
			descriptor({
				execute: async (_input, ctx) => {
					executedCwd = ctx.cwd;
					return { ok: true, output: { changed: true } };
				},
			}),
		);
		const result = await new RegistryRoleExecutor({ registry }).execute({
			action: runtimeAction,
			lease: lease(runtimeAction),
			mission: { id: "mission-1" } as never,
			contract: mutationCapableContract(),
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

		expect(result.status).toBe("succeeded");
		expect(result.evidenceRefs).toEqual(["tool:write:action-1"]);
		expect(executedCwd).toBe("/tmp/sandbox-1");
	});

	test("lease denies an unapproved mutation descriptor not in the role capability", async () => {
		const runtimeAction = action();
		const registry = new ToolRegistry();
		registry.register(descriptor());
		// validContract()'s Builder capability does not allow "write"; alignment fails before dispatch.
		await expect(
			new RegistryRoleExecutor({ registry }).execute({
				action: runtimeAction,
				lease: lease(runtimeAction),
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
			}),
		).rejects.toThrow(/not allowed/);
	});
});
