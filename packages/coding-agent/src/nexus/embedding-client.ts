/**
 * Nexus embedding client.
 *
 * Two providers are supported out of the box:
 *
 *   - `ollama`            → `POST {baseUrl}/api/embed` with `{ model, input: string[] }`
 *   - `openai-compatible` → `POST {baseUrl}/v1/embeddings` with `{ model, input: string[] }`
 *
 * Both return `Float32Array[]` shaped to one vector per input. Failures resolve
 * with `{ ok: false, error }` so the rest of the agent loop keeps running with
 * pure FTS fallback.
 */
import { logger } from "@amaze/utils";

import type { NexusConfig } from "./config";

export interface NexusEmbeddingBatch {
	vectors: Float32Array[];
	model: string;
}

export type NexusEmbeddingResult = { ok: true; batch: NexusEmbeddingBatch } | { ok: false; error: string };

export interface NexusEmbeddingClient {
	readonly provider: string;
	readonly model: string;
	/**
	 * Best-effort embedding dimension. Known when at least one successful call
	 * has been observed. Callers must tolerate `null`.
	 */
	dimension(): number | null;
	embed(inputs: string[], options?: { signal?: AbortSignal }): Promise<NexusEmbeddingResult>;
}

export interface NexusEmbeddingClientOptions {
	fetch?: typeof fetch;
	timeoutMs?: number;
	apiKey?: string;
	headers?: Record<string, string>;
	/**
	 * Maximum number of inputs sent in a single HTTP call. Larger batches are
	 * chunked transparently.
	 */
	batchSize?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 32;

export function createNexusEmbeddingClient(
	config: NexusConfig,
	options: NexusEmbeddingClientOptions = {},
): NexusEmbeddingClient | null {
	if (!config.embeddingsEnabled) return null;
	const baseUrl = sanitizeBaseUrl(config.embeddingsBaseUrl);
	const model = config.embeddingsModel?.trim();
	if (!baseUrl) {
		logger.debug("Nexus embeddings disabled: baseUrl not configured", { provider: config.embeddingsProvider });
		return null;
	}
	if (!model) {
		logger.debug("Nexus embeddings disabled: model not configured", { provider: config.embeddingsProvider });
		return null;
	}
	switch (config.embeddingsProvider) {
		case "ollama":
			return new OllamaEmbeddingClient({ baseUrl, model, options });
		case "openai":
		case "openai-compatible":
		case "lm-studio":
		case "vllm":
			return new OpenAiCompatibleEmbeddingClient({ provider: config.embeddingsProvider, baseUrl, model, options });
		default:
			logger.debug("Nexus embeddings disabled: unknown provider", { provider: config.embeddingsProvider });
			return null;
	}
}

function sanitizeBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim().replace(/\/+$/, "");
	return trimmed ? trimmed : undefined;
}

abstract class BaseEmbeddingClient implements NexusEmbeddingClient {
	abstract readonly provider: string;
	readonly model: string;
	#dimension: number | null = null;
	readonly #batchSize: number;
	protected readonly fetchImpl: typeof fetch;
	protected readonly timeoutMs: number;
	protected readonly headers: Record<string, string>;

	constructor(args: { model: string; options: NexusEmbeddingClientOptions; defaultHeaders?: Record<string, string> }) {
		this.model = args.model;
		this.fetchImpl = args.options.fetch ?? fetch;
		this.timeoutMs = args.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.#batchSize = Math.max(1, args.options.batchSize ?? DEFAULT_BATCH_SIZE);
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json",
			...(args.defaultHeaders ?? {}),
		};
		if (args.options.apiKey) headers.authorization = `Bearer ${args.options.apiKey}`;
		if (args.options.headers) Object.assign(headers, args.options.headers);
		this.headers = headers;
	}

	dimension(): number | null {
		return this.#dimension;
	}

	async embed(inputs: string[], options: { signal?: AbortSignal } = {}): Promise<NexusEmbeddingResult> {
		if (inputs.length === 0) return { ok: true, batch: { vectors: [], model: this.model } };
		const vectors: Float32Array[] = [];
		for (let i = 0; i < inputs.length; i += this.#batchSize) {
			const slice = inputs.slice(i, i + this.#batchSize);
			const result = await this.embedBatch(slice, options.signal);
			if (!result.ok) return result;
			for (const vec of result.vectors) {
				if (this.#dimension === null && vec.length > 0) this.#dimension = vec.length;
				vectors.push(vec);
			}
		}
		return { ok: true, batch: { vectors, model: this.model } };
	}

	protected abstract embedBatch(
		inputs: string[],
		signal?: AbortSignal,
	): Promise<{ ok: true; vectors: Float32Array[] } | { ok: false; error: string }>;

	protected async post(
		url: string,
		body: unknown,
		signal?: AbortSignal,
	): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
		const controller = new AbortController();
		const onAbort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(
			() => controller.abort(new Error(`Nexus embeddings timeout after ${this.timeoutMs}ms`)),
			this.timeoutMs,
		);
		try {
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 240)}` };
			}
			const json = await response.json();
			return { ok: true, json };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	}
}

class OllamaEmbeddingClient extends BaseEmbeddingClient {
	readonly provider = "ollama";
	readonly #baseUrl: string;

	constructor(args: { baseUrl: string; model: string; options: NexusEmbeddingClientOptions }) {
		super({ model: args.model, options: args.options });
		this.#baseUrl = args.baseUrl;
	}

	protected async embedBatch(
		inputs: string[],
		signal?: AbortSignal,
	): Promise<{ ok: true; vectors: Float32Array[] } | { ok: false; error: string }> {
		const url = `${this.#baseUrl}/api/embed`;
		const result = await this.post(url, { model: this.model, input: inputs }, signal);
		if (!result.ok) return result;
		const payload = result.json as { embeddings?: number[][] };
		const embeddings = payload?.embeddings;
		if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) {
			return {
				ok: false,
				error: `Unexpected Ollama embed response shape (got ${Array.isArray(embeddings) ? embeddings.length : "non-array"} for ${inputs.length} inputs)`,
			};
		}
		return { ok: true, vectors: embeddings.map(vector => Float32Array.from(vector ?? [])) };
	}
}

class OpenAiCompatibleEmbeddingClient extends BaseEmbeddingClient {
	readonly provider: string;
	readonly #baseUrl: string;

	constructor(args: { provider: string; baseUrl: string; model: string; options: NexusEmbeddingClientOptions }) {
		super({ model: args.model, options: args.options });
		this.provider = args.provider;
		this.#baseUrl = args.baseUrl;
	}

	protected async embedBatch(
		inputs: string[],
		signal?: AbortSignal,
	): Promise<{ ok: true; vectors: Float32Array[] } | { ok: false; error: string }> {
		const url = `${this.#baseUrl}/v1/embeddings`;
		const result = await this.post(url, { model: this.model, input: inputs }, signal);
		if (!result.ok) return result;
		const payload = result.json as { data?: Array<{ embedding?: number[] }> };
		const data = payload?.data;
		if (!Array.isArray(data) || data.length !== inputs.length) {
			return {
				ok: false,
				error: `Unexpected OpenAI embed response shape (got ${Array.isArray(data) ? data.length : "non-array"} for ${inputs.length} inputs)`,
			};
		}
		return { ok: true, vectors: data.map(item => Float32Array.from(item?.embedding ?? [])) };
	}
}

/**
 * Cosine similarity between two equal-length vectors. Values outside [-1, 1]
 * indicate numerical drift or a length mismatch and are clamped to that range.
 * Returns 0 when either vector is the zero vector.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i += 1) {
		const av = a[i];
		const bv = b[i];
		dot += av * bv;
		magA += av * av;
		magB += bv * bv;
	}
	if (magA === 0 || magB === 0) return 0;
	const score = dot / Math.sqrt(magA * magB);
	if (score > 1) return 1;
	if (score < -1) return -1;
	return score;
}

export function vectorToBuffer(vector: Float32Array): Uint8Array {
	return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToVector(buffer: Uint8Array | ArrayBuffer | null | undefined): Float32Array {
	if (!buffer) return new Float32Array();
	if (buffer instanceof Float32Array) return buffer;
	if (buffer instanceof ArrayBuffer) return new Float32Array(buffer);
	const view = buffer as Uint8Array;
	return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}
