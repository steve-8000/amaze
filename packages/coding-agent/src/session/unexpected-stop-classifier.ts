import { type AssistantMessage, completeSimple } from "@steve-z8k/pi-ai";
import { logger, prompt } from "@steve-z8k/pi-utils";

import type { ModelRegistry } from "../config/model-registry";
import { resolveRoleSelection } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import unexpectedStopClassifierPrompt from "../prompts/system/unexpected-stop-classifier.md" with { type: "text" };

const ONLINE_MEMORY_MODEL_KEY = "online";

const CLASSIFIER_SYSTEM_PROMPT = prompt.render(unexpectedStopClassifierPrompt);

/**
 * The answer is a single word. OpenAI-compatible endpoints reject values below
 * 16, so 16 is the smallest portable budget for this classifier.
 */
const ANSWER_MAX_TOKENS = 16;
/**
 * Reasoning backends ignore `disableReasoning` on some providers, so reserve
 * enough output room for the keyword to still land after unavoidable thinking.
 */
const REASONING_SAFE_MAX_TOKENS = 1024;

export interface ClassifyUnexpectedStopDeps {
	settings: Settings;
	registry: ModelRegistry;
	sessionId: string;
	metadataResolver?: (provider: string) => Record<string, unknown> | undefined;
	signal?: AbortSignal;
}

export function isUnexpectedStopCandidate(message: AssistantMessage): boolean {
	if (message.stopReason !== "stop") return false;
	let hasText = false;
	for (const content of message.content) {
		if (content.type === "toolCall") return false;
		if (content.type === "text" && /\S/.test(content.text)) {
			hasText = true;
		}
	}
	return hasText;
}

export async function classifyUnexpectedStop(
	text: string,
	deps: ClassifyUnexpectedStopDeps,
): Promise<boolean | undefined> {
	const backend = deps.settings.get("providers.unexpectedStopModel");
	try {
		if (backend !== ONLINE_MEMORY_MODEL_KEY) {
			return undefined;
		}
		return await classifyOnline(text, deps);
	} catch (error) {
		logger.debug("unexpected-stop: classification failed", {
			error: error instanceof Error ? error.message : String(error),
			backend,
		});
		return undefined;
	}
}

async function classifyOnline(text: string, deps: ClassifyUnexpectedStopDeps): Promise<boolean | undefined> {
	const resolved = resolveRoleSelection(["flash"], deps.settings, deps.registry.getAvailable(), deps.registry);
	const model = resolved?.model;
	if (!model) {
		throw new Error("unexpected-stop: no flash model available for classification");
	}
	const apiKey = await deps.registry.getApiKey(model, deps.sessionId);
	if (!apiKey) {
		throw new Error(`unexpected-stop: no API key for ${model.provider}/${model.id}`);
	}
	const metadata = deps.metadataResolver?.(model.provider);
	const maxTokens = model.reasoning ? Math.max(ANSWER_MAX_TOKENS, REASONING_SAFE_MAX_TOKENS) : ANSWER_MAX_TOKENS;

	const response = await completeSimple(
		model,
		{
			systemPrompt: [CLASSIFIER_SYSTEM_PROMPT],
			messages: [{ role: "user", content: text, timestamp: Date.now() }],
		},
		{
			apiKey: deps.registry.resolver(model, deps.sessionId),
			maxTokens,
			disableReasoning: true,
			metadata,
			signal: deps.signal,
		},
	);

	if (response.stopReason === "error") {
		throw new Error(`unexpected-stop: online classification failed: ${response.errorMessage ?? "unknown error"}`);
	}

	const outputText = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map(part => part.text)
		.join("\n");
	return parseUnexpectedStopClassification(outputText);
}

export function parseUnexpectedStopClassification(text: string): boolean | undefined {
	const trimmed = text.trim().toLowerCase();
	if (trimmed.startsWith("yes")) return true;
	if (trimmed.startsWith("no")) return false;
	return undefined;
}
