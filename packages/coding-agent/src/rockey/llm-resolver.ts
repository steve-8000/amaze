import type { Model } from "@amaze/ai";
import type { ModelRegistry } from "../config/model-registry";
import { resolveModelFromString } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import type { AgentSession } from "../session/agent-session";

export type RockeyLlmPurpose = "curation" | "scoring" | "summary";

export interface RockeyLlmSelection {
	model: Model | undefined;
	source:
		| "explicit-model"
		| "provider-role"
		| "role"
		| "memory-role"
		| "fallback-role"
		| "default-role"
		| "session-model"
		| "none";
}

export interface RockeyLlmConfig {
	enabled: boolean;
	model?: string;
	provider?: string;
	modelRole?: string;
	fallbackRole: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	timeoutMs: number;
}

export function getRockeyLlmConfig(settings: Settings, purpose: RockeyLlmPurpose): RockeyLlmConfig {
	const prefix = `rockey.llm.${purpose}` as const;
	return {
		enabled: settings.get("rockey.llm.enabled") ?? true,
		model: settings.get(`${prefix}.model`),
		provider: settings.get(`${prefix}.provider`),
		modelRole: settings.get(`${prefix}.modelRole`),
		fallbackRole: settings.get(`${prefix}.fallbackRole`) ?? (purpose === "summary" ? "default" : "smol"),
		maxInputTokens: settings.get(`${prefix}.maxInputTokens`) ?? (purpose === "summary" ? 6000 : 4000),
		maxOutputTokens: settings.get(`${prefix}.maxOutputTokens`) ?? (purpose === "summary" ? 1200 : 1000),
		timeoutMs: settings.get(`${prefix}.timeoutMs`) ?? 30000,
	};
}

export function resolveRockeyModel(options: {
	purpose: RockeyLlmPurpose;
	settings: Settings;
	modelRegistry: ModelRegistry;
	session?: AgentSession;
}): RockeyLlmSelection {
	const { purpose, settings, modelRegistry, session } = options;
	const config = getRockeyLlmConfig(settings, purpose);
	if (!config.enabled) return { model: undefined, source: "none" };

	const available = modelRegistry.getAll();
	const providerScoped = config.provider ? available.filter(model => model.provider === config.provider) : available;
	if (config.model) {
		const model = resolveModelFromString(
			config.model,
			providerScoped,
			{ usageOrder: settings.getStorage()?.getModelUsageOrder() },
			modelRegistry,
		);
		if (model) return { model, source: "explicit-model" };
	}

	if (config.provider && config.modelRole) {
		const model = resolveFromRoleName(config.modelRole, settings, providerScoped, modelRegistry);
		if (model) return { model, source: "provider-role" };
	}

	if (config.modelRole) {
		const model = resolveFromRoleName(config.modelRole, settings, available, modelRegistry);
		if (model) return { model, source: "role" };
	}

	const memoryRole =
		resolveFromRoleName("memory", settings, providerScoped, modelRegistry) ??
		resolveFromRoleName("memory", settings, available, modelRegistry);
	if (memoryRole) return { model: memoryRole, source: "memory-role" };

	const fallback =
		resolveFromRoleName(config.fallbackRole, settings, providerScoped, modelRegistry) ??
		resolveFromRoleName(config.fallbackRole, settings, available, modelRegistry);
	if (fallback) return { model: fallback, source: "fallback-role" };

	const defaultRole =
		resolveFromRoleName("default", settings, providerScoped, modelRegistry) ??
		resolveFromRoleName("default", settings, available, modelRegistry);
	if (defaultRole) return { model: defaultRole, source: "default-role" };

	if (session?.model) return { model: session.model, source: "session-model" };
	return {
		model: providerScoped[0] ?? available[0],
		source: providerScoped.length > 0 || available.length > 0 ? "session-model" : "none",
	};
}

function resolveFromRoleName(
	role: string,
	settings: Settings,
	available: Model[],
	modelRegistry: ModelRegistry,
): Model | undefined {
	const configured = settings.getModelRole(role);
	if (!configured) return undefined;
	return resolveModelFromString(
		configured,
		available,
		{ usageOrder: settings.getStorage()?.getModelUsageOrder() },
		modelRegistry,
	);
}
