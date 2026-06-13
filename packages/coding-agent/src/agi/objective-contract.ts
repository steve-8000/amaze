import type {
	AutonomyMode,
	EvidenceKind,
	ObjectiveContract,
	ObjectiveRisk,
	ObjectiveVerificationMode,
	RoleCapability,
	RuntimeRole,
} from "../autonomy/types";

const AUTONOMY_MODES = new Set<AutonomyMode>(["manual", "supervised", "autonomous", "continuous"]);
const EVIDENCE_KINDS = new Set<EvidenceKind>([
	"source_diff",
	"test_output",
	"review_finding",
	"browser_trace",
	"runtime_metric",
	"citation",
	"deployment_health",
	"security_scan",
]);
const RUNTIME_ROLES = new Set<RuntimeRole>([
	"Planner",
	"Researcher",
	"Builder",
	"Reviewer",
	"Verifier",
	"Critic",
	"MemoryCurator",
	"SRE",
	"Security",
]);
const RISKS = new Set<ObjectiveRisk>(["low", "medium", "high", "critical"]);
const VERIFICATION_MODES = new Set<ObjectiveVerificationMode>(["deterministic", "semantic", "human", "hybrid"]);

export class ObjectiveContractValidationError extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super(`Invalid ObjectiveContract: ${issues.join("; ")}`);
		this.name = "ObjectiveContractValidationError";
		this.issues = issues;
	}
}

export interface ObjectiveCompilerModel {
	compile(input: { goal: string; criteria: string[]; constraints: string[]; mode?: AutonomyMode }): Promise<unknown>;
}

export async function compileObjectiveContract(input: {
	goal: string;
	operatorCriteria?: string[];
	constraints?: string[];
	mode?: AutonomyMode;
	llm: ObjectiveCompilerModel;
}): Promise<ObjectiveContract> {
	const draft = await input.llm.compile({
		goal: input.goal,
		criteria: input.operatorCriteria ?? [],
		constraints: input.constraints ?? [],
		mode: input.mode,
	});
	return assertValidObjectiveContract(draft);
}

export function assertValidObjectiveContract(value: unknown): ObjectiveContract {
	const issues = validateObjectiveContract(value);
	if (issues.length > 0) {
		throw new ObjectiveContractValidationError(issues);
	}
	return value as ObjectiveContract;
}

export function validateObjectiveContract(value: unknown): string[] {
	const issues: string[] = [];
	if (!isRecord(value)) return ["contract must be an object"];

	requireNonEmptyString(value.id, "id", issues);
	requireNonEmptyString(value.objective, "objective", issues);
	requireStringArray(value.nonGoals, "nonGoals", issues);
	validateCriteria(value.acceptanceCriteria, issues);
	validateRequiredEvidence(value.requiredEvidence, value.acceptanceCriteria, issues);
	validateScopeGuard(value.scopeGuard, issues);
	validateBudgetGuard(value.budgetGuard, issues);
	if (!AUTONOMY_MODES.has(value.autonomyMode as AutonomyMode)) issues.push("autonomyMode is required");
	if (!RISKS.has(value.risk as ObjectiveRisk)) issues.push("risk is required");
	validateFreshnessPolicy(value.freshnessPolicy, issues);
	validateRolePolicy(value.rolePolicy, issues);

	return issues;
}

function validateCriteria(value: unknown, issues: string[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push("acceptanceCriteria must contain at least one criterion");
		return;
	}
	const ids = new Set<string>();
	value.forEach((criterion, index) => {
		const path = `acceptanceCriteria[${index}]`;
		if (!isRecord(criterion)) {
			issues.push(`${path} must be an object`);
			return;
		}
		requireNonEmptyString(criterion.id, `${path}.id`, issues);
		if (typeof criterion.id === "string") {
			if (ids.has(criterion.id)) issues.push(`${path}.id must be unique`);
			ids.add(criterion.id);
		}
		requireNonEmptyString(criterion.description, `${path}.description`, issues);
		if (typeof criterion.required !== "boolean") issues.push(`${path}.required must be boolean`);
		validateEvidenceKinds(criterion.evidenceKinds, `${path}.evidenceKinds`, issues);
		if (!RUNTIME_ROLES.has(criterion.ownerRole as RuntimeRole)) issues.push(`${path}.ownerRole is invalid`);
		if (!VERIFICATION_MODES.has(criterion.verification as ObjectiveVerificationMode)) {
			issues.push(`${path}.verification is invalid`);
		}
	});
}

function validateRequiredEvidence(value: unknown, criteria: unknown, issues: string[]): void {
	if (!isRecord(value)) {
		issues.push("requiredEvidence must be an object");
		return;
	}
	const criterionIds = Array.isArray(criteria)
		? new Set(
				criteria
					.filter(isRecord)
					.map(criterion => criterion.id)
					.filter((id): id is string => typeof id === "string"),
			)
		: new Set<string>();
	for (const [criterionId, evidenceKinds] of Object.entries(value)) {
		if (!criterionIds.has(criterionId)) issues.push(`requiredEvidence.${criterionId} has no matching criterion`);
		validateEvidenceKinds(evidenceKinds, `requiredEvidence.${criterionId}`, issues);
	}
	for (const criterionId of criterionIds) {
		if (!(criterionId in value)) issues.push(`requiredEvidence.${criterionId} is required`);
	}
}

function validateScopeGuard(value: unknown, issues: string[]): void {
	if (!isRecord(value)) {
		issues.push("scopeGuard is required");
		return;
	}
	requireStringArray(value.include, "scopeGuard.include", issues, { nonEmpty: true });
	requireStringArray(value.exclude, "scopeGuard.exclude", issues);
	requireStringArray(value.allowedCommands, "scopeGuard.allowedCommands", issues);
	requireStringArray(value.forbiddenActions, "scopeGuard.forbiddenActions", issues);
}

function validateBudgetGuard(value: unknown, issues: string[]): void {
	if (!isRecord(value)) {
		issues.push("budgetGuard is required");
		return;
	}
	requirePositiveInteger(value.maxRuntimeActions, "budgetGuard.maxRuntimeActions", issues);
	requirePositiveInteger(value.maxRetriesPerAction, "budgetGuard.maxRetriesPerAction", issues, { allowZero: true });
	requirePositiveInteger(value.maxParallelActions, "budgetGuard.maxParallelActions", issues);
	if (value.modelProfile !== undefined && typeof value.modelProfile !== "string") {
		issues.push("budgetGuard.modelProfile must be a string");
	}
}

function validateFreshnessPolicy(value: unknown, issues: string[]): void {
	if (value === undefined) return;
	if (!isRecord(value)) {
		issues.push("freshnessPolicy must be an object");
		return;
	}
	if (typeof value.researchRequired !== "boolean") issues.push("freshnessPolicy.researchRequired must be boolean");
	if (value.maxSourceAgeDays !== undefined) {
		requirePositiveInteger(value.maxSourceAgeDays, "freshnessPolicy.maxSourceAgeDays", issues);
	}
}

function validateRolePolicy(value: unknown, issues: string[]): void {
	if (!isRecord(value)) {
		issues.push("rolePolicy is required");
		return;
	}
	if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
		issues.push("rolePolicy.capabilities must contain at least one capability");
	} else {
		for (const [index, capability] of value.capabilities.entries()) {
			validateRoleCapability(capability, `rolePolicy.capabilities[${index}]`, issues);
		}
	}
	if (!isRecord(value.defaultRoleByStepKind)) {
		issues.push("rolePolicy.defaultRoleByStepKind is required");
	} else {
		for (const [kind, role] of Object.entries(value.defaultRoleByStepKind)) {
			if (kind.trim() === "") issues.push("rolePolicy.defaultRoleByStepKind cannot contain an empty step kind");
			if (!RUNTIME_ROLES.has(role as RuntimeRole))
				issues.push(`rolePolicy.defaultRoleByStepKind.${kind} is invalid`);
		}
	}
	validateRiskArray(value.requireReviewerForRisk, "rolePolicy.requireReviewerForRisk", issues);
	requireStringArray(value.requireSecurityFor, "rolePolicy.requireSecurityFor", issues);
	requireStringArray(value.requireSreFor, "rolePolicy.requireSreFor", issues);
}

function validateRoleCapability(value: unknown, path: string, issues: string[]): void {
	if (!isRecord(value)) {
		issues.push(`${path} must be an object`);
		return;
	}
	if (!RUNTIME_ROLES.has(value.role as RuntimeRole)) issues.push(`${path}.role is invalid`);
	requireNonEmptyString(value.modelRole, `${path}.modelRole`, issues);
	for (const key of [
		"canRead",
		"canWriteRepository",
		"canRunCommands",
		"canOperateInfrastructure",
		"canApproveCompletion",
	] satisfies Array<keyof RoleCapability>) {
		if (typeof value[key] !== "boolean") issues.push(`${path}.${key} must be boolean`);
	}
	requireStringArray(value.allowedTools, `${path}.allowedTools`, issues);
}

function validateEvidenceKinds(value: unknown, path: string, issues: string[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(`${path} must contain at least one evidence kind`);
		return;
	}
	for (const evidenceKind of value) {
		if (!EVIDENCE_KINDS.has(evidenceKind as EvidenceKind)) issues.push(`${path} contains invalid evidence kind`);
	}
}

function validateRiskArray(value: unknown, path: string, issues: string[]): void {
	if (!Array.isArray(value)) {
		issues.push(`${path} must be an array`);
		return;
	}
	for (const risk of value) {
		if (!RISKS.has(risk as ObjectiveRisk)) issues.push(`${path} contains invalid risk`);
	}
}

function requireNonEmptyString(value: unknown, path: string, issues: string[]): void {
	if (typeof value !== "string" || value.trim() === "") issues.push(`${path} is required`);
}

function requireStringArray(value: unknown, path: string, issues: string[], opts: { nonEmpty?: boolean } = {}): void {
	if (!Array.isArray(value)) {
		issues.push(`${path} must be an array`);
		return;
	}
	if (opts.nonEmpty && value.length === 0) issues.push(`${path} must contain at least one value`);
	for (const item of value) {
		if (typeof item !== "string") issues.push(`${path} must contain only strings`);
	}
}

function requirePositiveInteger(
	value: unknown,
	path: string,
	issues: string[],
	opts: { allowZero?: boolean } = {},
): void {
	const min = opts.allowZero ? 0 : 1;
	if (!Number.isInteger(value) || (value as number) < min) issues.push(`${path} must be an integer >= ${min}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
