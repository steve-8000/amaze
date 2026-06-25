import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, ApiKey, Model } from "@amaze/pi-ai";

export interface RockyMemoryLlmCompleteOptions {
	maxTokens?: number;
	temperature?: number;
	timeout?: number;
	provider?: string | null;
	model?: string | null;
}

export type RockyMemoryLlmCompletion = (
	prompt: string,
	opts?: RockyMemoryLlmCompleteOptions,
) => string | null | Promise<string | null>;

/**
 * What an embedding provider's `embed` returns: the embedding matrix streamed as async batches,
 * matching fastembed's `embed()` (`AsyncGenerator<number[][]>`). Each yielded batch is a list of
 * rows; each row is one number per dimension. Yield the whole matrix as a single batch when not
 * streaming: `async *embed(texts) { yield texts.map(embedOne); }`.
 */
export type EmbeddingOutput = AsyncIterable<number[][]>;

export interface RockyMemoryEmbeddingProvider {
	embed(texts: readonly string[]): EmbeddingOutput | Promise<EmbeddingOutput>;
	available?(): boolean | Promise<boolean>;
}

export interface RockyMemoryEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: RockyMemoryEmbeddingProvider | ((texts: readonly string[]) => EmbeddingOutput | Promise<EmbeddingOutput>);
	/** Override `ROCKY_MEMORY_EMBEDDING_MAX_INPUT_CHARS`. `0` disables the cap. See `config.embeddingMaxInputChars`. */
	maxInputChars?: number;
}

export interface RockyMemoryLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: RockyMemoryLlmCompletion;
	/** Override the fact-extraction prompt template ({text}/{lang}). Used to feed small local models a friendlier format. */
	extractionPrompt?: string;
	/** Override the consolidation/sleep prompt template ({memories}/{source}/{memory_count}). */
	consolidationPrompt?: string;
}

export interface RockyMemoryRuntimeOptions {
	embeddings?: false | RockyMemoryEmbeddingRuntimeOptions;
	llm?: false | RockyMemoryLlmRuntimeOptions | Model<Api> | RockyMemoryLlmCompletion;
	/** Verbose diagnostics: escalates best-effort failure logs from debug to warn. */
	debug?: boolean;
}

export interface ResolvedRockyMemoryEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: RockyMemoryEmbeddingProvider;
	maxInputChars?: number;
}

export interface ResolvedRockyMemoryLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: RockyMemoryLlmCompletion;
	extractionPrompt?: string;
	consolidationPrompt?: string;
}

export interface ResolvedRockyMemoryRuntimeOptions {
	embeddings?: ResolvedRockyMemoryEmbeddingRuntimeOptions;
	llm?: ResolvedRockyMemoryLlmRuntimeOptions;
	debug?: boolean;
}

const runtimeOptionsStorage = new AsyncLocalStorage<ResolvedRockyMemoryRuntimeOptions>();

export function withRockyMemoryRuntimeOptions<T>(
	options: ResolvedRockyMemoryRuntimeOptions | undefined,
	fn: () => T,
): T {
	if (options === undefined) {
		return fn();
	}
	return runtimeOptionsStorage.run(options, fn);
}

export function getRockyMemoryRuntimeOptions(): ResolvedRockyMemoryRuntimeOptions | undefined {
	return runtimeOptionsStorage.getStore();
}

/** Whether the active runtime scope requested verbose diagnostics (`rockyMemory.debug`). */
export function rockyMemoryDebugEnabled(): boolean {
	return runtimeOptionsStorage.getStore()?.debug === true;
}

export function resolveEmbeddingProvider(
	provider:
		| RockyMemoryEmbeddingProvider
		| ((texts: readonly string[]) => EmbeddingOutput | Promise<EmbeddingOutput>)
		| undefined,
): RockyMemoryEmbeddingProvider | undefined {
	if (provider === undefined) {
		return undefined;
	}
	if (typeof provider === "function") {
		return { embed: provider };
	}
	return provider;
}

export function isPiAiModel(value: unknown): value is Model<Api> {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const maybe = value as Partial<Model<Api>>;
	return (
		typeof maybe.id === "string" &&
		typeof maybe.provider === "string" &&
		typeof maybe.baseUrl === "string" &&
		typeof maybe.api === "string"
	);
}
