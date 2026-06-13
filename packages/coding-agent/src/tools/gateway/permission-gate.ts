/**
 * Lane C1 — ToolGateway Skeleton.
 *
 * Minimal permission policy stub. The gateway consults a {@link PermissionGate}
 * before running a tool; the default policy grants LOW/MEDIUM and requires
 * `approvalGranted` (or `requiresApproval=false`) for HIGH/CRITICAL or any tool
 * flagged `requiresApproval`. This is a stub interface — Wave 3 (Lane H) wires
 * it to the real approval surface.
 */
import type { CapabilityLease, LeaseAuthorizationDecision } from "../../agi/capability-lease";
import { authorizeCapabilityLease } from "../../agi/capability-lease";
import type { Mission } from "../../mission/core/mission";
import type { MissionProposal } from "../../mission/core/mission-proposal";
import type { ToolDescriptor, ToolExecutionContext, ToolRiskLevel } from "../registry/tool-descriptor";

export interface PermissionDecision {
	allowed: boolean;
	/** Human-readable reason, populated when denied. */
	reason?: string;
	/** Stable policy denial code, populated by strict/lease-backed gates. */
	code?: string;
	/** Optional machine-readable policy details. */
	details?: Record<string, unknown>;
}

export interface PermissionGate {
	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext, riskLevel: ToolRiskLevel): PermissionDecision;
}

export interface CapabilityLeasePermissionGateDeps {
	getMission(missionId: string): Mission | undefined;
	getProposal?(proposalId: string): MissionProposal | undefined;
	now(): number;
	computeArtifactHash?(uri: string): string;
}

export interface LeasedToolExecutionContext extends ToolExecutionContext {
	capabilityLease: CapabilityLease;
	mission: NonNullable<ToolExecutionContext["mission"]>;
	actionId: string;
	planStepId: string;
}

/** Risk levels that require explicit approval under the default policy. */
const APPROVAL_REQUIRED_RISK: ReadonlySet<ToolRiskLevel> = new Set<ToolRiskLevel>(["HIGH", "CRITICAL"]);

export class DefaultPermissionGate implements PermissionGate {
	check(
		descriptor: ToolDescriptor<any, any>,
		ctx: ToolExecutionContext,
		riskLevel: ToolRiskLevel,
	): PermissionDecision {
		const needsApproval = descriptor.requiresApproval || APPROVAL_REQUIRED_RISK.has(riskLevel);
		if (needsApproval && !ctx.approvalGranted) {
			return {
				allowed: false,
				reason: `tool "${descriptor.name}" (${riskLevel}) requires approval; none granted`,
			};
		}
		return { allowed: true };
	}
}

/** A gate that allows everything — useful for tests and read-only flows. */
export class AllowAllPermissionGate implements PermissionGate {
	check(): PermissionDecision {
		return { allowed: true };
	}
}

/** Strict AGI permission seam: denies unless a full capability lease authorizes the tool. */
export class CapabilityLeasePermissionGate implements PermissionGate {
	readonly #deps: CapabilityLeasePermissionGateDeps;

	constructor(deps: CapabilityLeasePermissionGateDeps) {
		this.#deps = deps;
	}

	check(
		descriptor: ToolDescriptor<any, any>,
		ctx: ToolExecutionContext,
		riskLevel: ToolRiskLevel,
	): PermissionDecision {
		const lease = ctx.capabilityLease;
		if (!lease || typeof lease === "string") {
			return { allowed: false, code: "LEASE_REQUIRED", reason: "capability lease required" };
		}
		const bindingDecision = checkLeaseContextBinding(lease, ctx);
		if (!bindingDecision.allowed) return bindingDecision;
		const mission = this.#deps.getMission(lease.missionId);
		if (!mission)
			return { allowed: false, code: "MISSION_NOT_FOUND", reason: "mission not found for capability lease" };
		const decision = authorizeCapabilityLease({
			lease,
			tool: { ...descriptor, riskLevel },
			mission,
			now: this.#deps.now(),
			proposalRecord: lease.proposal ? this.#deps.getProposal?.(lease.proposal.proposalId) : undefined,
			computeArtifactHash: this.#deps.computeArtifactHash,
		});
		return toPermissionDecision(decision);
	}
}

export function checkCapabilityLeasePermission(
	descriptor: ToolDescriptor<any, any>,
	ctx: ToolExecutionContext,
	riskLevel: ToolRiskLevel,
	deps: CapabilityLeasePermissionGateDeps,
): PermissionDecision {
	return new CapabilityLeasePermissionGate(deps).check(descriptor, ctx, riskLevel);
}

function checkLeaseContextBinding(lease: CapabilityLease, ctx: ToolExecutionContext): PermissionDecision {
	if (ctx.actionId !== lease.actionId) {
		return {
			allowed: false,
			code: "LEASE_ACTION_MISMATCH",
			reason: "capability lease action binding mismatch",
		};
	}
	if (ctx.planStepId !== lease.planStepId) {
		return {
			allowed: false,
			code: "LEASE_PLAN_STEP_MISMATCH",
			reason: "capability lease plan step binding mismatch",
		};
	}
	if (ctx.mission?.missionId !== lease.missionId) {
		return {
			allowed: false,
			code: "LEASE_MISSION_CONTEXT_MISMATCH",
			reason: "capability lease mission context mismatch",
		};
	}
	return { allowed: true };
}

function toPermissionDecision(decision: LeaseAuthorizationDecision): PermissionDecision {
	if (decision.allowed) return { allowed: true };
	return {
		allowed: false,
		code: decision.code,
		reason: decision.reason,
		details: decision.details,
	};
}
