import { describe, expect, it } from "bun:test";
import { authorizeCapabilityLease, type CapabilityLease } from "../../src/agi/capability-lease";
import type { Mission } from "../../src/mission/core/mission";
import type { MissionProposal } from "../../src/mission/core/mission-proposal";
import { CapabilityLeasePermissionGate } from "../../src/tools/gateway/permission-gate";
import type { ToolDescriptor, ToolExecutionContext } from "../../src/tools/registry/tool-descriptor";

const now = 100;

function mission(overrides: Partial<Mission> = {}): Mission {
	return {
		id: "m1",
		title: "Mission",
		objective: "Objective",
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
		...overrides,
	};
}

function tool(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
	return {
		name: "write",
		toolClass: "legacy",
		domain: "filesystem",
		riskLevel: "HIGH",
		mutatesWorkspace: true,
		requiresApproval: false,
		supportsRollback: true,
		execute: async () => ({ ok: true, output: undefined }),
		...overrides,
	};
}

function lease(overrides: Partial<CapabilityLease> = {}): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: "m1",
		objectiveContractId: "objective-1",
		planId: "plan-1",
		planStepId: "step-1",
		actionId: "action-1",
		mode: "interactive",
		actorRole: "Builder",
		allowedTools: ["write"],
		allowedRisk: "HIGH",
		mutationScope: { allowedPaths: ["src/**"], deniedPaths: [], allowedServices: [], allowedDataClasses: [] },
		budget: { maxToolCalls: 1, maxRetries: 0, timeoutMs: 1000 },
		approval: { approvalId: "approval-1", approvedBy: "user", approvedAt: 50, reason: "approved" },
		sandbox: { mode: "isolated-worktree", baselineRef: "base", rollbackRefs: ["rollback://base"] },
		evidenceContract: {
			requiredEventTypes: ["tool.requested", "tool.completed"],
			requiredEvidenceRefs: ["evidence://1"],
		},
		issuedAt: 1,
		expiresAt: 200,
		...overrides,
	};
}

function proposal(overrides: Partial<MissionProposal> = {}): MissionProposal {
	return {
		id: "proposal-1",
		missionId: "m1",
		artifactUri: "local://PLAN.md",
		contentHash: "hash-1",
		status: "approved",
		approvedBy: "user",
		approvedAt: 50,
		summary: null,
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

describe("authorizeCapabilityLease", () => {
	it("allows a matching approved lease", () => {
		const decision = authorizeCapabilityLease({ lease: lease(), tool: tool(), mission: mission(), now });
		expect(decision.allowed).toBe(true);
	});

	it("denies a mutating tool when the lease grants no sandbox", () => {
		expect(
			authorizeCapabilityLease({
				lease: lease({ sandbox: { mode: "none", rollbackRefs: [] } }),
				tool: tool(),
				mission: mission(),
				now,
			}),
		).toMatchObject({ allowed: false, code: "SANDBOX_REQUIRED" });
	});

	it("allows a read-only tool without a sandbox grant", () => {
		const decision = authorizeCapabilityLease({
			lease: lease({
				allowedTools: ["read"],
				allowedRisk: "LOW",
				approval: undefined,
				sandbox: { mode: "none", rollbackRefs: [] },
			}),
			tool: tool({ name: "read", riskLevel: "LOW", mutatesWorkspace: false, supportsRollback: false }),
			mission: mission(),
			now,
		});
		expect(decision.allowed).toBe(true);
	});

	it("denies mission, tool, risk, expiration, revocation, and missing approval failures", () => {
		expect(
			authorizeCapabilityLease({ lease: lease({ missionId: "other" }), tool: tool(), mission: mission(), now }),
		).toMatchObject({ allowed: false, code: "MISSION_MISMATCH" });
		expect(
			authorizeCapabilityLease({ lease: lease({ allowedTools: ["read"] }), tool: tool(), mission: mission(), now }),
		).toMatchObject({ allowed: false, code: "TOOL_NOT_LEASED" });
		expect(
			authorizeCapabilityLease({ lease: lease({ allowedRisk: "MEDIUM" }), tool: tool(), mission: mission(), now }),
		).toMatchObject({ allowed: false, code: "RISK_EXCEEDS_LEASE" });
		expect(
			authorizeCapabilityLease({ lease: lease({ expiresAt: 99 }), tool: tool(), mission: mission(), now }),
		).toMatchObject({ allowed: false, code: "LEASE_EXPIRED" });
		expect(
			authorizeCapabilityLease({
				lease: lease({ revokedAt: 90, revokedReason: "stop" }),
				tool: tool(),
				mission: mission(),
				now,
			}),
		).toMatchObject({ allowed: false, code: "LEASE_REVOKED", reason: "stop" });
		expect(
			authorizeCapabilityLease({ lease: lease({ approval: undefined }), tool: tool(), mission: mission(), now }),
		).toMatchObject({ allowed: false, code: "APPROVAL_REQUIRED" });
	});

	it("denies autonomous workspace mutation for ambient auto missions", () => {
		const decision = authorizeCapabilityLease({
			lease: lease({ mode: "autonomous" }),
			tool: tool(),
			mission: mission({ mode: "auto" }),
			now,
		});
		expect(decision).toMatchObject({ allowed: false, code: "AUTO_MISSION_NOT_AUTONOMOUS" });
	});

	it("requires proposal artifact identity, current hash, and rollback refs for proposal-gated missions", () => {
		const proposalLease = lease({
			proposal: {
				proposalId: "proposal-1",
				artifactUri: "local://PLAN.md",
				contentHash: "hash-1",
				approvedBy: "user",
				approvedAt: 50,
				rollbackRefs: ["rollback://1"],
				evidenceRefs: ["evidence://1"],
			},
		});
		const proposalMission = mission({ intent: "architecture_change", proposalId: "proposal-1" });

		expect(
			authorizeCapabilityLease({
				lease: proposalLease,
				tool: tool(),
				mission: proposalMission,
				now,
				proposalRecord: proposal(),
				computeArtifactHash: () => "hash-1",
			}),
		).toMatchObject({ allowed: true });
		expect(authorizeCapabilityLease({ lease: lease(), tool: tool(), mission: proposalMission, now })).toMatchObject({
			allowed: false,
			code: "PROPOSAL_REQUIRED",
		});
		expect(
			authorizeCapabilityLease({
				lease: proposalLease,
				tool: tool(),
				mission: proposalMission,
				now,
				proposalRecord: proposal(),
				computeArtifactHash: () => "drift",
			}),
		).toMatchObject({ allowed: false, code: "PROPOSAL_ARTIFACT_DRIFT" });
		expect(
			authorizeCapabilityLease({
				lease: lease({ proposal: { ...proposalLease.proposal!, rollbackRefs: [] } }),
				tool: tool(),
				mission: proposalMission,
				now,
				proposalRecord: proposal(),
			}),
		).toMatchObject({ allowed: false, code: "PROPOSAL_INCOMPLETE" });
	});
});

describe("CapabilityLeasePermissionGate", () => {
	function leasedContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
		return {
			capabilityLease: lease(),
			actionId: "action-1",
			planStepId: "step-1",
			mission: { missionId: "m1", emit: () => undefined },
			...overrides,
		};
	}

	it("requires context action, plan step, and mission bindings to match the lease", () => {
		const gate = new CapabilityLeasePermissionGate({ getMission: () => mission(), now: () => now });

		expect(gate.check(tool(), leasedContext(), "HIGH")).toEqual({ allowed: true });
		expect(gate.check(tool(), leasedContext({ actionId: "action-2" }), "HIGH")).toMatchObject({
			allowed: false,
			code: "LEASE_ACTION_MISMATCH",
		});
		expect(gate.check(tool(), leasedContext({ planStepId: "step-2" }), "HIGH")).toMatchObject({
			allowed: false,
			code: "LEASE_PLAN_STEP_MISMATCH",
		});
		expect(
			gate.check(tool(), leasedContext({ mission: { missionId: "m2", emit: () => undefined } }), "HIGH"),
		).toMatchObject({
			allowed: false,
			code: "LEASE_MISSION_CONTEXT_MISMATCH",
		});
		expect(gate.check(tool(), leasedContext({ mission: undefined }), "HIGH")).toMatchObject({
			allowed: false,
			code: "LEASE_MISSION_CONTEXT_MISMATCH",
		});
	});
});
