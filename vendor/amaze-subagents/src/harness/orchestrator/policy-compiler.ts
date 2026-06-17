/// <reference types="node" />

import {
	getDomainOverlayProfile,
	getRuntimeProfile,
	getValidatorPackProfile,
	getWorkPatternProfile,
	MAX_DOMAIN_OVERLAYS,
} from "./profile-catalog.ts";
import type { ExecutionPolicy, MissionClassification, ProfileRoute } from "./types.ts";

function cloneAcceptance<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function compileExecutionPolicy(route: ProfileRoute, classification: MissionClassification): ExecutionPolicy {
	if (route.domainOverlays.length > MAX_DOMAIN_OVERLAYS) {
		throw new Error(`ExecutionPolicy activates too many domain overlays: ${route.domainOverlays.length} > ${MAX_DOMAIN_OVERLAYS}`);
	}
	const runtime = getRuntimeProfile(route.baseRuntime);
	const validator = getValidatorPackProfile(route.validatorPack);
	const workPattern = getWorkPatternProfile(route.workPattern);
	let includePathMemory = runtime.context.includePathMemory;
	let includeResearch = runtime.context.includeResearch;
	for (const overlayId of route.domainOverlays) {
		const overlay = getDomainOverlayProfile(overlayId);
		if (!overlay) throw new Error(`Unknown domain overlay: ${overlayId}`);
		includePathMemory = overlay.policyHints?.includePathMemory ?? includePathMemory;
		includeResearch = overlay.policyHints?.includeResearch ?? includeResearch;
	}
	const researchMode = classification.requiresResearch && runtime.researcher.mode === "off"
		? "on_demand"
		: runtime.researcher.mode;
	return {
		missionId: classification.missionId,
		runtime: route.baseRuntime,
		workPattern: route.workPattern,
		domainOverlays: [...route.domainOverlays],
		validatorPack: route.validatorPack,
		scouterPolicy: {
			depth: classification.requiresScouter ? runtime.scouter.depth : "minimal",
			includeDependencyGraph: Boolean(runtime.scouter.includeDependencyGraph),
			includeSymbolGraph: Boolean(runtime.scouter.includeSymbolGraph),
			includeRecentChanges: Boolean(runtime.scouter.includeRecentChanges),
		},
		researchPolicy: {
			mode: researchMode,
			...(runtime.researcher.sourcePreference ? { sourcePreference: [...runtime.researcher.sourcePreference] } : {}),
		},
		plannerPolicy: {
			mode: runtime.planner.mode,
			maxInitialContracts: runtime.planner.maxInitialContracts,
			contractGranularity: runtime.planner.contractGranularity,
			allowParallelGroups: Boolean(runtime.planner.allowParallelGroups),
			requireChangeRequestsForCrossPath: Boolean(runtime.planner.requireChangeRequestsForCrossPath),
			workPatternSequence: [...workPattern.contractSequence],
		},
		contextPolicy: {
			packetBudgetTokens: runtime.context.packetBudgetTokens,
			includePathMemory,
			includeResearch,
		},
		agentPolicy: {
			agentType: "path_specialist",
			maxAgents: runtime.agents.maxAgents,
			reuseExistingAgents: runtime.agents.reuseExistingAgents,
			createMissingPathAgents: runtime.agents.createMissingPathAgents,
			writeScope: runtime.agents.writeScope,
		},
		failurePolicy: { ...runtime.failure },
		acceptance: cloneAcceptance(validator.acceptance),
	};
}
