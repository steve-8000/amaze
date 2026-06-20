import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@steve-8000/amaze-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	getModel,
	type TextContent,
} from "@steve-8000/amaze-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession, rerankRecalledMemoryForTurn } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { RecalledMemory } from "../src/core/tools/index.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function assistantMessage(text: string): AssistantMessage {
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

function memory(items: Array<{ text: string }>): RecalledMemory {
	return {
		items,
		context: items.map((item) => item.text).join("\n"),
	};
}

describe("AgentSession memory rerank hook", () => {
	let tempDir: string | undefined;
	let originalConfig: string | undefined;
	let originalFetch: typeof globalThis.fetch = globalThis.fetch;

	afterEach(() => {
		if (originalConfig === undefined) {
			delete process.env.AMAZE_CONFIG;
		} else {
			process.env.AMAZE_CONFIG = originalConfig;
		}
		globalThis.fetch = originalFetch;
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
		vi.restoreAllMocks();
	});

	it("uses reranked memory before prompt injection formatting", async () => {
		const recalled = memory([{ text: "Keep this relevant memory." }, { text: "Drop this unrelated memory." }]);

		const reranked = await rerankRecalledMemoryForTurn(recalled, "relevant task", async ({ query, memory }) => {
			expect(query).toBe("relevant task");
			return {
				items: memory.items.slice(0, 1),
				context: "Keep this relevant memory.",
			};
		});

		expect(reranked?.items.map((item) => item.text)).toEqual(["Keep this relevant memory."]);
		expect(reranked?.context).toBe("Keep this relevant memory.");
	});

	it("allows reranker to suppress memory injection", async () => {
		const reranked = await rerankRecalledMemoryForTurn(
			memory([{ text: "Low confidence memory." }]),
			"unrelated task",
			async () => undefined,
		);

		expect(reranked).toBeUndefined();
	});

	it("falls back to deterministic memory when reranker fails", async () => {
		const recalled = memory([{ text: "Deterministic fallback memory." }]);

		const reranked = await rerankRecalledMemoryForTurn(recalled, "task", async () => {
			throw new Error("reranker unavailable");
		});

		expect(reranked).toBe(recalled);
	});

	it("proves rerank hook can replace recalled memory context", async () => {
		const reranked = await rerankRecalledMemoryForTurn(
			memory([{ text: "Keep practical rerank memory." }, { text: "Drop unrelated stale memory." }]),
			"memory rerank practical test",
			async ({ memory }) => ({
				items: memory.items.slice(0, 1),
				context: "Keep practical rerank memory.",
			}),
		);

		expect(reranked?.context).toContain("Keep practical rerank memory.");
		expect(reranked?.context).not.toContain("Drop unrelated stale memory.");
	});

	it("proves practical prompt-path rerank by changing injected memory_context", async () => {
		originalConfig = process.env.AMAZE_CONFIG;
		originalFetch = globalThis.fetch;
		tempDir = join(tmpdir(), `memory-rerank-practical-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		const configPath = join(tempDir, "amaze.toml");
		writeFileSync(
			configPath,
			`
[services.xenonite]
enabled = true
transport = "http"
url = "http://127.0.0.1:18745"
auto_index = false
`,
		);
		process.env.AMAZE_CONFIG = configPath;
		globalThis.fetch = vi.fn(
			async () =>
				({
					ok: true,
					async json() {
						return {
							ok: true,
							items: [
								{ text: "Keep practical rerank memory.", score: 0.9 },
								{ text: "Drop unrelated stale memory.", score: 0.8 },
							],
						};
					},
				}) as Response,
		);

		let injectedMemoryContext = "";
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			convertToLlm,
			streamFn: (_model, context) => {
				const userTexts = context.messages
					.filter((message) => message.role === "user")
					.flatMap((message) =>
						typeof message.content === "string"
							? [message.content]
							: message.content
									.filter((part): part is TextContent => part.type === "text")
									.map((part) => part.text),
					);
				injectedMemoryContext = userTexts.join("\n");
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistantMessage("") });
					stream.push({ type: "done", reason: "stop", message: assistantMessage("done") });
				});
				return stream;
			},
		});
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(tempDir, tempDir),
			cwd: tempDir,
			modelRegistry: ModelRegistry.create(authStorage, tempDir),
			resourceLoader: createTestResourceLoader(),
			memoryReranker: async ({ memory }) => ({
				items: memory.items.slice(0, 1),
				context: "Keep practical rerank memory.",
			}),
		});

		try {
			await session.prompt("memory rerank practical test");
		} finally {
			session.dispose();
		}

		expect(injectedMemoryContext).toContain("Keep practical rerank memory.");
		expect(injectedMemoryContext).not.toContain("Drop unrelated stale memory.");
	});
});
