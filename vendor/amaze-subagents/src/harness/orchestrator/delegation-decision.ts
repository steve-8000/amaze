/// <reference types="node" />

import { startMission, type StartMissionOptions, type StartMissionResult } from "./mission-orchestrator.ts";

export type DelegationDecisionMode = "parent_direct" | "parent_guided_roles" | "external_delegation_recommended";
export type DelegationDecisionRoleName = "scout" | "planner" | "worker" | "reviewer";

export interface DelegationDecisionRole {
	role: DelegationDecisionRoleName;
	profile: string;
	assignedPath: string;
	required: boolean;
	reason: string;
}

export interface DelegationDecision {
	missionId: string;
	mode: DelegationDecisionMode;
	baseRuntime: StartMissionResult["route"]["baseRuntime"];
	workPattern: StartMissionResult["route"]["workPattern"];
	validatorPack: StartMissionResult["route"]["validatorPack"];
	domainOverlays: string[];
	confidence: number;
	reason: string;
	roles: DelegationDecisionRole[];
	parentInstructions: string[];
	verification: {
		level: string;
		evidence: string[];
	};
}

function normalizeAssignedPath(paths: string[]): string {
	const first = paths.find((item) => item.trim().length > 0)?.replace(/\/$/, "");
	return first && !first.includes("*") ? first : ".";
}

function workerAssignedPaths(paths: string[]): string[] {
	const normalized = paths
		.map((item) => normalizeAssignedPath([item]))
		.filter((item) => item.length > 0);
	const unique = [...new Set(normalized)];
	return unique.length > 0 ? unique : ["."];
}

function shouldStayParentDirect(started: StartMissionResult): boolean {
	return started.route.baseRuntime === "micro-direct"
		&& started.policy.plannerPolicy.mode === "direct_contract"
		&& (started.policy.scouterPolicy.depth === "off" || started.policy.scouterPolicy.depth === "minimal")
		&& started.policy.agentPolicy.maxAgents <= 1;
}

function decisionMode(started: StartMissionResult): DelegationDecisionMode {
	if (shouldStayParentDirect(started)) return "parent_direct";
	if (started.route.baseRuntime === "large-mission" || started.policy.agentPolicy.maxAgents > 3) {
		return "external_delegation_recommended";
	}
	return "parent_guided_roles";
}

function acceptanceLevel(started: StartMissionResult): string {
	const acceptance = started.policy.acceptance;
	if (!acceptance || typeof acceptance === "string") return String(acceptance ?? "none");
	return acceptance.level ?? "checked";
}

function acceptanceEvidence(started: StartMissionResult): string[] {
	const acceptance = started.policy.acceptance;
	if (!acceptance || typeof acceptance === "string") return [];
	return [...(acceptance.evidence ?? [])];
}

function roleReason(role: DelegationDecisionRoleName, mode: DelegationDecisionMode): string {
	if (role === "scout") return "Scouting is useful before parent planning because the selected profile requests targeted or deep evidence.";
	if (role === "planner") return "Planning is useful because the selected profile uses contract/list/DAG style decomposition rather than a direct contract.";
	if (role === "reviewer") return "Review is useful because validation remains parent-owned even when no child agent is launched.";
	return mode === "external_delegation_recommended"
		? "Worker scope is large enough that an external path-specialist agent may be useful when a reliable runtime is available."
		: "Parent should execute the worker pass directly while following the selected profile boundaries.";
}

function decisionRoles(started: StartMissionResult, mode: DelegationDecisionMode): DelegationDecisionRole[] {
	if (mode === "parent_direct") return [];
	const assignedPath = normalizeAssignedPath(started.classification.mentionedPaths);
	const roles: DelegationDecisionRole[] = [];
	if (started.policy.scouterPolicy.depth !== "off" && started.policy.scouterPolicy.depth !== "minimal") {
		roles.push({
			role: "scout",
			profile: "scout",
			assignedPath,
			required: true,
			reason: roleReason("scout", mode),
		});
	}
	if (started.policy.plannerPolicy.mode !== "direct_contract") {
		roles.push({
			role: "planner",
			profile: "planner",
			assignedPath,
			required: true,
			reason: roleReason("planner", mode),
		});
	}
	for (const workerPath of workerAssignedPaths(started.classification.mentionedPaths)) {
		roles.push({
			role: "worker",
			profile: started.policy.agentPolicy.agentType,
			assignedPath: workerPath,
			required: true,
			reason: roleReason("worker", mode),
		});
	}
	roles.push({
		role: "reviewer",
		profile: "reviewer",
		assignedPath,
		required: true,
		reason: roleReason("reviewer", mode),
	});
	return roles;
}

function parentInstructions(mode: DelegationDecisionMode): string[] {
	if (mode === "parent_direct") {
		return [
			"Execute directly in the parent session.",
			"Keep the change scoped to the selected profile and run the validator-pack evidence checks before claiming completion.",
		];
	}
	if (mode === "external_delegation_recommended") {
		return [
			"Do not require live child model calls in Codex Desktop.",
			"Use the listed roles as a parent-guided workflow now; delegate externally only when a reliable harness runtime is available.",
			"Parent owns integration, validation, and final completion claims.",
		];
	}
	return [
		"Simulate the listed roles sequentially in the parent session.",
		"Do not launch model-specific child agents.",
		"Parent owns edits, validation, and final completion claims.",
	];
}

export function compileDelegationDecision(
	rawRequest: string,
	options: StartMissionOptions = {},
): DelegationDecision {
	const started = startMission(rawRequest, options);
	const mode = decisionMode(started);
	return {
		missionId: started.missionId,
		mode,
		baseRuntime: started.route.baseRuntime,
		workPattern: started.route.workPattern,
		validatorPack: started.route.validatorPack,
		domainOverlays: [...started.route.domainOverlays],
		confidence: started.route.confidence,
		reason: `${started.route.reason}; delegation=${mode}`,
		roles: decisionRoles(started, mode),
		parentInstructions: parentInstructions(mode),
		verification: {
			level: acceptanceLevel(started),
			evidence: acceptanceEvidence(started),
		},
	};
}
