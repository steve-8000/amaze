import { describe, expect, it } from "bun:test";
import type { CapabilityLease } from "../../../src/agi/capability-lease";
import type { Mission } from "../../../src/mission/core/mission";
import type { MissionControlRuntime } from "../../../src/mission/core/mission-control-runtime";
import { SessionToolGateway } from "../../../src/tools/gateway/session-gateway";

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
