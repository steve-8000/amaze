import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@steve-8000/amaze-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import amazeMemoryExtension from "../src/core/extensions/builtin/amaze-memory/index.ts";
import type { MemoryRecallResult, MemoryStoreResult } from "../src/core/extensions/builtin/amaze-memory/client.ts";
import type { ExtensionAPI, MessageRenderer, ToolDefinition } from "../src/core/extensions/types.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function renderText(component: { render(width: number): string[] }): string {
	return stripAnsi(component.render(120).join("\n"));
}

describe("amaze-memory extension", () => {
	let configDir: string;
	let configPath: string;
	let previousConfig: string | undefined;
	let previousPathMemoryPacket: string | undefined;

	beforeEach(() => {
		initTheme("dark");
		previousConfig = process.env.AMAZE_CONFIG;
		configDir = mkdtempSync(join(tmpdir(), "amaze-memory-test-"));
		configPath = join(configDir, "amaze.toml");
		writeFileSync(
			configPath,
			`
[tools.mem]
enabled = true

[skills]
enabled = false

[services.xenonite]
port = 8700
`,
		);
		process.env.AMAZE_CONFIG = configPath;
		previousPathMemoryPacket = process.env.PI_SUBAGENT_PATH_MEMORY_PACKET;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (previousConfig === undefined) {
			delete process.env.AMAZE_CONFIG;
		} else {
			process.env.AMAZE_CONFIG = previousConfig;
		}
		if (previousPathMemoryPacket === undefined) {
			delete process.env.PI_SUBAGENT_PATH_MEMORY_PACKET;
		} else {
			process.env.PI_SUBAGENT_PATH_MEMORY_PACKET = previousPathMemoryPacket;
		}
		rmSync(configDir, { recursive: true, force: true });
	});

	test("registers active memory tools and boxed renderers", () => {
		const tools: ToolDefinition[] = [];
		const renderers = new Map<string, MessageRenderer>();
		const handlers = new Map<string, unknown[]>();
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer(customType: string, renderer: MessageRenderer) {
				renderers.set(customType, renderer);
			},
			on(event: string, handler: unknown) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		expect(tools.map((tool) => tool.name)).toEqual(["mem_recall", "mem_search", "mem_store"]);
		expect(handlers.has("input")).toBe(true);
		expect(handlers.has("before_agent_start")).toBe(true);
		expect(handlers.has("turn_end")).toBe(true);
		expect(renderers.has("memory-search")).toBe(true);
		expect(renderers.has("memory-store")).toBe(true);

		const search = tools.find((tool) => tool.name === "mem_search");
		const searchComponent = search?.renderResult?.(
			{
				content: [{ type: "text", text: "" }],
				details: { items: [{ text: "리뷰는 fresh 컨텍스트를 우선 사용한다.", source: "semantic" }] },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ isError: false } as any,
		);
		expect(searchComponent).toBeDefined();
		expect(renderText(searchComponent ?? new Text("", 0, 0))).toContain("Memory-Search");
		expect(renderText(searchComponent ?? new Text("", 0, 0))).toContain("리뷰는 fresh 컨텍스트");

		const storeRenderer = renderers.get("memory-store");
		const storeComponent = storeRenderer?.(
			{
				role: "custom",
				customType: "memory-store",
				content: "",
				display: true,
				details: { items: [{ text: "과대 scout 문제를 반복하지 않는다.", source: "manual" }] } satisfies MemoryStoreResult,
				timestamp: 0,
			},
			{ expanded: false },
			theme,
		);
		expect(storeComponent).toBeDefined();
		expect(renderText(storeComponent ?? new Text("", 0, 0))).toContain("Memory-Store");
		expect(renderText(storeComponent ?? new Text("", 0, 0))).toContain("과대 scout 문제");
	});

	test("automatic recall and turn sync can be disabled explicitly", () => {
		writeFileSync(
			configPath,
			`
[tools.mem]
enabled = true
auto_recall = false
auto_sync = false

[skills]
enabled = false

[services.xenonite]
port = 8700
`,
		);
		const handlers = new Map<string, unknown[]>();
		const pi = {
			registerTool: vi.fn(),
			registerMessageRenderer: vi.fn(),
			on(event: string, handler: unknown) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		expect(handlers.has("input")).toBe(false);
		expect(handlers.has("before_agent_start")).toBe(false);
		expect(handlers.has("turn_end")).toBe(false);
	});

	test("mem_store rejects transient state without contacting Xenonite", async () => {
		const tools: ToolDefinition[] = [];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		const result = await store?.execute(
			"store-1",
			{ text: "The user is concerned about excessive memory calls and storage.", source: "direct_user_request" },
			undefined,
			undefined,
			{ sessionManager: { getSessionId: () => "session-1" } } as any,
		);

		const textPart = (result?.content as Array<{ type?: string; text?: string }> | undefined)?.find((part) => part.type === "text");
		expect(result?.details).toMatchObject({ added: 0 });
		expect(textPart?.text).toContain("transient state");
		const rendered = store?.renderResult?.(
			result as any,
			{ expanded: false, isPartial: false },
			theme,
			{ isError: false } as any,
		);
		const renderedText = renderText(rendered ?? new Text("", 0, 0));
		expect(renderedText).toContain("transient state");
		expect(renderedText).not.toContain("Already remembered");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("mem_store skips exact duplicates before writing", async () => {
		const tools: ToolDefinition[] = [];
		const durableText = "User prefers direct manual intervention when context_length_exceeded occurs.";
		const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const pathname = new URL(String(url)).pathname;
			if (pathname === "/health") {
				return { ok: true, async json() { return { ok: true }; } };
			}
			if (pathname === "/v1/memory/recall") {
				expect(JSON.parse(String(init?.body)).query).toBe(durableText);
				return {
					ok: true,
					async json() {
						return { items: [{ text: durableText, source: "semantic", score: 1 }], context: "" };
					},
				};
			}
			if (pathname === "/v1/memory/store") {
				throw new Error("duplicate memory should not be stored");
			}
			throw new Error(`unexpected request: ${pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		const result = await store?.execute(
			"store-1",
			{ text: durableText, source: "direct_user_request" },
			undefined,
			undefined,
			{ sessionManager: { getSessionId: () => "session-1" } } as any,
		);

		const textPart = (result?.content as Array<{ type?: string; text?: string }> | undefined)?.find((part) => part.type === "text");
		expect(textPart?.text).toContain("Already remembered");
		expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
			"/health",
			"/v1/memory/recall",
		]);
	});

	test("mem_store sends Xenonite path namespace from path memory packet", async () => {
		const tools: ToolDefinition[] = [];
		const durableText = "Path runtime prefers durable state files for task progress.";
		const packetPath = join(configDir, "path-memory.md");
		writeFileSync(packetPath, [
			"# Path Memory Packet",
			"",
			"```json",
			JSON.stringify({
				memory_scope: {
					type: "path",
					path_id: "folder.packages_coding_agent.src.runtime",
					memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
					xenonite_namespace: "path:packages/coding-agent/src/runtime",
				},
			}),
			"```",
		].join("\n"));
		process.env.PI_SUBAGENT_PATH_MEMORY_PACKET = packetPath;
		const payloads: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const pathname = new URL(String(url)).pathname;
			if (pathname === "/health") {
				return { ok: true, async json() { return { ok: true }; } };
			}
			payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			if (pathname === "/v1/memory/recall") {
				return { ok: true, async json() { return { items: [], context: "" }; } };
			}
			if (pathname === "/v1/memory/store") {
				return { ok: true, async json() { return { added: 1, skipped: [] }; } };
			}
			throw new Error(`unexpected request: ${pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		await store?.execute(
			"store-1",
			{ text: durableText, source: "direct_user_request" },
			undefined,
			undefined,
			{ sessionManager: { getSessionId: () => "session-1" } } as any,
		);

		expect(payloads).toHaveLength(2);
		for (const payload of payloads) {
			expect(payload.session_id).toBe("path:packages/coding-agent/src/runtime");
			expect(payload.namespace).toBe("path:packages/coding-agent/src/runtime");
			expect(payload.memory_scope).toBe("path");
			expect(payload.path_id).toBe("folder.packages_coding_agent.src.runtime");
			expect(payload.memory_path).toBe(".harness/memory/paths/packages/coding-agent/src/runtime");
		}
	});

	test("mem_store skips near-duplicate durable facts before writing", async () => {
		const tools: ToolDefinition[] = [];
		const newText = "User prefers manual intervention for context length exceeded failures.";
		const existingText = "User prefers direct manual intervention when context_length_exceeded occurs.";
		const fetchMock = vi.fn(async (url: string | URL) => {
			const pathname = new URL(String(url)).pathname;
			if (pathname === "/health") {
				return { ok: true, async json() { return { ok: true }; } };
			}
			if (pathname === "/v1/memory/recall") {
				return {
					ok: true,
					async json() {
						return { items: [{ text: existingText, source: "semantic", score: 0.84 }], context: "" };
					},
				};
			}
			if (pathname === "/v1/memory/store") {
				throw new Error("near-duplicate memory should not be stored");
			}
			throw new Error(`unexpected request: ${pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		const result = await store?.execute(
			"store-1",
			{ text: newText, source: "direct_user_request" },
			undefined,
			undefined,
			{ sessionManager: { getSessionId: () => "session-1" } } as any,
		);

		const textPart = (result?.content as Array<{ type?: string; text?: string }> | undefined)?.find((part) => part.type === "text");
		expect(textPart?.text).toContain("Already remembered");
		expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
			"/health",
			"/v1/memory/recall",
		]);
	});

	test("mem_store requires an explicit allowed storage source", async () => {
		const tools: ToolDefinition[] = [];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		const result = await store?.execute(
			"store-1",
			{ text: "User prefers concise final responses for routine implementation reports." },
			undefined,
			undefined,
			{ sessionManager: { getSessionId: () => "session-1" } } as any,
		);

		const textPart = (result?.content as Array<{ type?: string; text?: string }> | undefined)?.find((part) => part.type === "text");
		expect(result?.details).toMatchObject({ added: 0 });
		expect(textPart?.text).toContain("requires source");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("mem_store prompt avoids candidate approval wording", () => {
		const tools: ToolDefinition[] = [];
		const pi = {
			registerTool(tool: ToolDefinition) {
				tools.push(tool);
			},
			registerMessageRenderer: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const store = tools.find((tool) => tool.name === "mem_store");
		const promptText = [store?.description, store?.promptSnippet, ...(store?.promptGuidelines ?? [])].join("\n");
		expect(promptText).toContain("direct user instruction");
		expect(promptText).not.toMatch(/Memory Candidate|approval/i);
	});

	test("memory-store renderer labels skipped memories neutrally", () => {
		const renderers = new Map<string, MessageRenderer>();
		const pi = {
			registerTool: vi.fn(),
			registerMessageRenderer(customType: string, renderer: MessageRenderer) {
				renderers.set(customType, renderer);
			},
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const renderer = renderers.get("memory-store");
		const component = renderer?.(
			{
				role: "custom",
				customType: "memory-store",
				content: "",
				display: true,
				details: { added: 0, skipped: ["duplicate or policy-skipped fact"] } satisfies MemoryStoreResult,
				timestamp: 0,
			},
			{ expanded: false },
			theme,
		);

		const output = renderText(component ?? new Text("", 0, 0));
		expect(output).toContain("Skipped memory");
		expect(output).not.toContain("Already remembered");
	});

	test("memory-search custom renderer shows retrieved items instead of raw context dump", () => {
		const renderers = new Map<string, MessageRenderer>();
		const pi = {
			registerTool: vi.fn(),
			registerMessageRenderer(customType: string, renderer: MessageRenderer) {
				renderers.set(customType, renderer);
			},
			on: vi.fn(),
			sendMessage: vi.fn(),
			appendEntry: vi.fn(),
		} as unknown as ExtensionAPI;

		amazeMemoryExtension(pi);

		const renderer = renderers.get("memory-search");
		const component = renderer?.(
			{
				role: "custom",
				customType: "memory-search",
				content: "## Retrieved memory\n- should not be needed when items exist",
				display: true,
				details: {
					context: "## Retrieved memory\n- should not be needed when items exist",
					items: [{ text: "bounded item", source: "semantic", score: 0.9 }],
				} satisfies MemoryRecallResult,
				timestamp: 0,
			},
			{ expanded: false },
			theme,
		);

		const output = renderText(component ?? new Text("", 0, 0));
		expect(output).toContain("Memory-Search");
		expect(output).toContain("bounded item");
		expect(output).not.toContain("should not be needed");
	});
});
