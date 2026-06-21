import type { PlanContractDagInput } from "../contract-dag.ts";
import type { FreshBootContract } from "../fresh-boot-contract.ts";
export type MissionSize = "micro" | "standard" | "large";
export type WorkPattern =
	| "implementation"
	| "feature"
	| "bugfix"
	| "refactor"
	| "research"
	| "docs"
	| "test"
	| "architecture"
	| "exploration"
	| "infra"
	| "security";
export type RiskLevel = "low" | "medium" | "high";

export interface NormalizedRequest {
	raw_request: string;
	mentioned_paths: string[];
	keywords: string[];
	user_intent: "modify_code" | "fix" | "research" | "design" | "modify_infra_config" | "test" | "docs" | "explore";
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

export type MissionStatus =
	| "REQUEST_NORMALIZED"
	| "CLASSIFIED"
	| "PRE_ROUTED"
	| "FINAL_ROUTED"
	| "POLICY_COMPILED"
	| "PLANNED"
	| "QUEUED"
	| "RUNNING"
	| "CHECKPOINTED"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED";

export interface DirectMissionRoute {
	mode: "agent_direct";
	agent: string;
	confidence: number;
	reason: string;
}

export interface ExecutionPolicy {
	missionId: string;
	route: DirectMissionRoute;
	classification: MissionClassification;
	acceptanceLevel: "none" | "attested" | "checked" | "verified" | "reviewed";
	validationLevel: "none" | "attested" | "checked" | "verified" | "reviewed";
	outputContract: "none" | "attestation" | "structured";
	stopRules: string[];
	contractTemplate: {
		agent: string;
		task: string;
		bootContract?: FreshBootContract;
	};
}

export interface MissionOrchestratorRecord {
	mission_id: string;
	status: MissionStatus;
	created_at: string;
	updated_at: string;
	route_changes: number;
	raw_request?: string;
	normalized_request?: NormalizedRequest;
	classification?: MissionClassification;
	pre_route?: DirectMissionRoute;
	final_route?: DirectMissionRoute;
	routing_history?: Array<{
		timestamp?: string;
		at?: string;
		reason: string;
		from_agent?: string;
		to_agent: string;
	}>;
	execution_policy?: ExecutionPolicy;
	planner_input?: PlanContractDagInput;
}
