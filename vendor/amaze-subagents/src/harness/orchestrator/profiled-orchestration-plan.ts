/// <reference types="node" />

import { xenoniteNamespaceFromPath } from "../path-memory.ts";
import type { FreshBootContract, HarnessAcceptanceContract, HarnessOutputRequired } from "../fresh-boot-contract.ts";
import { startMission, type StartMissionOptions, type StartMissionResult } from "./mission-orchestrator.ts";
import type { AcceptanceConfig, AcceptanceGate, AcceptanceInput } from "../../shared/types.ts";

export type ProfiledOrchestrationRole = "scout" | "planner" | "worker" | "reviewer";

export interface ProfiledChildInvocation {
	role: ProfiledOrchestrationRole;
	profile: string;
	action: "harness_run_contract";
	bootContract: FreshBootContract;
	dependsOn: string[];
	reason: string;
}

export interface ProfiledOrchestrationPlan extends StartMissionResult {
	executionPlan: {
		mode: "profiled_orchestration";
		childExecution: "harness_run_contract_only";
		contextBoundary: {
			freshBootOnly: true;
			parentContextDisabled: true;
			contextFilesDisabled: true;
			skillsDisabled: boolean;
		};
		steps: ProfiledChildInvocation[];
	};
}

const OUTPUT_REQUIRED: HarnessOutputRequired[] = [
	"summary",
	"files_changed",
	"tests_run",
	"risks",
	"change_requests",
	"memory_updates",
];

function sanitizeId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "workspace";
}

function normalizeAssignedPath(paths: string[]): string {
	const first = paths.find((item) => item.trim().length > 0)?.replace(/\/$/, "");
	return first && !first.includes("*") ? first : ".";
}

function pathIdFor(role: ProfiledOrchestrationRole, assignedPath: string): string {
	return `${role}.${sanitizeId(assignedPath)}`;
}

function acceptanceMustChange(acceptance: AcceptanceInput): string[] {
	if (!acceptance || typeof acceptance === "string") return [];
	const config = acceptance as AcceptanceConfig;
	return (config.criteria ?? []).map((criterion) => {
		if (typeof criterion === "string") return criterion;
		return (criterion as AcceptanceGate).must;
	}).filter((item) => item.trim().length > 0);
}

function acceptanceValidationCommands(acceptance: AcceptanceInput): string[] {
	if (!acceptance || typeof acceptance === "string") return [];
	const config = acceptance as AcceptanceConfig;
	return (config.verify ?? []).map((item) => item.command).filter((item) => item.trim().length > 0);
}

function harnessAcceptance(acceptance: AcceptanceInput, fallbackMustChange: string): HarnessAcceptanceContract {
	const mustChange = acceptanceMustChange(acceptance);
	return {
		must_change: mustChange.length > 0 ? mustChange : [fallbackMustChange],
		must_not_change: ["Do not broaden scope beyond the FreshBootContract execution boundaries."],
		validation_commands: acceptanceValidationCommands(acceptance),
	};
}

function activityBudgetFor(role: ProfiledOrchestrationRole): FreshBootContract["execution_contract"]["activity_budget"] {
	if (role === "scout") return { max_tool_uses: 16, max_tokens: 24_000, max_elapsed_ms: 120_000 };
	if (role === "planner") return { max_tool_uses: 12, max_tokens: 20_000, max_elapsed_ms: 120_000 };
	if (role === "reviewer") return { max_tool_uses: 18, max_tokens: 28_000, max_elapsed_ms: 120_000 };
	return { max_tool_uses: 40, max_tokens: 80_000, max_elapsed_ms: 180_000 };
}

function roleGoal(role: ProfiledOrchestrationRole, rawRequest: string): string {
	if (role === "scout") return `Scout only the assigned scope and return concise evidence for: ${rawRequest}`;
	if (role === "planner") return `Create bounded path contracts and sequencing for: ${rawRequest}`;
	if (role === "reviewer") return `Review completed contract outputs and identify validation gaps for: ${rawRequest}`;
	return rawRequest;
}

function roleReason(role: ProfiledOrchestrationRole): string {
	if (role === "scout") return "ExecutionPolicy.scouterPolicy requires codebase evidence before planning.";
	if (role === "planner") return "ExecutionPolicy.plannerPolicy requires contract-based decomposition.";
	if (role === "reviewer") return "ExecutionPolicy.validatorPack requires parent-owned review/validation synthesis.";
	return "ExecutionPolicy.agentPolicy requires path-specialist worker execution.";
}

function makeContract(input: {
	missionId: string;
	role: ProfiledOrchestrationRole;
	rawRequest: string;
	assignedPath: string;
	acceptance: AcceptanceInput;
}): FreshBootContract {
	const pathId = pathIdFor(input.role, input.assignedPath);
	const contractId = input.assignedPath === "." ? `${input.missionId}-${input.role}` : `${input.missionId}-${pathId}`;
	const memoryPath = `.harness/memory/paths/${pathId}`;
	const ownedPaths = input.assignedPath === "." ? ["**"] : [`${input.assignedPath}/**`];
	const readAllowedPaths = input.assignedPath === "." ? ["**"] : [input.assignedPath, `${input.assignedPath}/**`];
	return {
		boot_id: `boot-${contractId}`,
		mission_id: input.missionId,
		contract_id: contractId,
		boot_mode: "fresh",
		parent_context: {
			inherit_conversation: false,
			inherit_system_prompt: false,
			inherit_tools: false,
			inherit_skills: false,
		},
		specialist: {
			path_id: pathId,
			owned_path: input.assignedPath,
			memory_path: memoryPath,
		},
		context_packet: {
			packet_id: `ctx-${contractId}`,
			path: `.harness/context/packets/${contractId}.json`,
		},
		memory_attachments: [{
			attachment_id: `mem-${contractId}`,
			path_id: pathId,
			memory_path: memoryPath,
			xenonite_namespace: xenoniteNamespaceFromPath(input.assignedPath),
			include: {
				profile: true,
				conventions: true,
				recent_decisions: 10,
				known_failures: 5,
				incidents: 3,
				contract_summaries: 5,
			},
			mode: "read_only",
			budget: { max_tokens: 6_000 },
		}],
		execution_contract: {
			contract_id: contractId,
			assigned_path: input.assignedPath,
			assigned_specialist: pathId,
			goal: roleGoal(input.role, input.rawRequest),
			owned_paths: ownedPaths,
			read_allowed_paths: readAllowedPaths,
			write_allowed_paths: ownedPaths,
			write_denied_paths: ["**/*"],
			activity_budget: activityBudgetFor(input.role),
			acceptance: harnessAcceptance(input.acceptance, roleGoal(input.role, input.rawRequest)),
			tool_policy: {
				xenonite_first: true,
				core_tools_available: true,
				skills_available: true,
				parent_tool_inheritance: false,
			},
			coordination: {
				irc_required: true,
				orchestrator_contact: "intercom",
				goal_updates_allowed: true,
			},
			output_required: OUTPUT_REQUIRED,
		},
	};
}

function enabledRoles(started: StartMissionResult): ProfiledOrchestrationRole[] {
	const roles: ProfiledOrchestrationRole[] = [];
	if (started.policy.scouterPolicy.depth !== "off" && started.policy.scouterPolicy.depth !== "minimal") {
		roles.push("scout");
	}
	if (started.policy.plannerPolicy.mode !== "direct_contract") roles.push("planner");
	roles.push("worker");
	roles.push("reviewer");
	return roles.slice(0, Math.max(1, started.policy.agentPolicy.maxAgents));
}

function workerAssignedPaths(paths: string[]): string[] {
	const normalized = paths
		.map((item) => normalizeAssignedPath([item]))
		.filter((item) => item.length > 0);
	const unique = [...new Set(normalized)];
	return unique.length > 0 ? unique : ["."];
}

export function compileProfiledOrchestrationPlan(
	rawRequest: string,
	options: StartMissionOptions = {},
): ProfiledOrchestrationPlan {
	const started = startMission(rawRequest, options);
	const assignedPath = normalizeAssignedPath(started.classification.mentionedPaths);
	const roles = enabledRoles(started);
	const planningRoles = roles.filter((role) => role === "scout" || role === "planner");
	const hasReviewer = roles.includes("reviewer");
	const workerPaths = workerAssignedPaths(started.classification.mentionedPaths);
	const planningSteps: ProfiledChildInvocation[] = planningRoles.map((role, index) => ({
		role,
		profile: role,
		action: "harness_run_contract",
		bootContract: makeContract({
			missionId: started.missionId,
			role,
			rawRequest,
			assignedPath,
			acceptance: started.policy.acceptance,
		}),
		dependsOn: index === 0 ? [] : [planningRoles[index - 1] ?? "scout"],
		reason: roleReason(role),
	}));
	const workerDependency = planningRoles[planningRoles.length - 1];
	const workerSteps: ProfiledChildInvocation[] = workerPaths.map((workerPath) => ({
		role: "worker",
		profile: started.policy.agentPolicy.agentType,
		action: "harness_run_contract",
		bootContract: makeContract({
			missionId: started.missionId,
			role: "worker",
			rawRequest,
			assignedPath: workerPath,
			acceptance: started.policy.acceptance,
		}),
		dependsOn: workerDependency ? [workerDependency] : [],
		reason: `${roleReason("worker")} Scope: ${workerPath}`,
	}));
	const reviewerSteps: ProfiledChildInvocation[] = hasReviewer ? [{
		role: "reviewer",
		profile: "reviewer",
		action: "harness_run_contract",
		bootContract: makeContract({
			missionId: started.missionId,
			role: "reviewer",
			rawRequest,
			assignedPath,
			acceptance: started.policy.acceptance,
		}),
		dependsOn: workerSteps.length > 0 ? ["worker"] : planningRoles[planningRoles.length - 1] ? [planningRoles[planningRoles.length - 1]!] : [],
		reason: roleReason("reviewer"),
	}] : [];
	const steps = [...planningSteps, ...workerSteps, ...reviewerSteps];
	return {
		...started,
		executionPlan: {
			mode: "profiled_orchestration",
			childExecution: "harness_run_contract_only",
			contextBoundary: {
				freshBootOnly: true,
				parentContextDisabled: true,
				contextFilesDisabled: true,
				skillsDisabled: false,
			},
			steps,
		},
	};
}
