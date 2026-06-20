import { type Api, type AssistantMessage, completeSimple, type Model } from "@steve-8000/amaze-ai";
import { loadAmazeConfig } from "../amaze/config.ts";
import type { MemoryReranker } from "./agent-session.ts";
import type { ModelRegistry } from "./model-registry.ts";
import type { RecalledMemory } from "./tools/index.ts";

type CompleteSimple = typeof completeSimple;

interface MemoryRerankSettings {
	enabled: boolean;
	modelSelector?: string;
	timeoutMs: number;
	minConfidence: number;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function positiveIntegerSetting(value: unknown, fallback: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const normalized = Math.floor(value);
	if (normalized < 1) return fallback;
	return Math.min(normalized, max);
}

function boundedNumberSetting(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	if (value < 0 || value > 1) return fallback;
	return value;
}

export function readMemoryRerankSettings(config = loadAmazeConfig()): MemoryRerankSettings {
	const tools = objectValue(config.raw.tools);
	const mem = objectValue(tools?.mem);
	const retrieval = objectValue(mem?.retrieval);
	return {
		enabled: booleanSetting(retrieval?.rerank, false),
		modelSelector:
			typeof (retrieval?.rerank_model ?? retrieval?.rerankModel) === "string"
				? String(retrieval?.rerank_model ?? retrieval?.rerankModel)
				: undefined,
		timeoutMs: positiveIntegerSetting(retrieval?.rerank_timeout_ms ?? retrieval?.rerankTimeoutMs, 800, 5_000),
		minConfidence: boundedNumberSetting(retrieval?.rerank_min_confidence ?? retrieval?.rerankMinConfidence, 0.5),
	};
}

function resolveRerankModel(input: {
	modelRegistry: ModelRegistry;
	modelSelector?: string;
	fallbackModel?: Model<Api>;
}): Model<Api> | undefined {
	const available = input.modelRegistry.getAvailable();
	if (input.modelSelector) {
		const [provider, ...idParts] = input.modelSelector.split("/");
		const modelId = idParts.join("/");
		if (provider && modelId) {
			const direct = available.find((model) => model.provider === provider && model.id === modelId);
			if (direct) return direct;
		}
		const byId = available.find((model) => model.id === input.modelSelector || model.name === input.modelSelector);
		if (byId) return byId;
	}
	if (input.fallbackModel && input.modelRegistry.hasConfiguredAuth(input.fallbackModel)) return input.fallbackModel;
	return available[0];
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n")
		.trim();
}

function extractJsonObject(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const raw = fenced?.[1] ?? text;
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end < start) throw new Error("Memory reranker did not return JSON");
	return JSON.parse(raw.slice(start, end + 1));
}

function selectedIndexesFromResponse(value: unknown, minConfidence: number): number[] {
	const root = objectValue(value);
	const items = Array.isArray(root?.items) ? root.items : [];
	const selected: number[] = [];
	for (const item of items) {
		const record = objectValue(item);
		if (!record) continue;
		const index = typeof record.index === "number" && Number.isInteger(record.index) ? record.index : undefined;
		const use = record.use !== false;
		const confidence =
			typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : 1;
		if (index !== undefined && index >= 0 && use && confidence >= minConfidence) selected.push(index);
	}
	return [...new Set(selected)];
}

function buildRerankPrompt(query: string, memory: RecalledMemory): string {
	const candidates = memory.items.map((item, index) => ({
		index,
		text: typeof item.text === "string" ? item.text : "",
		score: typeof item.score === "number" ? item.score : undefined,
		source: item.source,
		scope: item.scope,
	}));
	return [
		"Select durable memory facts that are directly useful for the current user turn.",
		'Return only JSON with shape: {"items":[{"index":0,"use":true,"confidence":0.0,"reason":"short"}]}',
		"Use=false for stale, unrelated, duplicate, or merely topically similar memories.",
		"Prefer facts that change the assistant's next action. Do not include prose outside JSON.",
		"",
		`Current user turn:\n${query}`,
		"",
		`Candidate memories:\n${JSON.stringify(candidates, null, 2)}`,
	].join("\n");
}

export function createFastMemoryReranker(input: {
	modelRegistry: ModelRegistry;
	fallbackModel?: Model<Api>;
	settings?: MemoryRerankSettings;
	complete?: CompleteSimple;
}): MemoryReranker | undefined {
	const settings = input.settings ?? readMemoryRerankSettings();
	if (!settings.enabled) return undefined;
	const model = resolveRerankModel({
		modelRegistry: input.modelRegistry,
		modelSelector: settings.modelSelector,
		fallbackModel: input.fallbackModel,
	});
	if (!model) return undefined;
	const complete = input.complete ?? completeSimple;
	return async ({ query, memory }) => {
		if (memory.items.length === 0) return memory;
		const auth = await input.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(auth.error);
		const requestModel = auth.upstreamModelId ? { ...model, id: auth.upstreamModelId } : model;
		const response = await complete(
			requestModel,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: buildRerankPrompt(query, memory) }],
						timestamp: Date.now(),
					},
				],
				tools: [],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				extraBody: auth.extraBody,
				timeoutMs: settings.timeoutMs,
				maxRetries: 0,
			},
		);
		const indexes = selectedIndexesFromResponse(
			extractJsonObject(assistantText(response)),
			settings.minConfidence,
		).filter((index) => index < memory.items.length);
		if (indexes.length === 0) return undefined;
		const items = indexes
			.map((index) => memory.items[index]!)
			.filter((item) => typeof item.text === "string" && item.text.trim());
		if (items.length === 0) return undefined;
		return {
			items,
			context: items.map((item) => item.text!.trim()).join("\n"),
		};
	};
}
