import type {
	DirectMissionRoute,
	MissionClassification,
	NormalizedRequest,
	WorkPattern,
} from "./types.ts";

export const MAX_DIRECT_AGENT_ROUTE_CHANGES = 2;

const ROLE_AGENTS = {
	default: "worker",
	implementation: "worker",
	review: "reviewer",
	research: "researcher",
	operations: "worker",
} as const;

function agentForWorkPattern(workPattern: WorkPattern): string {
	if (workPattern === "research" || workPattern === "exploration") return ROLE_AGENTS.research;
	if (workPattern === "security") return ROLE_AGENTS.review;
	if (workPattern === "infra") return ROLE_AGENTS.operations;
	if (workPattern === "implementation" || workPattern === "feature" || workPattern === "bugfix" || workPattern === "refactor") {
		return ROLE_AGENTS.implementation;
	}
	return ROLE_AGENTS.default;
}

function selectRoleAgent(classification?: MissionClassification): string {
	if (!classification) return ROLE_AGENTS.default;
	if (classification.riskLevel === "high" && classification.workPattern !== "infra") return ROLE_AGENTS.review;
	return agentForWorkPattern(classification.workPattern);
}

export function routeDirectAgent(input: {
	classification?: MissionClassification;
	normalized?: NormalizedRequest;
}): DirectMissionRoute {
	const agent = selectRoleAgent(input.classification);
	return {
		mode: "agent_direct",
		agent,
		confidence: input.classification ? input.classification.confidence : 0.55,
		reason: input.classification
			? `Selected ${agent} for ${input.classification.workPattern}/${input.classification.riskLevel} role routing.`
			: "Selected worker because no classification was available.",
	};
}
