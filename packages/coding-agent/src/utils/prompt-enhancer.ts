/**
 * Prompt enhancer prepass.
 *
 * When `promptEnhancer.enabled` is on, every plain user turn is rewritten into
 * an engineered prompt by a config-selected model before it reaches the main
 * agent. The rewrite input is the raw user text plus the tail of the recent
 * session transcript (`promptEnhancer.contextChars`, default 2000 chars).
 *
 * Model selection (`promptEnhancer.model`) accepts a concrete
 * "provider/model" pattern or a role name; when unset, the Explore-role fast
 * model is used. Any failure (no model, no key, provider error, timeout)
 * falls back to the original text — the prepass must never block a turn.
 */
import type { AgentMessage } from "@amaze/agent-core";
import { type Api, completeSimple, type Model } from "@amaze/ai";
import { logger, prompt } from "@amaze/utils";
import type { ModelRegistry } from "../config/model-registry";
import { resolveModelRoleValue, resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import enhancerSystemPrompt from "../prompts/system/prompt-enhancer-system.md" with { type: "text" };

const ENHANCER_SYSTEM_PROMPT = prompt.render(enhancerSystemPrompt);

/** Roles tried, in order, when `promptEnhancer.model` is not configured. */
const FALLBACK_ROLES = ["Explore"] as const;

/**
 * Extract a plain-text tail of the conversation for the enhancer input.
 * Only user and assistant text content is included; tool traffic, thinking,
 * and custom messages are skipped. Returns at most `maxChars` characters,
 * cut from the end (most recent context wins).
 */
export function extractRecentContext(messages: readonly AgentMessage[], maxChars: number): string {
	if (maxChars <= 0) return "";

	const parts: string[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const label = message.role === "user" ? "User" : "Assistant";
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map(c => c.text)
						.join("\n");
		const trimmed = text.trim();
		if (!trimmed) continue;
		parts.push(`${label}: ${trimmed}`);
	}

	const joined = parts.join("\n\n");
	return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

/**
 * Resolve the enhancer model from settings.
 * `promptEnhancer.model` may be a "provider/model" pattern or a role name;
 * empty falls back to the Explore role, then the current model.
 */
export function getEnhancerModel(
	registry: ModelRegistry,
	settings: Settings,
	currentModel?: Model<Api>,
): Model<Api> | undefined {
	const availableModels = registry.getAvailable();
	if (availableModels.length === 0) return undefined;

	const configured = settings.get("promptEnhancer.model")?.trim();
	if (configured) {
		const resolved = resolveModelRoleValue(configured, availableModels, {
			settings,
			modelRegistry: registry,
		});
		if (resolved.model) return resolved.model;
		logger.debug("prompt-enhancer: configured model did not resolve, falling back", {
			configured,
			warning: resolved.warning,
		});
	}

	const roleModel = resolveRoleSelection(FALLBACK_ROLES, settings, availableModels, registry)?.model;
	if (roleModel) return roleModel;

	return currentModel;
}

export interface EnhancePromptOptions {
	/** Raw user text (after slash/template expansion). */
	text: string;
	/** Current session messages used for recent-context extraction. */
	messages: readonly AgentMessage[];
	registry: ModelRegistry;
	settings: Settings;
	sessionId?: string;
	currentModel?: Model<Api>;
	/** Resolved after credential selection, mirrors title-generator semantics. */
	metadataResolver?: (provider: string) => Record<string, unknown> | undefined;
}

/**
 * Rewrite a user message into an engineered prompt.
 * Returns the rewritten text, or null when the prepass cannot or should not
 * apply (caller must fall back to the original text).
 */
export async function enhancePrompt(options: EnhancePromptOptions): Promise<string | null> {
	const { text, messages, registry, settings, sessionId, currentModel, metadataResolver } = options;
	const trimmed = text.trim();
	if (!trimmed) return null;

	const model = getEnhancerModel(registry, settings, currentModel);
	if (!model) {
		logger.debug("prompt-enhancer: no model available");
		return null;
	}

	const apiKey = await registry.getApiKey(model, sessionId);
	if (!apiKey) {
		logger.debug("prompt-enhancer: no API key", { provider: model.provider, id: model.id });
		return null;
	}
	const metadata = metadataResolver?.(model.provider);

	const contextChars = settings.get("promptEnhancer.contextChars");
	const recentContext = extractRecentContext(messages, contextChars);
	const userMessage = `<user-instruction>
${trimmed}
</user-instruction>

<recent-context>
${recentContext}
</recent-context>`;

	const maxTokens = settings.get("promptEnhancer.maxOutputTokens");
	const timeoutMs = settings.get("promptEnhancer.timeoutMs");

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: [ENHANCER_SYSTEM_PROMPT],
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
			},
			{
				apiKey,
				maxTokens,
				disableReasoning: true,
				metadata,
				signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
			},
		);

		if (response.stopReason === "error") {
			logger.debug("prompt-enhancer: response error", {
				model: `${model.provider}/${model.id}`,
				errorMessage: response.errorMessage,
			});
			return null;
		}

		let enhanced = "";
		for (const content of response.content) {
			if (content.type === "text") enhanced += content.text;
		}
		enhanced = enhanced.trim();
		if (!enhanced) return null;

		logger.debug("prompt-enhancer: rewrote prompt", {
			model: `${model.provider}/${model.id}`,
			inputChars: trimmed.length,
			contextChars: recentContext.length,
			outputChars: enhanced.length,
		});
		return enhanced;
	} catch (err) {
		logger.debug("prompt-enhancer: error", {
			model: `${model.provider}/${model.id}`,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}
