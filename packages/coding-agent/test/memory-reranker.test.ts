import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, getModel } from "@steve-8000/amaze-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createFastMemoryReranker, readMemoryRerankSettings } from "../src/core/memory-reranker.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import type { RecalledMemory } from "../src/core/tools/index.ts";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function recalledMemory(): RecalledMemory {
	return {
		items: [
			{ text: "Keep high actionability memory.", score: 0.9 },
			{ text: "Drop stale topical memory.", score: 0.8 },
		],
		context: "Keep high actionability memory.\nDrop stale topical memory.",
	};
}

describe("fast memory reranker", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
		vi.restoreAllMocks();
	});

	function registryWithAuth() {
		tempDir = join(tmpdir(), `memory-reranker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		return ModelRegistry.create(authStorage, tempDir);
	}

	it("returns undefined when rerank is disabled", () => {
		const reranker = createFastMemoryReranker({
			modelRegistry: registryWithAuth(),
			fallbackModel: getModel("anthropic", "claude-sonnet-4-5")!,
			settings: { enabled: false, timeoutMs: 800, minConfidence: 0.5 },
		});

		expect(reranker).toBeUndefined();
	});

	it("selects memories from structured fast LLM JSON", async () => {
		const complete = vi.fn(
			async (..._args: Parameters<NonNullable<Parameters<typeof createFastMemoryReranker>[0]["complete"]>>) =>
				assistant(
					JSON.stringify({
						items: [
							{ index: 0, use: true, confidence: 0.9, reason: "directly useful" },
							{ index: 1, use: false, confidence: 0.8, reason: "stale" },
						],
					}),
				),
		);
		const reranker = createFastMemoryReranker({
			modelRegistry: registryWithAuth(),
			fallbackModel: getModel("anthropic", "claude-sonnet-4-5")!,
			settings: { enabled: true, timeoutMs: 1234, minConfidence: 0.5 },
			complete,
		});

		const reranked = await reranker!({ query: "current task", memory: recalledMemory() });

		expect(complete).toHaveBeenCalledOnce();
		expect(complete.mock.calls[0]?.[2]?.timeoutMs).toBe(1234);
		expect(reranked?.items.map((item) => item.text)).toEqual(["Keep high actionability memory."]);
		expect(reranked?.context).toBe("Keep high actionability memory.");
	});

	it("suppresses memory when fast LLM selects nothing above confidence threshold", async () => {
		const reranker = createFastMemoryReranker({
			modelRegistry: registryWithAuth(),
			fallbackModel: getModel("anthropic", "claude-sonnet-4-5")!,
			settings: { enabled: true, timeoutMs: 800, minConfidence: 0.7 },
			complete: async () =>
				assistant(
					JSON.stringify({
						items: [{ index: 0, use: true, confidence: 0.2, reason: "weak" }],
					}),
				),
		});

		const reranked = await reranker!({ query: "current task", memory: recalledMemory() });

		expect(reranked).toBeUndefined();
	});

	it("reads enabled rerank settings from config raw object", () => {
		const settings = readMemoryRerankSettings({
			raw: {
				tools: {
					mem: {
						retrieval: {
							rerank: true,
							rerank_model: "anthropic/claude-haiku",
							rerank_timeout_ms: 250,
							rerank_min_confidence: 0.75,
						},
					},
				},
			},
		} as never);

		expect(settings).toEqual({
			enabled: true,
			modelSelector: "anthropic/claude-haiku",
			timeoutMs: 250,
			minConfidence: 0.75,
		});
	});
});
