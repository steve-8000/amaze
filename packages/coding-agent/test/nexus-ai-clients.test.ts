import { describe, expect, it } from "bun:test";

import { Settings } from "@amaze/coding-agent/config/settings";
import { loadNexusConfig } from "@amaze/coding-agent/nexus/config";
import { cosineSimilarity, createNexusEmbeddingClient } from "@amaze/coding-agent/nexus/embedding-client";
import { createNexusLlmClient, parseLooseJson } from "@amaze/coding-agent/nexus/llm-client";

// Bun's `typeof fetch` includes a `preconnect` method we never need here.
// The clients only call `fetch(url, init)` so we accept the narrower shape.
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function asFetch(impl: FetchLike): typeof fetch {
	return impl as unknown as typeof fetch;
}

function makeSettings(overrides: Record<string, unknown>): Settings {
	return Settings.isolated(overrides);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

describe("nexus LLM client", () => {
	it("returns null when not enabled or model missing", () => {
		expect(createNexusLlmClient(loadNexusConfig(makeSettings({ "memory.backend": "nexus" })))).toBeNull();
		expect(
			createNexusLlmClient(
				loadNexusConfig(
					makeSettings({
						"memory.backend": "nexus",
						"nexus.llm.enabled": true,
						"nexus.llm.provider": "openai-compatible",
						"nexus.llm.baseUrl": "http://127.0.0.1:8000",
					}),
				),
			),
		).toBeNull();
	});

	it("posts to /v1/chat/completions and returns the assistant content", async () => {
		const captured: { url?: string; payload?: Record<string, unknown> } = {};
		const fakeFetch: FetchLike = async (input, init) => {
			captured.url = urlOf(input);
			captured.payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			return jsonResponse({
				choices: [{ message: { role: "assistant", content: "pong" } }],
				usage: { prompt_tokens: 3, completion_tokens: 1 },
			});
		};
		const client = createNexusLlmClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.llm.enabled": true,
					"nexus.llm.provider": "openai-compatible",
					"nexus.llm.baseUrl": "http://127.0.0.1:8000",
					"nexus.llm.model": "roy-llm",
				}),
			),
			{ fetch: asFetch(fakeFetch) },
		);
		expect(client).not.toBeNull();
		const result = await client!.complete({
			messages: [{ role: "user", content: "ping" }],
			maxTokens: 16,
			temperature: 0,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.content).toBe("pong");
		expect(captured.url).toBe("http://127.0.0.1:8000/v1/chat/completions");
		expect(captured.payload?.model).toBe("roy-llm");
		expect(captured.payload?.stream).toBe(false);
	});

	it("retries once on transient HTTP 503 and surfaces final error", async () => {
		let calls = 0;
		const fakeFetch: FetchLike = async () => {
			calls += 1;
			return new Response("upstream", { status: 503 });
		};
		const client = createNexusLlmClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.llm.enabled": true,
					"nexus.llm.provider": "openai-compatible",
					"nexus.llm.baseUrl": "http://127.0.0.1:8000",
					"nexus.llm.model": "roy-llm",
				}),
			),
			{ fetch: asFetch(fakeFetch), retries: 1, timeoutMs: 200 },
		);
		const result = await client!.complete({ messages: [{ role: "user", content: "x" }] });
		expect(result.ok).toBe(false);
		expect(calls).toBe(2);
	});

	it("retries with a larger maxTokens budget when the provider returns reasoning-only output", async () => {
		const payloads: Array<Record<string, unknown>> = [];
		const fakeFetch: FetchLike = async (_input, init) => {
			const payload = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			payloads.push(payload);
			if (payload.max_tokens === 64) {
				return jsonResponse({
					choices: [{ message: { role: "assistant", reasoning: "Need a few more tokens before final JSON." } }],
				});
			}
			return jsonResponse({
				choices: [{ message: { role: "assistant", content: '{"ok":true}' } }],
			});
		};
		const client = createNexusLlmClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.llm.enabled": true,
					"nexus.llm.provider": "openai-compatible",
					"nexus.llm.baseUrl": "http://127.0.0.1:8000",
					"nexus.llm.model": "roy-llm",
				}),
			),
			{ fetch: asFetch(fakeFetch), retries: 0 },
		);
		const result = await client!.completeJson<{ ok: true }>({
			messages: [{ role: "user", content: 'Return {"ok":true}.' }],
			system: "Return JSON only.",
			temperature: 0,
			maxTokens: 64,
			validate: (value): value is { ok: true } =>
				Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true),
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual({ ok: true });
		expect(payloads.map(payload => payload.max_tokens)).toEqual([64, 128]);
	});
	it("completeJson parses fenced JSON and rejects invalid payloads", async () => {
		const fakeFetch: FetchLike = async () =>
			jsonResponse({
				choices: [
					{
						message: {
							role: "assistant",
							content:
								'```json\n{"memories":[{"target":"user","content":"Reply concisely.","memoryType":"preference","confidence":"user_asserted"}]}\n```',
						},
					},
				],
			});
		const client = createNexusLlmClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.llm.enabled": true,
					"nexus.llm.provider": "openai-compatible",
					"nexus.llm.baseUrl": "http://127.0.0.1:8000",
					"nexus.llm.model": "roy-llm",
				}),
			),
			{ fetch: asFetch(fakeFetch) },
		);
		type Payload = { memories: Array<{ content: string }> };
		const parsed = await client!.completeJson<Payload>({
			messages: [{ role: "user", content: "extract" }],
			validate: (value): value is Payload => Array.isArray((value as Payload | undefined)?.memories),
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.value.memories[0]?.content).toBe("Reply concisely.");
	});

	it("parseLooseJson tolerates preamble and fences", () => {
		const fenced = 'Here you go:\n```json\n{"k":1}\n```';
		const result = parseLooseJson(fenced);
		expect(result.ok).toBe(true);
		if (result.ok) expect((result.value as { k: number }).k).toBe(1);
		const noisy = parseLooseJson('garbage {"k":2} trailing');
		expect(noisy.ok).toBe(true);
	});
});

describe("nexus embedding client", () => {
	it("returns null when disabled or unconfigured", () => {
		expect(createNexusEmbeddingClient(loadNexusConfig(makeSettings({ "memory.backend": "nexus" })))).toBeNull();
		expect(
			createNexusEmbeddingClient(
				loadNexusConfig(
					makeSettings({
						"memory.backend": "nexus",
						"nexus.embeddings.enabled": true,
						"nexus.embeddings.provider": "ollama",
					}),
				),
			),
		).toBeNull();
	});

	it("ollama provider posts /api/embed and maps embeddings to Float32Array", async () => {
		const fakeFetch: FetchLike = async (input, init) => {
			expect(urlOf(input)).toBe("http://127.0.0.1:11434/api/embed");
			const body = JSON.parse(String(init?.body)) as { input: string[] };
			expect(body.input).toEqual(["alpha", "beta"]);
			return jsonResponse({
				embeddings: [
					[1, 0, 0],
					[0, 1, 0],
				],
			});
		};
		const client = createNexusEmbeddingClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.embeddings.enabled": true,
					"nexus.embeddings.provider": "ollama",
					"nexus.embeddings.baseUrl": "http://127.0.0.1:11434",
					"nexus.embeddings.model": "bge-m3",
				}),
			),
			{ fetch: asFetch(fakeFetch), batchSize: 8 },
		);
		expect(client).not.toBeNull();
		const result = await client!.embed(["alpha", "beta"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.batch.vectors).toHaveLength(2);
			expect(Array.from(result.batch.vectors[0]!)).toEqual([1, 0, 0]);
			expect(Array.from(result.batch.vectors[1]!)).toEqual([0, 1, 0]);
			expect(result.batch.model).toBe("bge-m3");
		}
		expect(client!.dimension()).toBe(3);
	});

	it("openai-compatible provider posts /v1/embeddings and chunks large batches", async () => {
		const bodies: Array<string[]> = [];
		const fakeFetch: FetchLike = async (input, init) => {
			expect(urlOf(input)).toBe("http://localhost:9000/v1/embeddings");
			const body = JSON.parse(String(init?.body)) as { input: string[] };
			bodies.push(body.input);
			return jsonResponse({ data: body.input.map((_, idx) => ({ embedding: [idx, idx + 1, idx + 2] })) });
		};
		const client = createNexusEmbeddingClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.embeddings.enabled": true,
					"nexus.embeddings.provider": "openai-compatible",
					"nexus.embeddings.baseUrl": "http://localhost:9000",
					"nexus.embeddings.model": "text-embedding-3-small",
				}),
			),
			{ fetch: asFetch(fakeFetch), batchSize: 2 },
		);
		expect(client).not.toBeNull();
		const result = await client!.embed(["a", "b", "c", "d", "e"]);
		expect(result.ok).toBe(true);
		expect(bodies).toHaveLength(3);
		expect(bodies.map(batch => batch.length)).toEqual([2, 2, 1]);
		if (result.ok) expect(result.batch.vectors).toHaveLength(5);
	});

	it("propagates upstream errors as ok:false", async () => {
		const fakeFetch: FetchLike = async () => new Response("model not loaded", { status: 500 });
		const client = createNexusEmbeddingClient(
			loadNexusConfig(
				makeSettings({
					"memory.backend": "nexus",
					"nexus.embeddings.enabled": true,
					"nexus.embeddings.provider": "ollama",
					"nexus.embeddings.baseUrl": "http://127.0.0.1:11434",
					"nexus.embeddings.model": "bge-m3",
				}),
			),
			{ fetch: asFetch(fakeFetch) },
		);
		const result = await client!.embed(["x"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/HTTP 500/);
	});

	it("cosineSimilarity returns 1 for identical vectors and 0 for orthogonal", () => {
		const a = Float32Array.from([1, 2, 3]);
		const b = Float32Array.from([1, 2, 3]);
		expect(Math.abs(cosineSimilarity(a, b) - 1)).toBeLessThan(1e-6);
		expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBe(0);
		expect(cosineSimilarity(Float32Array.from([1, 0, 0]), Float32Array.from([]))).toBe(0);
	});
});
