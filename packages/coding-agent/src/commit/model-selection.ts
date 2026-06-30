import type { ThinkingLevel } from "@steve-z8k/pi-agent-core";
import type { Api, ApiKey, Model } from "@steve-z8k/pi-ai";
import type { ApiKeyResolverRegistry } from "../config/api-key-resolver";
import {
	getModelMatchPreferences,
	type ModelLookupRegistry,
	parseModelPattern,
	resolveModelRoleValue,
	resolveRoleSelection,
} from "../config/model-resolver";
import { MODEL_ROLE_IDS } from "../config/model-roles";
import type { Settings } from "../config/settings";
import MODEL_PRIO from "../priority.json" with { type: "json" };

export interface ResolvedCommitModel {
	model: Model<Api>;
	/**
	 * Resolver for the model's bearer: re-resolves on 401 / usage-limit so the
	 * whole commit pipeline (analysis, map/reduce, changelog) inherits the
	 * central force-refresh + account-rotation policy.
	 */
	apiKey: ApiKey;
	thinkingLevel?: ThinkingLevel;
}

type CommitModelRegistry = ModelLookupRegistry &
	ApiKeyResolverRegistry & {
		getApiKey: (model: Model<Api>) => Promise<string | undefined>;
	};

export async function resolvePrimaryModel(
	override: string | undefined,
	settings: Settings,
	modelRegistry: CommitModelRegistry,
): Promise<ResolvedCommitModel> {
	const available = modelRegistry.getAvailable();
	const matchPreferences = getModelMatchPreferences(settings);
	const resolved = override
		? resolveModelRoleValue(override, available, { settings, matchPreferences, modelRegistry })
		: resolveRoleSelection(["flash", "spark", ...MODEL_ROLE_IDS], settings, available, modelRegistry);
	const model = resolved?.model;
	if (!model) {
		throw new Error("No model available for commit generation");
	}
	const apiKey = await modelRegistry.getApiKey(model);
	if (!apiKey) {
		throw new Error(`No API key available for model ${model.provider}/${model.id}`);
	}
	return {
		model,
		apiKey: modelRegistry.resolver(model),
		thinkingLevel: resolved?.thinkingLevel,
	};
}

export async function resolveFlashModel(
	settings: Settings,
	modelRegistry: CommitModelRegistry,
	fallbackModel: Model<Api>,
	fallbackApiKey: ApiKey,
): Promise<ResolvedCommitModel> {
	const available = modelRegistry.getAvailable();
	const resolvedFlash = resolveRoleSelection(["flash"], settings, available, modelRegistry);
	if (resolvedFlash?.model) {
		const apiKey = await modelRegistry.getApiKey(resolvedFlash.model);
		if (apiKey) {
			return {
				model: resolvedFlash.model,
				apiKey: modelRegistry.resolver(resolvedFlash.model),
				thinkingLevel: resolvedFlash.thinkingLevel,
			};
		}
	}

	const matchPreferences = getModelMatchPreferences(settings);
	for (const pattern of MODEL_PRIO.flash) {
		const candidate = parseModelPattern(pattern, available, matchPreferences, { modelRegistry }).model;
		if (!candidate) continue;
		const apiKey = await modelRegistry.getApiKey(candidate);
		if (apiKey) {
			return {
				model: candidate,
				apiKey: modelRegistry.resolver(candidate),
			};
		}
	}

	return { model: fallbackModel, apiKey: fallbackApiKey };
}
