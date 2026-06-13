/**
 * Production {@link PlannerLlm} adapter backed by the model registry.
 *
 * Follows the established internal-LLM-call pattern (commit-message-generator):
 * resolve role-appropriate model candidates, walk the fallback chain, call
 * `completeSimple`, return raw text. Planning is reasoning-heavy, so the
 * "Planner" model role is preferred before falling back through availability
 * order. Errors propagate as throws (the planner's retry/validation loop and
 * callers own degradation policy — a planner that cannot reach any model must
 * not silently produce an empty plan).
 */

import type { ThinkingLevel } from "@amaze/agent-core";
import type { Api, Model } from "@amaze/ai";
import { completeSimple } from "@amaze/ai";
import { logger } from "@amaze/utils";
import type { ModelRegistry } from "../config/model-registry";
import { resolveModelRoleValue } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { toReasoningEffort } from "../thinking";
import type { PlannerLlm } from "./planner";

const MAX_PLAN_TOKENS = 2_000;

function getPlannerModelCandidates(
	registry: ModelRegistry,
	settings: Settings,
): Array<{ model: Model<Api>; thinkingLevel?: ThinkingLevel }> {
	const availableModels = registry.getAvailable();
	if (availableModels.length === 0) return [];

	const candidates: Array<{ model: Model<Api>; thinkingLevel?: ThinkingLevel }> = [];
	const addCandidate = (model?: Model<Api>, thinkingLevel?: ThinkingLevel): void => {
		if (!model) return;
		if (candidates.some(c => c.model.provider === model.provider && c.model.id === model.id)) return;
		candidates.push({ model, ...(thinkingLevel ? { thinkingLevel } : {}) });
	};

	const matchPreferences = { usageOrder: settings.getStorage()?.getModelUsageOrder() };
	const configured = resolveModelRoleValue(settings.getModelRole("Planner"), availableModels, {
		settings,
		matchPreferences,
		modelRegistry: registry,
	});
	addCandidate(configured.model, configured.thinkingLevel);

	for (const model of availableModels) {
		addCandidate(model);
	}
	return candidates;
}

/**
 * Build a PlannerLlm that resolves a model from the registry per call and
 * walks the candidate chain until one returns text. Throws when every
 * candidate fails or none has credentials.
 */
export function createRegistryPlannerLlm(registry: ModelRegistry, settings: Settings, sessionId?: string): PlannerLlm {
	return async (systemPrompt, userPrompt) => {
		const candidates = getPlannerModelCandidates(registry, settings);
		if (candidates.length === 0) throw new Error("planner llm: no available models");

		let lastError: unknown;
		for (const candidate of candidates) {
			const apiKey = await registry.getApiKey(candidate.model, sessionId);
			if (!apiKey) continue;
			try {
				const response = await completeSimple(
					candidate.model,
					{
						systemPrompt: [systemPrompt],
						messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
					},
					{ apiKey, maxTokens: MAX_PLAN_TOKENS, reasoning: toReasoningEffort(candidate.thinkingLevel) },
				);
				if (response.stopReason === "error") {
					lastError = new Error(response.errorMessage ?? "model returned error");
					logger.debug("planner-llm: model error", { model: candidate.model.id, error: response.errorMessage });
					continue;
				}
				let text = "";
				for (const content of response.content) {
					if (content.type === "text") text += content.text;
				}
				if (text.trim()) return text;
				lastError = new Error("model returned empty text");
			} catch (err) {
				lastError = err;
				logger.debug("planner-llm: call failed", {
					model: candidate.model.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		throw new Error(
			`planner llm: all candidates failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
		);
	};
}
