export type ObjectiveStatus = "active" | "paused" | "completed" | "cancelled";

export interface ObjectiveMetricTarget {
	metric: string;
	target: number;
	direction: "down" | "up";
	deadline?: number;
}

export interface ObjectiveBudget {
	tokens?: number;
	usd?: number;
	wallClockMs?: number;
}

export interface ObjectiveGuardrails {
	requireHumanForApply: boolean;
	maxAutoSubgoalsPerDay: number;
	forbiddenScopes: string[];
}

export interface Objective {
	id: string;
	title: string;
	metricTargets: ObjectiveMetricTarget[];
	budget: ObjectiveBudget;
	guardrails: ObjectiveGuardrails;
	status: ObjectiveStatus;
	priority?: number;
	recurrence?: {
		kind: "none" | "interval" | "cron";
		intervalMs?: number;
		cron?: string;
	};
	progress?: {
		score: number;
		lastMeasuredAt: number;
		evidenceRefs: string[];
	};
	parentObjectiveId?: string;
	mergedIntoObjectiveId?: string;
	retiredAt?: number;
	retirementReason?: string;
}

export interface ObjectiveEvent {
	objectiveId: string;
	ts: number;
	kind: string;
	payload: Record<string, unknown>;
}

export type NewObjective = Omit<Objective, "id" | "status" | "guardrails"> & {
	id?: string;
	status?: ObjectiveStatus;
	guardrails?: Partial<ObjectiveGuardrails>;
};

export type AutonomyMode = "manual" | "supervised" | "autonomous" | "continuous";

export type EvidenceKind =
	| "source_diff"
	| "test_output"
	| "review_finding"
	| "browser_trace"
	| "runtime_metric"
	| "citation"
	| "deployment_health"
	| "security_scan";

export type RuntimeRole =
	| "Planner"
	| "Researcher"
	| "Builder"
	| "Reviewer"
	| "Verifier"
	| "Critic"
	| "MemoryCurator"
	| "SRE"
	| "Security";

export type ObjectiveRisk = "low" | "medium" | "high" | "critical";
export type ObjectiveVerificationMode = "deterministic" | "semantic" | "human" | "hybrid";

export interface ObjectiveCriterion {
	id: string;
	description: string;
	required: boolean;
	evidenceKinds: EvidenceKind[];
	ownerRole: RuntimeRole;
	verification: ObjectiveVerificationMode;
}

export interface ObjectiveScopeGuard {
	include: string[];
	exclude: string[];
	allowedCommands: string[];
	forbiddenActions: string[];
}

export interface ObjectiveBudgetGuard {
	maxRuntimeActions: number;
	maxRetriesPerAction: number;
	maxParallelActions: number;
	modelProfile?: string;
}

export interface ObjectiveFreshnessPolicy {
	researchRequired: boolean;
	maxSourceAgeDays?: number;
}

export interface RoleCapability {
	role: RuntimeRole;
	modelRole: string;
	canRead: boolean;
	canWriteRepository: boolean;
	canRunCommands: boolean;
	canOperateInfrastructure: boolean;
	canApproveCompletion: boolean;
	allowedTools: string[];
}

export interface RolePolicy {
	capabilities: RoleCapability[];
	defaultRoleByStepKind: Record<string, RuntimeRole>;
	requireReviewerForRisk: ObjectiveRisk[];
	requireSecurityFor: string[];
	requireSreFor: string[];
}

export interface ObjectiveContract {
	id: string;
	objective: string;
	nonGoals: string[];
	acceptanceCriteria: ObjectiveCriterion[];
	requiredEvidence: Record<string, EvidenceKind[]>;
	scopeGuard: ObjectiveScopeGuard;
	budgetGuard: ObjectiveBudgetGuard;
	autonomyMode: AutonomyMode;
	risk: ObjectiveRisk;
	freshnessPolicy?: ObjectiveFreshnessPolicy;
	rolePolicy: RolePolicy;
}

export interface ContractiblePlanStep {
	id: string;
	kind: string;
	description: string;
	dependsOn?: string[];
	roleHint?: RuntimeRole;
	touches?: string[];
	requiresWrite?: boolean;
	requiresCommands?: boolean;
	requiresInfrastructure?: boolean;
	acceptanceCriteria?: string[];
	requiredEvidence?: EvidenceKind[];
}

export type RuntimeActionStatus = "queued" | "running" | "blocked" | "succeeded" | "failed" | "verified";

export interface RuntimeAction {
	id: string;
	missionId: string;
	objectiveContractId: string;
	planId: string;
	stepId: string;
	role: RuntimeRole;
	instruction: string;
	dependencies: string[];
	scopeGuard: ObjectiveScopeGuard;
	budgetGuard: ObjectiveBudgetGuard;
	acceptanceCriteria: ObjectiveCriterion[];
	requiredEvidence: EvidenceKind[];
	status: RuntimeActionStatus;
}
