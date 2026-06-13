import type {
	ContractiblePlanStep,
	EvidenceKind,
	ObjectiveContract,
	ObjectiveCriterion,
	ObjectiveScopeGuard,
	RoleCapability,
	RolePolicy,
	RuntimeAction,
	RuntimeRole,
} from "../autonomy/types";

export class RoleRouterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RoleRouterError";
	}
}

export function routePlanStepToAction(args: {
	contract: ObjectiveContract;
	missionId: string;
	planId: string;
	step: ContractiblePlanStep;
	modelRoles: Record<string, string>;
}): RuntimeAction {
	const role = selectRuntimeRole(args.step, args.contract.rolePolicy);
	const capability = capabilityForRole(args.contract.rolePolicy, role);
	assertModelRoleConfigured(args.modelRoles, capability.modelRole);
	assertStepWithinScope(args.step, args.contract.scopeGuard);
	assertCapabilityAllowsStep(capability, args.step);

	return {
		id: `${args.missionId}:${args.step.id}`,
		missionId: args.missionId,
		objectiveContractId: args.contract.id,
		planId: args.planId,
		stepId: args.step.id,
		role,
		instruction: args.step.description,
		dependencies: args.step.dependsOn ?? [],
		scopeGuard: args.contract.scopeGuard,
		budgetGuard: args.contract.budgetGuard,
		acceptanceCriteria: criteriaForStep(args.contract, args.step),
		requiredEvidence: evidenceForStep(args.contract, args.step),
		status: "queued",
	};
}

export function selectRuntimeRole(step: ContractiblePlanStep, policy: RolePolicy): RuntimeRole {
	if (step.roleHint) return step.roleHint;
	const role = policy.defaultRoleByStepKind[step.kind] ?? policy.defaultRoleByStepKind.default;
	if (!role) throw new RoleRouterError(`No runtime role configured for step kind: ${step.kind}`);
	return role;
}

export function capabilityForRole(policy: RolePolicy, role: RuntimeRole): RoleCapability {
	const capability = policy.capabilities.find(item => item.role === role);
	if (!capability) throw new RoleRouterError(`No capability configured for role: ${role}`);
	return capability;
}

export function assertModelRoleConfigured(modelRoles: Record<string, string>, modelRole: string): void {
	if (!modelRoles[modelRole]) throw new RoleRouterError(`Model role is not configured: ${modelRole}`);
}

export function assertStepWithinScope(step: ContractiblePlanStep, scopeGuard: ObjectiveScopeGuard): void {
	for (const forbiddenAction of scopeGuard.forbiddenActions) {
		if (step.kind === forbiddenAction) throw new RoleRouterError(`Step action is forbidden: ${step.kind}`);
	}
	for (const target of step.touches ?? []) {
		if (scopeGuard.exclude.some(pattern => pathMatches(pattern, target))) {
			throw new RoleRouterError(`Step target is excluded by scope guard: ${target}`);
		}
		if (scopeGuard.include.length > 0 && !scopeGuard.include.some(pattern => pathMatches(pattern, target))) {
			throw new RoleRouterError(`Step target is outside scope guard: ${target}`);
		}
	}
}

export function assertCapabilityAllowsStep(capability: RoleCapability, step: ContractiblePlanStep): void {
	if (!capability.canRead) throw new RoleRouterError(`Role cannot read: ${capability.role}`);
	if (step.requiresWrite && !capability.canWriteRepository) {
		throw new RoleRouterError(`Role cannot write repository: ${capability.role}`);
	}
	if (step.requiresCommands && !capability.canRunCommands) {
		throw new RoleRouterError(`Role cannot run commands: ${capability.role}`);
	}
	if (step.requiresInfrastructure && !capability.canOperateInfrastructure) {
		throw new RoleRouterError(`Role cannot operate infrastructure: ${capability.role}`);
	}
}

export function criteriaForStep(contract: ObjectiveContract, step: ContractiblePlanStep): ObjectiveCriterion[] {
	if (!step.acceptanceCriteria || step.acceptanceCriteria.length === 0) return contract.acceptanceCriteria;
	const criteriaById = new Map(contract.acceptanceCriteria.map(criterion => [criterion.id, criterion]));
	return step.acceptanceCriteria.map(id => {
		const criterion = criteriaById.get(id);
		if (!criterion) throw new RoleRouterError(`Unknown acceptance criterion for step ${step.id}: ${id}`);
		return criterion;
	});
}

export function evidenceForStep(contract: ObjectiveContract, step: ContractiblePlanStep): EvidenceKind[] {
	if (step.requiredEvidence && step.requiredEvidence.length > 0) return uniqueEvidence(step.requiredEvidence);
	return uniqueEvidence(
		criteriaForStep(contract, step).flatMap(
			criterion => contract.requiredEvidence[criterion.id] ?? criterion.evidenceKinds,
		),
	);
}

function uniqueEvidence(evidenceKinds: EvidenceKind[]): EvidenceKind[] {
	return [...new Set(evidenceKinds)];
}

function pathMatches(pattern: string, target: string): boolean {
	if (pattern === "**" || pattern === "*") return true;
	if (pattern.endsWith("/**")) return target === pattern.slice(0, -3) || target.startsWith(pattern.slice(0, -2));
	if (pattern.endsWith("/*")) {
		const prefix = pattern.slice(0, -1);
		return target.startsWith(prefix) && !target.slice(prefix.length).includes("/");
	}
	return target === pattern || target.startsWith(`${pattern}/`);
}
