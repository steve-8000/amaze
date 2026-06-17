/// <reference types="node" />

import type { AcceptanceInput } from "../../shared/types.ts";
import type { PlanContractDagInput } from "../contract-dag.ts";

export type MissionSize = "micro" | "standard" | "large";
export type WorkPattern =
	| "bugfix"
	| "feature"
	| "refactor"
	| "migration"
	| "infra"
	| "test"
	| "docs"
	| "architecture"
	| "cleanup"
	| "performance"
	| "security";
export type RiskLevel = "low" | "medium" | "high";
export type BaseRuntime =
	| "micro-direct"
	| "standard-contract"
	| "large-mission"
	| "research-first"
	| "infra-k8s"
	| "architecture-design"
	| "emergency-hotfix"
	| "exploration-only";
export type ValidatorPack =
	| "basic-diff"
	| "standard-code"
	| "strict-boundary"
	| "integration-heavy"
	| "infra-k8s"
	| "security-audit"
	| "research-evidence"
	| "architecture-review";

export interface NormalizedRequest {
	raw_request: string;
	mentioned_paths: string[];
	keywords: string[];
	user_intent:
		| "modify_code"
		| "modify_infra_config"
		| "research"
		| "design"
		| "fix"
		| "test"
		| "docs"
		| "explore";
}

export interface MissionClassification {
	missionId: string;
	size: MissionSize;
	workPattern: WorkPattern;
	domains: string[];
	riskLevel: RiskLevel;
	requiresResearch: boolean;
	requiresScouter: boolean;
	mentionedPaths: string[];
	confidence: number;
	reason: string;
}

export interface ProfileRoute {
	baseRuntime: BaseRuntime;
	workPattern: WorkPattern;
	domainOverlays: string[];
	riskOverlay?: string;
	validatorPack: ValidatorPack;
	confidence: number;
	reason: string;
	fallbackRuntime: BaseRuntime;
}

export interface ProfileManifest {
	id: string;
	kind: "base_runtime" | "work_pattern" | "domain_overlay" | "validator_pack";
	summary: string;
	positive_triggers: string[];
	negative_triggers?: string[];
	cost_class: "low" | "medium" | "high";
	default_validator_pack?: ValidatorPack;
}

export interface RuntimeProfileBody {
	id: BaseRuntime;
	scouter: {
		depth: ExecutionPolicy["scouterPolicy"]["depth"];
		includeDependencyGraph?: boolean;
		includeSymbolGraph?: boolean;
		includeRecentChanges?: boolean;
	};
	researcher: {
		mode: ExecutionPolicy["researchPolicy"]["mode"];
		sourcePreference?: string[];
	};
	planner: {
		mode: ExecutionPolicy["plannerPolicy"]["mode"];
		maxInitialContracts: number;
		contractGranularity: ExecutionPolicy["plannerPolicy"]["contractGranularity"];
		allowParallelGroups?: boolean;
		requireChangeRequestsForCrossPath?: boolean;
	};
	context: {
		packetBudgetTokens: number;
		includePathMemory: boolean;
		includeResearch: boolean;
	};
	agents: {
		maxAgents: number;
		reuseExistingAgents: boolean;
		createMissingPathAgents: boolean;
		writeScope: "owned_path_only";
	};
	failure: ExecutionPolicy["failurePolicy"];
}

export interface WorkPatternProfile {
	id: WorkPattern;
	summary: string;
	contractSequence: string[];
}

export interface DomainOverlayProfile {
	id: string;
	summary: string;
	triggers: string[];
	policyHints?: Partial<Pick<ExecutionPolicy["contextPolicy"], "includePathMemory" | "includeResearch">>;
}

export interface ValidatorPackProfile {
	id: ValidatorPack;
	summary: string;
	acceptance: AcceptanceInput;
}

export interface ExecutionPolicy {
	missionId: string;
	runtime: BaseRuntime;
	workPattern: WorkPattern;
	domainOverlays: string[];
	validatorPack: ValidatorPack;
	scouterPolicy: {
		depth: "off" | "minimal" | "targeted" | "deep";
		includeDependencyGraph: boolean;
		includeSymbolGraph: boolean;
		includeRecentChanges: boolean;
	};
	researchPolicy: {
		mode: "off" | "on_demand" | "required" | "required_if_version_unknown";
		sourcePreference?: string[];
	};
	plannerPolicy: {
		mode: "direct_contract" | "contract_list" | "contract_dag" | "infra_contract" | "architecture_plan";
		maxInitialContracts: number;
		contractGranularity: "file" | "path" | "feature";
		allowParallelGroups: boolean;
		requireChangeRequestsForCrossPath: boolean;
		workPatternSequence: string[];
	};
	contextPolicy: {
		packetBudgetTokens: number;
		includePathMemory: boolean;
		includeResearch: boolean;
	};
	agentPolicy: {
		agentType: "path_specialist";
		maxAgents: number;
		reuseExistingAgents: boolean;
		createMissingPathAgents: boolean;
		writeScope: "owned_path_only";
	};
	failurePolicy: {
		sameWorkerRetries: number;
		validatorFailuresBeforeReplan: number;
		changeRequestsBeforeReplan: number;
		escalationRuntime?: BaseRuntime;
	};
	acceptance: AcceptanceInput;
}

export type MissionOrchestratorStatus =
	| "NEW"
	| "NORMALIZED"
	| "CLASSIFIED"
	| "PRE_ROUTED"
	| "EVIDENCE_COLLECTED"
	| "FINAL_ROUTED"
	| "POLICY_COMPILED"
	| "PLANNED"
	| "QUEUED"
	| "RUNNING"
	| "VALIDATING"
	| "CHECKPOINTED"
	| "COMPLETED"
	| "FAILED";

export interface MissionOrchestratorRecord {
	mission_id: string;
	status: MissionOrchestratorStatus;
	created_at: string;
	updated_at: string;
	route_changes: number;
	routing_history?: Array<{
		timestamp: string;
		reason: string;
		from_runtime?: BaseRuntime;
		to_runtime: BaseRuntime;
	}>;
	raw_request: string;
	normalized?: NormalizedRequest;
	classification?: MissionClassification;
	pre_route?: ProfileRoute;
	final_route?: ProfileRoute;
	execution_policy?: ExecutionPolicy;
	planner_input?: PlanContractDagInput;
	error?: string;
}
