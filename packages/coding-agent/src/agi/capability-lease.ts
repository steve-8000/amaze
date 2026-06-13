import { templateFor } from "../mission/core/lifecycle-template";
import type { Mission } from "../mission/core/mission";
import type { MissionProposal } from "../mission/core/mission-proposal";
import type { ToolDescriptor, ToolRiskLevel } from "../tools/registry/tool-descriptor";

export type RuntimeActionMode = "dry-run" | "interactive" | "autonomous";

export type RuntimeRole =
	| "Planner"
	| "Researcher"
	| "Builder"
	| "Reviewer"
	| "Verifier"
	| "Critic"
	| "MemoryCurator"
	| "SRE"
	| "Security"
	| "orchestrator"
	| "subagent";

export interface ProposalLeaseIdentity {
	proposalId: string;
	artifactUri: string;
	contentHash: string;
	approvedBy: string;
	approvedAt: number;
	rollbackRefs: string[];
	evidenceRefs: string[];
}

export interface CapabilityLease {
	leaseId: string;
	missionId: string;
	objectiveContractId: string;
	planId: string;
	planStepId: string;
	actionId: string;
	mode: RuntimeActionMode;
	actorRole: RuntimeRole;
	allowedTools: string[];
	allowedRisk: ToolRiskLevel;
	mutationScope: {
		allowedPaths: string[];
		deniedPaths: string[];
		allowedServices: string[];
		allowedDataClasses: string[];
	};
	budget: {
		maxToolCalls: number;
		maxRetries: number;
		timeoutMs: number;
	};
	proposal?: ProposalLeaseIdentity;
	approval?: {
		approvalId: string;
		approvedBy: string;
		approvedAt: number;
		reason: string;
	};
	sandbox: {
		mode: "none" | "isolated-worktree" | "remote-sandbox";
		baselineRef?: string;
		rollbackRefs: string[];
	};
	evidenceContract: {
		requiredEventTypes: Array<"tool.requested" | "tool.denied" | "tool.completed" | "rollback.completed">;
		requiredEvidenceRefs: string[];
	};
	issuedAt: number;
	expiresAt: number;
	revokedAt?: number;
	revokedReason?: string;
}

export type LeaseAuthorizationDecision =
	| { allowed: true }
	| { allowed: false; code: string; reason: string; details?: Record<string, unknown> };

export const TOOL_RISK_ORDER: Record<ToolRiskLevel, number> = {
	LOW: 0,
	MEDIUM: 1,
	HIGH: 2,
	CRITICAL: 3,
};

export interface LeaseAuthorizationInput {
	lease: CapabilityLease;
	tool: Pick<ToolDescriptor, "name" | "riskLevel" | "mutatesWorkspace" | "requiresApproval">;
	mission: Pick<Mission, "id" | "mode" | "intent">;
	now: number;
	proposalRecord?: MissionProposal;
	computeArtifactHash?: (uri: string) => string;
}

export function missionRequiresProposal(mission: Pick<Mission, "intent">): boolean {
	return templateFor(mission.intent ?? "code_change").requireProposalBeforeMutation;
}

function missing(value: string | null | undefined): boolean {
	return typeof value !== "string" || value.length === 0;
}

function validateRequiredLeaseFields(lease: CapabilityLease): LeaseAuthorizationDecision {
	const missingFields: string[] = [];
	for (const field of ["leaseId", "missionId", "objectiveContractId", "planId", "planStepId", "actionId"] as const) {
		if (missing(lease[field])) missingFields.push(field);
	}
	if (!Number.isFinite(lease.expiresAt)) missingFields.push("expiresAt");
	if (missingFields.length > 0) {
		return {
			allowed: false,
			code: "LEASE_INCOMPLETE",
			reason: `capability lease missing required field(s): ${missingFields.join(", ")}`,
		};
	}
	return { allowed: true };
}

function validateProposalLease(input: LeaseAuthorizationInput): LeaseAuthorizationDecision {
	const { lease, proposalRecord } = input;
	const proposal = lease.proposal;
	if (!proposal || !proposalRecord) {
		return { allowed: false, code: "PROPOSAL_REQUIRED", reason: "proposal identity required" };
	}
	const missingFields: string[] = [];
	if (missing(proposal.proposalId)) missingFields.push("proposalId");
	if (missing(proposal.artifactUri)) missingFields.push("artifactUri");
	if (missing(proposal.contentHash)) missingFields.push("contentHash");
	if (missing(proposal.approvedBy)) missingFields.push("approvedBy");
	if (!Number.isFinite(proposal.approvedAt)) missingFields.push("approvedAt");
	if (!Array.isArray(proposal.rollbackRefs) || proposal.rollbackRefs.length === 0) missingFields.push("rollbackRefs");
	if (!Array.isArray(proposal.evidenceRefs) || proposal.evidenceRefs.length === 0) missingFields.push("evidenceRefs");
	if (missingFields.length > 0) {
		return {
			allowed: false,
			code: "PROPOSAL_INCOMPLETE",
			reason: `proposal lease identity missing required field(s): ${missingFields.join(", ")}`,
		};
	}
	if (proposalRecord.id !== proposal.proposalId || proposalRecord.status !== "approved") {
		return { allowed: false, code: "PROPOSAL_NOT_APPROVED", reason: "proposal is not approved" };
	}
	if (proposalRecord.missionId !== lease.missionId) {
		return { allowed: false, code: "PROPOSAL_MISSION_MISMATCH", reason: "proposal mission mismatch" };
	}
	if (proposalRecord.artifactUri !== proposal.artifactUri || proposalRecord.contentHash !== proposal.contentHash) {
		return {
			allowed: false,
			code: "PROPOSAL_RECORD_DRIFT",
			reason: "proposal record does not match leased artifact identity",
		};
	}
	const actualHash = input.computeArtifactHash?.(proposal.artifactUri);
	if (actualHash !== undefined && actualHash !== proposal.contentHash) {
		return {
			allowed: false,
			code: "PROPOSAL_ARTIFACT_DRIFT",
			reason: "proposal artifact hash mismatch",
			details: { expected: proposal.contentHash, actual: actualHash },
		};
	}
	return { allowed: true };
}

export function authorizeCapabilityLease(input: LeaseAuthorizationInput): LeaseAuthorizationDecision {
	const { lease, tool, mission, now } = input;
	const required = validateRequiredLeaseFields(lease);
	if (!required.allowed) return required;
	if (lease.revokedAt !== undefined) {
		return { allowed: false, code: "LEASE_REVOKED", reason: lease.revokedReason ?? "lease revoked" };
	}
	if (now > lease.expiresAt) return { allowed: false, code: "LEASE_EXPIRED", reason: "lease expired" };
	if (lease.missionId !== mission.id)
		return { allowed: false, code: "MISSION_MISMATCH", reason: "lease mission mismatch" };
	if (mission.mode === "auto" && lease.mode === "autonomous" && tool.mutatesWorkspace) {
		return {
			allowed: false,
			code: "AUTO_MISSION_NOT_AUTONOMOUS",
			reason: "ambient auto missions cannot mutate autonomously",
		};
	}
	if (!lease.allowedTools.includes(tool.name)) {
		return { allowed: false, code: "TOOL_NOT_LEASED", reason: `tool ${tool.name} not authorized` };
	}
	if (TOOL_RISK_ORDER[tool.riskLevel] > TOOL_RISK_ORDER[lease.allowedRisk]) {
		return { allowed: false, code: "RISK_EXCEEDS_LEASE", reason: `${tool.riskLevel} exceeds ${lease.allowedRisk}` };
	}
	if (
		(tool.riskLevel === "HIGH" || tool.riskLevel === "CRITICAL" || tool.requiresApproval) &&
		lease.mode !== "dry-run" &&
		!lease.approval
	) {
		return { allowed: false, code: "APPROVAL_REQUIRED", reason: "high-risk tool requires approval identity" };
	}
	if (missionRequiresProposal(mission)) {
		const proposal = validateProposalLease(input);
		if (!proposal.allowed) return proposal;
	}
	return { allowed: true };
}
