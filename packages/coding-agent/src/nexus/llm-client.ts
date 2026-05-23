/**
 * Nexus LLM client.
 *
 * Speaks OpenAI-compatible `/v1/chat/completions`. Designed to be small,
 * dependency-free, and safe-by-default: every call is bounded by a timeout
 * (AbortController) and a single retry on transient errors.
 *
 * The client never throws across the public surface — failures resolve with
 * `{ ok: false, error }` so the surrounding agent loop is never broken by an
 * unavailable local LLM.
 */
import { logger } from "@amaze/utils";

import type { NexusConfig } from "./config";

export type NexusLlmMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

export interface NexusLlmCompleteInput {
	messages: NexusLlmMessage[];
	system?: string;
	temperature?: number;
	maxTokens?: number;
	jsonMode?: boolean;
	stop?: string[];
	signal?: AbortSignal;
}

export type NexusLlmResult =
	| { ok: true; content: string; usage?: { prompt: number; completion: number } }
	| { ok: false; error: string };

export interface NexusLlmClient {
	readonly provider: string;
	readonly model: string;
	complete(input: NexusLlmCompleteInput): Promise<NexusLlmResult>;
	completeJson<T>(
		input: NexusLlmCompleteInput & { validate?: (value: unknown) => value is T },
	): Promise<{ ok: true; value: T } | { ok: false; error: string }>;
}

export interface NexusLlmClientOptions {
	fetch?: typeof fetch;
	timeoutMs?: number;
	retries?: number;
	apiKey?: string;
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRIES = 1;

export function createNexusLlmClient(config: NexusConfig, options: NexusLlmClientOptions = {}): NexusLlmClient | null {
	if (!config.llmEnabled) return null;
	const provider = config.llmProvider;
	const baseUrl = sanitizeBaseUrl(config.llmBaseUrl);
	const model = config.llmModel?.trim();
	if (!model) {
		logger.debug("Nexus LLM disabled: model not configured", { provider });
		return null;
	}
	if (!baseUrl) {
		logger.debug("Nexus LLM disabled: baseUrl not configured", { provider, model });
		return null;
	}
	switch (provider) {
		case "openai-compatible":
		case "openai":
		case "vllm":
		case "lm-studio":
		case "mtplx":
			return new OpenAiCompatibleLlmClient({ provider, baseUrl, model, options });
		default:
			logger.debug("Nexus LLM disabled: unknown provider", { provider });
			return null;
	}
}

function sanitizeBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim().replace(/\/+$/, "");
	return trimmed ? trimmed : undefined;
}

class OpenAiCompatibleLlmClient implements NexusLlmClient {
	readonly provider: string;
	readonly model: string;
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	readonly #timeoutMs: number;
	readonly #retries: number;
	readonly #headers: Record<string, string>;

	constructor(args: { provider: string; baseUrl: string; model: string; options: NexusLlmClientOptions }) {
		this.provider = args.provider;
		this.#baseUrl = args.baseUrl;
		this.model = args.model;
		this.#fetch = args.options.fetch ?? fetch;
		this.#timeoutMs = args.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.#retries = args.options.retries ?? DEFAULT_RETRIES;
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json",
		};
		if (args.options.apiKey) headers.authorization = `Bearer ${args.options.apiKey}`;
		if (args.options.headers) Object.assign(headers, args.options.headers);
		this.#headers = headers;
	}

	async complete(input: NexusLlmCompleteInput): Promise<NexusLlmResult> {
		const url = `${this.#baseUrl}/v1/chat/completions`;
		const messages: NexusLlmMessage[] = input.system
			? [{ role: "system", content: input.system }, ...input.messages]
			: input.messages;
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			temperature: input.temperature ?? 0,
			stream: false,
		};
		if (typeof input.maxTokens === "number") body.max_tokens = input.maxTokens;
		if (input.stop && input.stop.length > 0) body.stop = input.stop;
		if (input.jsonMode) body.response_format = { type: "json_object" };

		const payload = JSON.stringify(body);
		let lastError: unknown = null;
		for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
			const controller = new AbortController();
			const upstreamSignal = input.signal;
			const onAbort = () => controller.abort(upstreamSignal?.reason);
			upstreamSignal?.addEventListener("abort", onAbort, { once: true });
			const timer = setTimeout(
				() => controller.abort(new Error(`Nexus LLM timeout after ${this.#timeoutMs}ms`)),
				this.#timeoutMs,
			);
			try {
				const response = await this.#fetch(url, {
					method: "POST",
					headers: this.#headers,
					body: payload,
					signal: controller.signal,
				});
				if (!response.ok) {
					const text = await response.text().catch(() => "");
					lastError = `HTTP ${response.status}: ${text.slice(0, 240)}`;
					if (response.status < 500 || attempt === this.#retries) {
						return { ok: false, error: String(lastError) };
					}
					continue;
				}
				const json = (await response.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const content = json.choices?.[0]?.message?.content ?? "";
				if (!content.trim()) {
					lastError = "empty completion";
					if (attempt === this.#retries) return { ok: false, error: "Empty completion" };
					continue;
				}
				return {
					ok: true,
					content,
					usage: json.usage
						? { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 }
						: undefined,
				};
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				if (attempt === this.#retries) return { ok: false, error: String(lastError) };
			} finally {
				clearTimeout(timer);
				upstreamSignal?.removeEventListener("abort", onAbort);
			}
		}
		return { ok: false, error: String(lastError ?? "unknown error") };
	}

	async completeJson<T>(
		input: NexusLlmCompleteInput & { validate?: (value: unknown) => value is T },
	): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
		const result = await this.complete({ ...input, jsonMode: true });
		if (!result.ok) return result;
		const parsed = parseLooseJson(result.content);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		if (input.validate && !input.validate(parsed.value)) {
			return { ok: false, error: "Validation failed for LLM JSON response" };
		}
		return { ok: true, value: parsed.value as T };
	}
}

/**
 * Tolerant JSON parser for LLM responses.
 *
 * LLMs love to wrap JSON in code fences or to add a preamble. We strip the
 * obvious wrappers, then try `JSON.parse`. If that still fails we attempt to
 * carve out the first balanced `{…}` / `[…]` block.
 */
export function parseLooseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
	const candidates = collectJsonCandidates(content);
	for (const candidate of candidates) {
		try {
			return { ok: true, value: JSON.parse(candidate) };
		} catch {}
	}
	return { ok: false, error: `Could not parse JSON from LLM response (len=${content.length})` };
}

function collectJsonCandidates(content: string): string[] {
	const trimmed = content.trim();
	const candidates: string[] = [trimmed];
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence?.[1]) candidates.push(fence[1].trim());
	const objectMatch = extractBalanced(trimmed, "{", "}");
	if (objectMatch) candidates.push(objectMatch);
	const arrayMatch = extractBalanced(trimmed, "[", "]");
	if (arrayMatch) candidates.push(arrayMatch);
	return candidates;
}

function extractBalanced(text: string, open: string, close: string): string | null {
	const start = text.indexOf(open);
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === open) depth += 1;
		else if (ch === close) {
			depth -= 1;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}
