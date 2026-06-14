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
import type { PendingApprovalRegistry, PendingApprovalStatus } from "./pending-approvals";

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

export interface ApprovalPermissionGateOptions {
	registry: PendingApprovalRegistry;
	defaultGate?: PermissionGate;
}

/** Permission gate that records operator approval requests instead of hard-denying silently. */
export class ApprovalPermissionGate implements PermissionGate {
	readonly #registry: PendingApprovalRegistry;
	readonly #defaultGate: PermissionGate;

	constructor(options: ApprovalPermissionGateOptions) {
		this.#registry = options.registry;
		this.#defaultGate = options.defaultGate ?? new DefaultPermissionGate();
	}

	check(
		descriptor: ToolDescriptor<any, any>,
		ctx: ToolExecutionContext,
		riskLevel: ToolRiskLevel,
	): PermissionDecision {
		const defaultDecision = this.#defaultGate.check(descriptor, ctx, riskLevel);
		if (defaultDecision.allowed || ctx.approvalGranted) return defaultDecision;

		const toolCallId = ctx.toolCallId;
		if (!toolCallId) return defaultDecision;

		const existing = this.#registry.list({ toolCallId })[0];
		if (existing?.status === "approved") return { allowed: true };
		if (existing?.status === "rejected" || existing?.status === "cancelled") {
			return {
				allowed: false,
				code: approvalDenialCode(existing.status),
				reason: existing.resolutionReason ?? `approval ${existing.status} for tool "${descriptor.name}"`,
				details: { approvalId: existing.id, status: existing.status },
			};
		}

		const request = this.#registry.request({
			tool: descriptor.name,
			toolCallId,
			missionId: ctx.mission?.missionId,
			taskId: ctx.mission?.taskId,
			riskLevel,
			reason: defaultDecision.reason ?? `tool "${descriptor.name}" (${riskLevel}) requires approval; none granted`,
			inputSummary: summarizeApprovalInput(ctx.input),
		});
		return {
			allowed: false,
			code: "APPROVAL_REQUIRED",
			reason: request.reason,
			details: { approvalId: request.id, status: request.status },
		};
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

function approvalDenialCode(status: Exclude<PendingApprovalStatus, "pending" | "approved">): string {
	return status === "rejected" ? "APPROVAL_REJECTED" : "APPROVAL_CANCELLED";
}

function summarizeApprovalInput(input: unknown): string | undefined {
	if (input === undefined) return undefined;
	if (typeof input === "string") return truncate(input);
	try {
		return truncate(JSON.stringify(input));
	} catch {
		return truncate(String(input));
	}
}

function truncate(value: string, maxLength = 500): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
