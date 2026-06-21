import type { DirectMissionRoute, ExecutionPolicy, MissionClassification } from "./types.ts";

export function compileExecutionPolicy(route: DirectMissionRoute, classification: MissionClassification): ExecutionPolicy {
	return {
		missionId: classification.missionId,
		route,
		classification,
		acceptanceLevel: classification.riskLevel === "high" ? "reviewed" : "checked",
		validationLevel: classification.riskLevel === "low" ? "checked" : "verified",
		outputContract: "attestation",
		stopRules: [
			"Do not create synthetic roles, folder-level fanout, or path-specialist agents.",
			"Dispatch the mission through the selected direct agent only.",
			"Return validation evidence to the caller; the caller owns final acceptance.",
		],
		contractTemplate: {
			agent: route.agent,
			task: classification.reason,
		},
	};
}
