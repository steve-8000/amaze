import type { ObjectiveContract, RuntimeAction, RuntimeRole } from "../autonomy/types";
import type { Mission } from "../mission/core/mission";
import type { CapabilityLease } from "./capability-lease";

export interface RoleExecutionResult {
	actionId: string;
	status: "succeeded" | "failed" | "blocked";
	evidenceRefs: string[];
	error?: string;
}

export interface RoleExecutor {
	execute(input: {
		action: RuntimeAction;
		lease: CapabilityLease;
		mission: Mission;
		contract: ObjectiveContract;
	}): Promise<RoleExecutionResult>;
}

const COMPLETION_APPROVAL_ROLES = new Set<RuntimeRole>(["Verifier"]);

export function assertRoleLeaseAlignment(
	action: RuntimeAction,
	lease: CapabilityLease,
	contract: ObjectiveContract,
): void {
	if (lease.actionId !== action.id) throw new Error("Lease/action mismatch");
	if (lease.planStepId !== action.stepId) throw new Error("Lease/plan step mismatch");
	if (lease.actorRole !== action.role) throw new Error("Lease role does not match runtime action role");
	const capability = contract.rolePolicy.capabilities.find(candidate => candidate.role === action.role);
	if (!capability) throw new Error(`No role capability configured for ${action.role}`);
	for (const tool of lease.allowedTools) {
		if (!capability.allowedTools.includes(tool))
			throw new Error(`Tool ${tool} is not allowed for role ${action.role}`);
	}
}

export function roleCanApproveCompletion(role: RuntimeRole): boolean {
	return COMPLETION_APPROVAL_ROLES.has(role);
}

export class GuardedRoleExecutor implements RoleExecutor {
	readonly #delegate: RoleExecutor;

	constructor(delegate: RoleExecutor) {
		this.#delegate = delegate;
	}

	async execute(input: {
		action: RuntimeAction;
		lease: CapabilityLease;
		mission: Mission;
		contract: ObjectiveContract;
	}): Promise<RoleExecutionResult> {
		assertRoleLeaseAlignment(input.action, input.lease, input.contract);
		return this.#delegate.execute(input);
	}
}
