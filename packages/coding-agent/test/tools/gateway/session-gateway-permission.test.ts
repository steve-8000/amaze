import { describe, expect, it } from "bun:test";
import type { CapabilityLease } from "../../../src/agi/capability-lease";
import type { Mission } from "../../../src/mission/core/mission";
import type { MissionControlRuntime } from "../../../src/mission/core/mission-control-runtime";
import { ChangedArtifactRegistry, PendingApprovalRegistry, SessionToolGateway } from "../../../src/tools/gateway";

function mission(): Mission {
	return {
		id: "m1",
		title: "Mission",
		objective: "Ship runtime",
		mode: "interactive",
		lifecycle: "executing",
		riskLevel: "medium",
		intent: "code_change",
		constraints: [],
		acceptanceCriteria: [],
		budget: { tokenBudget: 0, tokensUsed: 0 },
		contextBudget: { maxContextTokens: 0, contextTokensUsed: 0 },
		tasks: [],
		evidenceRefs: [],
		createdAt: 1,
		updatedAt: 1,
		revision: 1,
	};
}

function lease(): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: "m1",
		objectiveContractId: "contract-1",
		planId: "plan-1",
		planStepId: "step-1",
		actionId: "action-1",
		mode: "interactive",
		actorRole: "Builder",
		allowedTools: ["write"],
		allowedRisk: "HIGH",
		mutationScope: { allowedPaths: ["src/**"], deniedPaths: [], allowedServices: [], allowedDataClasses: [] },
		budget: { maxToolCalls: 1, maxRetries: 0, timeoutMs: 1000 },
		approval: { approvalId: "approval-1", approvedBy: "user", approvedAt: 1, reason: "approved" },
		sandbox: { mode: "isolated-worktree", baselineRef: "base", rollbackRefs: ["rollback://base"] },
		evidenceContract: { requiredEventTypes: ["tool.requested", "tool.completed"], requiredEvidenceRefs: [] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
	};
}

describe("PendingApprovalRegistry", () => {
	it("dedupes pending requests by toolCallId and filters by status, mission, and task", () => {
		const registry = new PendingApprovalRegistry();

		const first = registry.request({
			tool: "write",
			toolCallId: "tool-1",
			missionId: "m1",
			taskId: "task-1",
			riskLevel: "HIGH",
			reason: "requires approval",
			inputSummary: '{"path":"src/file.ts"}',
		});
		const duplicate = registry.request({
			tool: "edit",
			toolCallId: "tool-1",
			missionId: "m2",
			taskId: "task-2",
			riskLevel: "CRITICAL",
			reason: "different request shape should be ignored while pending",
		});
		const second = registry.request({
			tool: "bash",
			toolCallId: "tool-2",
			missionId: "m1",
			taskId: "task-2",
			riskLevel: "CRITICAL",
			reason: "requires shell approval",
		});

		expect(duplicate).toBe(first);
		expect(registry.list()).toEqual([first, second]);
		expect(registry.list({ status: "pending" })).toEqual([first, second]);
		expect(registry.list({ missionId: "m1" })).toEqual([first, second]);
		expect(registry.list({ missionId: "m1", taskId: "task-1" })).toEqual([first]);
		expect(registry.list({ missionId: "m2" })).toEqual([]);

		const approved = registry.resolve(first.id, {
			status: "approved",
			resolvedBy: "operator",
			resolutionReason: "safe",
		});
		expect(approved).toBeDefined();

		expect(approved).toMatchObject({
			id: first.id,
			status: "approved",
			resolvedBy: "operator",
			resolutionReason: "safe",
		});
		expect(registry.list({ status: "pending" })).toEqual([second]);
		expect(registry.list({ status: "approved" })).toEqual([approved!]);
	});
});

describe("SessionToolGateway permissionMode", () => {
	it("default allow-all permits HIGH/CRITICAL seam tools without approval", async () => {
		const gateway = new SessionToolGateway();
		for (const tool of ["write", "edit", "ast_edit", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1" });
			expect(decision.allowed).toBe(true);
		}
	});

	it("enforce denies HIGH/CRITICAL seam tools without granted approval", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		for (const tool of ["write", "edit", "ast_edit", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1" });
			expect(decision.allowed).toBe(false);
			if (!decision.allowed) expect(decision.reason).toMatch(/approval/);
		}
	});

	it("enforce permits seam tools when approval is granted", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		for (const tool of ["write", "bash"]) {
			const decision = await gateway.decide(tool, { toolCallId: "t1", approvalGranted: true });
			expect(decision.allowed).toBe(true);
		}
	});

	it("enforce still permits MEDIUM tools without approval", async () => {
		const gateway = new SessionToolGateway({ permissionMode: "enforce" });
		const decision = await gateway.decide("github", { toolCallId: "t1" });
		expect(decision.allowed).toBe(true);
	});

	it("enforce with pending approvals records HIGH/CRITICAL denials and reuses the pending request", async () => {
		const pendingApprovals = new PendingApprovalRegistry();
		const gateway = new SessionToolGateway({ permissionMode: "enforce", pendingApprovals });
		const ctx = {
			toolCallId: "tool-approval-1",
			input: { path: "src/file.ts", content: "next" },
			mission: { missionId: "m1", taskId: "task-1", emit: () => undefined },
		};

		const denied = await gateway.decide("write", ctx);

		expect(denied).toMatchObject({
			allowed: false,
			code: "APPROVAL_REQUIRED",
		});
		expect(pendingApprovals.list()).toMatchObject([
			{
				id: "approval-1",
				status: "pending",
				tool: "write",
				toolCallId: "tool-approval-1",
				missionId: "m1",
				taskId: "task-1",
				riskLevel: "HIGH",
				inputSummary: '{"path":"src/file.ts","content":"next"}',
			},
		]);

		const repeated = await gateway.decide("write", ctx);

		expect(repeated).toMatchObject({
			allowed: false,
			code: "APPROVAL_REQUIRED",
		});
		expect(pendingApprovals.list()[0]?.id).toBe("approval-1");
		expect(pendingApprovals.list()).toHaveLength(1);
	});

	it("enforce with pending approvals allows retry after approval resolution", async () => {
		const pendingApprovals = new PendingApprovalRegistry();
		const gateway = new SessionToolGateway({ permissionMode: "enforce", pendingApprovals });
		const ctx = {
			toolCallId: "tool-approved",
			input: { path: "src/file.ts", content: "next" },
			mission: { missionId: "m1", taskId: "task-1", emit: () => undefined },
		};

		const denied = await gateway.decide("write", ctx);
		expect(denied).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });

		const approval = pendingApprovals.list({ toolCallId: "tool-approved" })[0];
		expect(approval).toBeDefined();
		pendingApprovals.resolve(approval.id, { status: "approved", resolvedBy: "operator" });

		const retry = await gateway.decide("write", ctx);

		expect(retry.allowed).toBe(true);
	});

	it.each([
		["rejected", "APPROVAL_REJECTED"],
		["cancelled", "APPROVAL_CANCELLED"],
	] as const)("enforce with pending approvals denies retry after %s resolution", async (status, code) => {
		const pendingApprovals = new PendingApprovalRegistry();
		const gateway = new SessionToolGateway({ permissionMode: "enforce", pendingApprovals });
		const ctx = {
			toolCallId: `tool-${status}`,
			input: { path: "src/file.ts", content: "next" },
			mission: { missionId: "m1", taskId: "task-1", emit: () => undefined },
		};

		const denied = await gateway.decide("write", ctx);
		expect(denied).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });

		const approval = pendingApprovals.list({ toolCallId: ctx.toolCallId })[0];
		expect(approval).toBeDefined();
		pendingApprovals.resolve(approval.id, { status, resolvedBy: "operator", resolutionReason: status });

		const retry = await gateway.decide("write", ctx);

		expect(retry).toMatchObject({
			allowed: false,
			code,
			reason: status,
		});
		expect(pendingApprovals.list()).toHaveLength(1);
	});

	it("enforce with pending approvals passes through direct grants without creating a request", async () => {
		const pendingApprovals = new PendingApprovalRegistry();
		const gateway = new SessionToolGateway({ permissionMode: "enforce", pendingApprovals });

		const decision = await gateway.decide("bash", {
			toolCallId: "tool-direct-grant",
			approvalGranted: true,
			input: { command: "bun test" },
			mission: { missionId: "m1", taskId: "task-1", emit: () => undefined },
		});

		expect(decision.allowed).toBe(true);
		expect(pendingApprovals.list()).toEqual([]);
	});
	it("lease denies seam mutation tools without a capability lease", async () => {
		const gateway = new SessionToolGateway({
			permissionMode: "lease",
			leaseDeps: { getMission: missionId => (missionId === "m1" ? mission() : undefined), now: Date.now },
		});
		const decision = await gateway.decide("write", { toolCallId: "t1" });
		expect(decision).toMatchObject({ allowed: false, code: "LEASE_REQUIRED" });
	});

	it("lease permits a seam mutation only when the capability lease matches the action binding", async () => {
		const missionControl = {
			getActiveMission: () => undefined,
			getMission: (missionId: string) => (missionId === "m1" ? mission() : undefined),
		} as unknown as MissionControlRuntime;
		const gateway = new SessionToolGateway({ permissionMode: "lease", missionControl });
		const capabilityLease = lease();

		const allowed = await gateway.decide("write", {
			toolCallId: "t1",
			agentRole: "orchestrator",
			capabilityLease,
			actionId: "action-1",
			planStepId: "step-1",
			mission: { missionId: "m1", emit: () => undefined },
		});
		expect(allowed.allowed).toBe(true);

		const denied = await gateway.decide("write", {
			toolCallId: "t2",
			agentRole: "orchestrator",
			capabilityLease,
			actionId: "other-action",
			planStepId: "step-1",
			mission: { missionId: "m1", emit: () => undefined },
		});
		expect(denied).toMatchObject({ allowed: false, code: "LEASE_ACTION_MISMATCH" });
	});
});

describe("SessionToolGateway changed artifact registry", () => {
	it("records successful write settlements with path and mission context", () => {
		const changedArtifacts = new ChangedArtifactRegistry();
		const gateway = new SessionToolGateway({ changedArtifacts });

		gateway.settle(
			"write",
			{
				toolCallId: "tool-1",
				input: { path: "src/file.ts", content: "next" },
				mission: { missionId: "m1", taskId: "task-1", emit: () => undefined },
			},
			"ok",
		);

		expect(changedArtifacts.snapshot()).toMatchObject([
			{
				tool: "write",
				toolCallId: "tool-1",
				missionId: "m1",
				taskId: "task-1",
				path: "src/file.ts",
				operation: "write",
				invalidatesWorkspace: false,
			},
		]);
	});

	it("records successful bash settlements as workspace invalidations without paths", () => {
		const changedArtifacts = new ChangedArtifactRegistry();
		const gateway = new SessionToolGateway({ changedArtifacts });

		gateway.settle("bash", { toolCallId: "tool-2", input: { command: "bun test" } }, "ok");

		expect(changedArtifacts.snapshot()).toMatchObject([
			{
				tool: "bash",
				toolCallId: "tool-2",
				operation: "invalidate",
				invalidatesWorkspace: true,
			},
		]);
		expect(changedArtifacts.snapshot()[0]).not.toHaveProperty("path");
	});

	it("does not record error settlements or untracked handled tools", () => {
		const changedArtifacts = new ChangedArtifactRegistry();
		const gateway = new SessionToolGateway({ changedArtifacts });

		gateway.settle("write", { toolCallId: "tool-3", input: { path: "src/file.ts" } }, "error");
		gateway.settle("github", { toolCallId: "tool-4", input: { path: "ignored" } }, "ok");

		expect(changedArtifacts.snapshot()).toEqual([]);
	});
});
