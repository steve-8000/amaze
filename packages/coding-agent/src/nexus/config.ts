import type { Settings } from "../config/settings";
import type { NexusCapabilities } from "./types";

export interface NexusConfig {
	enabled: boolean;
	autoRecall: boolean;
	autoRecallLimit: number;
	staticPromptMaxChars: number;
	knowledgeEnabled: boolean;
	knowledgeAutoRecall: boolean;
	knowledgeAutoRecallLimit: number;
	knowledgePromptMaxChars: number;
	knowledgeMaxIndexedFiles: number;
	knowledgeMaxFileBytes: number;
	knowledgeMaintenanceMinIntervalMs: number;
	searchResultMaxEntries: number;
	searchResultMaxChars: number;
	searchEntryMaxChars: number;
	sessionSearchMaxAnchors: number;
	pipelineEnabled: boolean;
	migrationRockey: boolean;
	migrationLocal: boolean;
	migrationHindsight: boolean;
	llmEnabled: boolean;
	llmProvider: string;
	llmBaseUrl: string | undefined;
	llmModel: string | undefined;
	embeddingsEnabled: boolean;
	embeddingsProvider: string;
	embeddingsBaseUrl: string | undefined;
	embeddingsModel: string | undefined;
	vectorEnabled: boolean;
	vectorProvider: string;
	rerankerEnabled: boolean;
	rerankerProvider: string;
	dreamEnabled: boolean;
	onlineConsolidationEnabled: boolean;
	hypothesisVerificationEnabled: boolean;
	conceptualSkillEnabled: boolean;
	dreamHypothesesOnly: boolean;
	healingEnabled: boolean;
	autoApplySafeRepairs: boolean;
	deterministicFallback: boolean;
	/**
	 * Per pipeline run caps. The pipeline never spends more LLM/embed calls than
	 * these budgets, so a slow local server cannot block the agent loop.
	 */
	maxLlmCalls: number;
	maxEmbedCalls: number;
	maxRolloutsPerRun: number;
	/**
	 * Sampling temperature for the LLM during rollout extraction. Extraction is
	 * a closed-vocabulary classification task — every produced field must be in
	 * an enum — so deterministic decoding (0) is the safe default.
	 */
	extractionTemperature: number;
	/**
	 * Sampling temperature for the reflection / dream loop. Hypotheses benefit
	 * from a small amount of stochasticity so the loop is not stuck repeating
	 * the same thought across sessions, but anything ≥ 0.3 produces measurable
	 * grounding drift on a 7B-class local model. The default lands just above
	 * deterministic so the loop still discovers patterns yet stays anchored to
	 * the supplied memories.
	 */
	reflectionTemperature: number;
}

function numberSetting(value: number | undefined, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}

function floatSetting(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

function stringSetting(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function loadNexusConfig(settings: Settings): NexusConfig {
	const backend = settings.get("memory.backend");
	return {
		enabled: backend === "nexus",
		autoRecall: settings.get("nexus.autoRecall") ?? false,
		autoRecallLimit: numberSetting(settings.get("nexus.autoRecallLimit"), 5, 1, 20),
		staticPromptMaxChars: numberSetting(settings.get("nexus.staticPromptMaxChars"), 5_000, 200, 50_000),
		knowledgeEnabled: settings.get("nexus.knowledge.enabled") ?? true,
		knowledgeAutoRecall: settings.get("nexus.knowledge.autoRecall") ?? false,
		knowledgeAutoRecallLimit: numberSetting(settings.get("nexus.knowledge.autoRecallLimit"), 5, 1, 50),
		knowledgePromptMaxChars: numberSetting(settings.get("nexus.knowledge.promptMaxChars"), 5_000, 200, 50_000),
		knowledgeMaxIndexedFiles: numberSetting(settings.get("nexus.knowledge.maxIndexedFiles"), 2_000, 0, 100_000),
		knowledgeMaxFileBytes: numberSetting(settings.get("nexus.knowledge.maxFileBytes"), 256 * 1024, 1_024, 10 * 1024 * 1024),
		knowledgeMaintenanceMinIntervalMs: numberSetting(settings.get("nexus.knowledge.maintenanceMinIntervalMs"), 15 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000),
		searchResultMaxEntries: numberSetting(settings.get("nexus.searchResultMaxEntries"), 5, 1, 20),
		searchResultMaxChars: numberSetting(settings.get("nexus.searchResultMaxChars"), 2_400, 200, 50_000),
		searchEntryMaxChars: numberSetting(settings.get("nexus.searchEntryMaxChars"), 480, 80, 10_000),
		sessionSearchMaxAnchors: numberSetting(settings.get("nexus.sessionSearchMaxAnchors"), 8, 1, 50),
		pipelineEnabled: settings.get("nexus.pipeline.enabled") ?? true,
		migrationRockey: settings.get("nexus.migration.rockey") ?? true,
		migrationLocal: settings.get("nexus.migration.local") ?? true,
		migrationHindsight: settings.get("nexus.migration.hindsight") ?? true,
		llmEnabled: settings.get("nexus.llm.enabled") ?? false,
		llmProvider: settings.get("nexus.llm.provider") ?? "disabled",
		llmBaseUrl: stringSetting(settings.get("nexus.llm.baseUrl")),
		llmModel: stringSetting(settings.get("nexus.llm.model")),
		embeddingsEnabled: settings.get("nexus.embeddings.enabled") ?? false,
		embeddingsProvider: settings.get("nexus.embeddings.provider") ?? "disabled",
		embeddingsBaseUrl: stringSetting(settings.get("nexus.embeddings.baseUrl")),
		embeddingsModel: stringSetting(settings.get("nexus.embeddings.model")),
		vectorEnabled: settings.get("nexus.vector.enabled") ?? false,
		vectorProvider: settings.get("nexus.vector.provider") ?? "disabled",
		rerankerEnabled: settings.get("nexus.reranker.enabled") ?? false,
		rerankerProvider: settings.get("nexus.reranker.provider") ?? "disabled",
		dreamEnabled: settings.get("nexus.dream.enabled") ?? false,
		dreamHypothesesOnly: settings.get("nexus.dream.hypothesesOnly") ?? true,
		healingEnabled: settings.get("nexus.healing.enabled") ?? true,
		autoApplySafeRepairs: settings.get("nexus.healing.autoApplySafeRepairs") ?? true,
		deterministicFallback: settings.get("nexus.fallback.deterministicConsolidation") ?? true,
		onlineConsolidationEnabled: settings.get("nexus.onlineConsolidation.enabled") ?? true,
		hypothesisVerificationEnabled: settings.get("nexus.hypothesisVerification.enabled") ?? true,
		conceptualSkillEnabled: settings.get("nexus.conceptualSkills.enabled") ?? true,
		maxLlmCalls: numberSetting(settings.get("nexus.maxLlmCalls"), 6, 0, 200),
		maxEmbedCalls: numberSetting(settings.get("nexus.maxEmbedCalls"), 64, 0, 2000),
		maxRolloutsPerRun: numberSetting(settings.get("nexus.maxRolloutsPerRun"), 8, 1, 200),
		extractionTemperature: floatSetting(settings.get("nexus.llm.extractionTemperature"), 0, 0, 2),
		reflectionTemperature: floatSetting(settings.get("nexus.llm.reflectionTemperature"), 0, 0, 2),
	};
}

function configuredWhen(enabled: boolean, provider: string, required?: string): "disabled" | "configured" | "unavailable" {
	if (!enabled || provider === "disabled") return "disabled";
	return required ? "configured" : "unavailable";
}

export function resolveNexusCapabilities(config: NexusConfig): NexusCapabilities {
	const embeddings = configuredWhen(config.embeddingsEnabled, config.embeddingsProvider, config.embeddingsModel);
	const vector = configuredWhen(config.vectorEnabled, config.vectorProvider, config.vectorProvider);
	const reranker = configuredWhen(config.rerankerEnabled, config.rerankerProvider, config.rerankerProvider);
	return {
		llm: configuredWhen(config.llmEnabled, config.llmProvider, config.llmModel),
		embeddings,
		vector,
		reranker,
		retrievalMode: embeddings === "configured" ? "hybrid" : "fts",
		deterministicFallback: config.deterministicFallback,
	};
}
