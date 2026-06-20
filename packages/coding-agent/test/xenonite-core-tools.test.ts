import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import {
	autoPrepareXenoniteCore,
	createAllToolDefinitions,
	executeApiTool,
	listApiTools,
	recallMemoryForTurn,
	storeMemoryFact,
} from "../src/core/tools/index.ts";

function writeConfig(
	configPath: string,
	xenoniteConfig = 'enabled = true\ntransport = "http"\nport = 18745\nauto_index = false',
): void {
	writeFileSync(
		configPath,
		`
[tools.search]
enabled = true

[services.xenonite]
${xenoniteConfig}
`,
	);
}

describe("Xenonite core tools", () => {
	let originalConfig: string | undefined;
	let originalFetch: typeof globalThis.fetch;
	let configDir: string;
	let configPath: string;
	const context = {} as ExtensionContext;

	beforeEach(() => {
		vi.restoreAllMocks();
		originalConfig = process.env.AMAZE_CONFIG;
		originalFetch = globalThis.fetch;
		configDir = mkdtempSync(join(tmpdir(), "xenonite-core-tools-"));
		configPath = join(configDir, "amaze.toml");
		process.env.AMAZE_CONFIG = configPath;
		writeConfig(configPath);
	});

	afterEach(() => {
		if (originalConfig === undefined) {
			delete process.env.AMAZE_CONFIG;
		} else {
			process.env.AMAZE_CONFIG = originalConfig;
		}
		globalThis.fetch = originalFetch;
		rmSync(configDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("registers Xenonite search tools from the core registry when enabled", () => {
		const tools = createAllToolDefinitions("/tmp/project");

		expect(tools.search_query).toBeDefined();
		expect(tools.index_status).toBeDefined();
		expect(tools.graph_symbol).toBeDefined();
	});

	it("does not register Xenonite core tools when disabled", () => {
		writeConfig(
			configPath,
			'enabled = false\ntransport = "http"\nurl = "http://127.0.0.1:18745"\nauto_index = false',
		);

		const tools = createAllToolDefinitions("/tmp/project");

		expect(tools.search_query).toBeUndefined();
		expect(tools.index_status).toBeUndefined();
	});

	it("calls the configured Xenonite url directly", async () => {
		writeConfig(
			configPath,
			'enabled = true\ntransport = "http"\nurl = "http://xenonite.example.test:9876/custom/"\nport = 18745\nauto_index = false',
		);
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					if (String(url).endsWith("/v1/code/status")) return { ok: true, status: "completed" };
					if (String(url).endsWith("/v1/code/update")) return { ok: true };
					return { ok: true, results: [{ relativePath: "src/storage.rs" }] };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const result = await tools.search_query.execute(
			"call-1",
			{ query: "zvec storage", limit: 3 },
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("src/storage.rs");
		expect(calls).toEqual([
			{
				url: "http://xenonite.example.test:9876/custom/v1/code/status",
				body: { projectPath: "/host/tmp/project" },
			},
			{
				url: "http://xenonite.example.test:9876/custom/v1/code/search",
				body: {
					query: "zvec storage",
					limit: 3,
					projectPath: "/host/tmp/project",
				},
			},
			{
				url: "http://xenonite.example.test:9876/custom/v1/code/update",
				body: { projectPath: "/host/tmp/project" },
			},
		]);
	});

	it("freshens the requested project in the background for unknown-location context engine selection", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		let resolveStatus: ((response: Response) => void) | undefined;
		const contextCalled = new Promise<void>((resolve) => {
			globalThis.fetch = vi.fn(async (url, init) => {
				calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
				if (String(url).endsWith("/v1/code/status")) {
					return await new Promise<Response>((resolve) => {
						resolveStatus = resolve;
					});
				}
				if (String(url).endsWith("/v1/code/index"))
					return {
						ok: true,
						async json() {
							return { ok: true, filesIndexed: 2 };
						},
					} as Response;
				resolve();
				return {
					ok: true,
					async json() {
						return {
							ok: true,
							targets: [
								{
									relativePath: "src/answer.ts",
									readArgs: {
										projectPath: "/host/tmp/fixture",
										filePath: "src/answer.ts",
										startLine: 1,
										endLine: 3,
										contextLines: 0,
										maxLines: 80,
										lineNumbers: true,
									},
								},
							],
							context: [],
							assessment: { shouldReadMore: false },
						};
					},
				} as Response;
			});
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const resultPromise = tools.context_engine.execute(
			"call-context",
			{
				projectPath: "/tmp/fixture",
				task: "Find hiddenAnswerToken",
				hints: { symbols: ["hiddenAnswerToken"] },
			},
			undefined,
			undefined,
			context,
		);

		await contextCalled;
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/code/status",
				body: { projectPath: "/host/tmp/fixture" },
			},
			{
				url: "http://127.0.0.1:18745/v1/engine/context",
				body: {
					projectPath: "/host/tmp/fixture",
					task: "Find hiddenAnswerToken",
					hints: { symbols: ["hiddenAnswerToken"] },
				},
			},
		]);
		resolveStatus?.({
			ok: true,
			async json() {
				return { ok: true, status: "missing" };
			},
		} as Response);
		const result = await resultPromise;
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("src/answer.ts");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("readArgs");
		await new Promise((resolve) => setImmediate(resolve));
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/code/status",
				body: { projectPath: "/host/tmp/fixture" },
			},
			{
				url: "http://127.0.0.1:18745/v1/engine/context",
				body: {
					projectPath: "/host/tmp/fixture",
					task: "Find hiddenAnswerToken",
					hints: { symbols: ["hiddenAnswerToken"] },
				},
			},
			{
				url: "http://127.0.0.1:18745/v1/code/index",
				body: { projectPath: "/host/tmp/fixture" },
			},
		]);
	});

	it("uses local Xenonite tool mode for context engine when configured", async () => {
		const fakeBin = join(configDir, "fake-xenonite");
		writeFileSync(
			fakeBin,
			`#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(JSON.stringify({
    ok: true,
    op: request.op,
    args: request.args,
    targets: [{ relativePath: "src/local.ts" }]
  }));
});
`,
		);
		chmodSync(fakeBin, 0o755);
		writeConfig(
			configPath,
			`enabled = true
transport = "tool"
root = "${configDir}"
bin = "${fakeBin}"
auto_index = true
`,
		);
		globalThis.fetch = vi.fn(async () => {
			throw new Error("HTTP should not be used for local tool mode");
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const result = await tools.context_engine.execute(
			"local-context",
			{
				projectPath: "/tmp/project",
				task: "Find local evidence",
			},
			undefined,
			undefined,
			context,
		);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain('"op": "context_engine"');
		expect(text).toContain('"src/local.ts"');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("does not freshen context engine when explicit files can be read directly", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						context: [{ relativePath: "src/answer.ts", content: "hidden token" }],
						trace: { strategy: "explicit_file_single_read", fastContextUsed: false },
						assessment: { shouldReadMore: false },
					};
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		await tools.context_engine.execute(
			"call-context-explicit",
			{
				projectPath: "/tmp/fixture",
				task: "Read explicit file",
				hints: { files: ["src/answer.ts"] },
			},
			undefined,
			undefined,
			context,
		);

		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/engine/context",
				body: {
					projectPath: "/host/tmp/fixture",
					task: "Read explicit file",
					hints: { files: ["src/answer.ts"] },
				},
			},
		]);
	});

	it("uses direct code operation endpoints for infrastructure operations", async () => {
		let body: Record<string, unknown> | undefined;
		globalThis.fetch = vi.fn(async (_url, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return {
				ok: true,
				async json() {
					return { ok: true };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		await tools.index_health.execute("call-2", {}, undefined, undefined, context);

		expect(body).toEqual({ op: "codebase_health", args: {} });
	});

	it("auto-prepare refreshes completed indexes instead of leaving them stale", async () => {
		writeConfig(
			configPath,
			'enabled = true\ntransport = "http"\nport = 18745\nauto_index = true\nauto_watch = false',
		);
		const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
			calls.push({ url: String(url), body });
			return {
				ok: true,
				async json() {
					if (String(url).endsWith("/v1/code/status")) {
						return { ok: true, status: "completed", indexedFiles: 10 };
					}
					return { ok: true };
				},
				async text() {
					return "";
				},
			} as Response;
		});

		await autoPrepareXenoniteCore("/tmp/project");

		expect(calls).toEqual([
			{ url: "http://127.0.0.1:18745/health" },
			{ url: "http://127.0.0.1:18745/v1/code/status", body: { projectPath: "/host/tmp/project" } },
			{ url: "http://127.0.0.1:18745/v1/code/update", body: { projectPath: "/host/tmp/project" } },
		]);
	});

	it("registers memory tools from core and calls Xenonite memory endpoints directly", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return { ok: true, items: [{ text: "remembered fact" }] };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const result = await tools.mem_recall.execute(
			"call-3",
			{ query: "project decision", top_k: 2 },
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("remembered fact");
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/memory/recall",
				body: {
					query: "project decision",
					top_k: 2,
					memoryScope: "project",
					projectPath: "/host/tmp/project",
					session_id: "default",
				},
			},
		]);
	});

	it("keeps verified project facts out of global memory unless explicitly user-directed", async () => {
		const calls: Array<{ body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (_url, init) => {
			calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return { ok: true, added: 1, items: [] };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		await tools.mem_store.execute(
			"call-4",
			{
				text: "This repo uses zvec storage.",
				source: "verified_durable_fact",
				scope: "global",
			},
			undefined,
			undefined,
			context,
		);
		await tools.mem_store.execute(
			"call-5",
			{
				text: "Operator prefers concise Korean reports.",
				source: "direct_user_request",
				scope: "global",
			},
			undefined,
			undefined,
			context,
		);

		expect(calls.map((call) => call.body.memoryScope)).toEqual(["project", "global"]);
		expect(calls[0]?.body.projectPath).toBe("/host/tmp/project");
	});

	it("recalls and stores memory from core turn middleware helpers", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					if (String(url).endsWith("/v1/memory/recall")) {
						return {
							ok: true,
							items: [{ text: "Use core memory middleware." }],
							context: "Use core memory middleware.",
						};
					}
					return { ok: true, added: 1, items: [{ text: "Core memory stores candidates." }] };
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "memory policy", 3);
		const stored = await storeMemoryFact("/tmp/project", "Core memory stores candidates.", "verified_durable_fact");

		expect(recalled?.context).toBe("Use core memory middleware.");
		expect(stored).toBe(true);
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/memory/recall",
				body: {
					query: "memory policy",
					top_k: 30,
					memoryScope: "project",
					projectPath: "/host/tmp/project",
					session_id: "default",
				},
			},
			{
				url: "http://127.0.0.1:18745/v1/memory/store",
				body: {
					text: "Core memory stores candidates.",
					source: "verified_durable_fact",
					memoryScope: "project",
					projectPath: "/host/tmp/project",
					session_id: "default",
				},
			},
		]);
	});

	it("filters automatic turn memory recall to high relevance candidates", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						items: [
							{ id: "low", text: "Unrelated orchestration runtime fact.", score: 0.01 },
							{
								id: "high",
								text: "Memory retrieval should use rerank filtering before prompt injection.",
								score: 0.82,
							},
							{ id: "medium", text: "Memory retrieval policy keeps only relevant memories.", score: 0.32 },
						],
						context: [
							"Unrelated orchestration runtime fact.",
							"Memory retrieval should use rerank filtering before prompt injection.",
							"Memory retrieval policy keeps only relevant memories.",
						].join("\n"),
					};
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "memory retrieval rerank filtering", 2);

		expect(recalled?.items.map((item) => item.id)).toEqual(["high", "medium"]);
		expect(recalled?.context).toContain("rerank filtering");
		expect(recalled?.context).toContain("relevant memories");
		expect(recalled?.context).not.toContain("Unrelated orchestration");
		expect(calls[0]?.body.top_k).toBe(30);
	});

	it("does not inject fallback memory context when all item candidates are filtered out", async () => {
		globalThis.fetch = vi.fn(async () => {
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						items: [
							{ id: "low-a", text: "Unrelated orchestration runtime fact.", score: 0.01 },
							{ id: "low-b", text: "Another unrelated runtime note.", score: 0.02 },
						],
						context: ["Unrelated orchestration runtime fact.", "Another unrelated runtime note."].join("\n"),
					};
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "memory retrieval rerank filtering", 2);

		expect(recalled).toBeUndefined();
	});

	it("uses configured automatic memory retrieval policy for operational tuning", async () => {
		writeConfig(
			configPath,
			`enabled = true
transport = "http"
port = 18745
auto_index = false

[tools.mem]
enabled = true

[tools.mem.retrieval]
candidate_top_k = 7
final_top_k = 2
min_relevance = 0.4`,
		);
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						items: [
							{ id: "high", text: "Memory retrieval policy can be tuned operationally.", score: 0.9 },
							{ id: "medium", text: "Memory retrieval keeps useful configured candidates.", score: 0.5 },
							{ id: "low", text: "Memory retrieval candidate below configured threshold.", score: 0.2 },
						],
						context: "backend context should be rebuilt from selected items",
					};
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "memory retrieval policy");

		expect(calls[0]?.body.top_k).toBe(7);
		expect(recalled?.items.map((item) => item.id)).toEqual(["high", "medium"]);
		expect(recalled?.context).toContain("tuned operationally");
		expect(recalled?.context).toContain("configured candidates");
		expect(recalled?.context).not.toContain("configured threshold");
		expect(recalled?.context).not.toContain("backend context");
	});

	it("supports distance score mode for memory retrieval ranking", async () => {
		writeConfig(
			configPath,
			`enabled = true
transport = "http"
port = 18745
auto_index = false

[tools.mem]
enabled = true

[tools.mem.retrieval]
candidate_top_k = 5
final_top_k = 2
min_relevance = 0.5
score_mode = "distance"`,
		);
		globalThis.fetch = vi.fn(async () => {
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						items: [
							{ id: "near", text: "Near distance memory retrieval match.", score: 0.1 },
							{ id: "far", text: "Far distance memory retrieval match.", score: 5 },
							{ id: "middle", text: "Middle distance memory retrieval match.", score: 1 },
						],
						context: "backend context should be ignored",
					};
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "unmatched query terms");

		expect(recalled?.items.map((item) => item.id)).toEqual(["near", "middle"]);
		expect(recalled?.context).toContain("Near distance");
		expect(recalled?.context).toContain("Middle distance");
		expect(recalled?.context).not.toContain("Far distance");
	});

	it("drops unscored zero-relevance memories when scored candidates are present", async () => {
		globalThis.fetch = vi.fn(async () => {
			return {
				ok: true,
				async json() {
					return {
						ok: true,
						items: [
							{ id: "scored", text: "Memory retrieval scored candidate.", score: 0.8 },
							{ id: "unscored", text: "Completely unrelated legacy note." },
						],
						context: "backend context should be ignored",
					};
				},
			} as Response;
		});

		const recalled = await recallMemoryForTurn("/tmp/project", "memory retrieval", 5);

		expect(recalled?.items.map((item) => item.id)).toEqual(["scored"]);
		expect(recalled?.context).not.toContain("legacy note");
	});

	it("registers memory optimizer tool and calls Xenonite optimize endpoint directly", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return { ok: true, dryRun: true, applied: false, scanned: 3, kept: 2, removed: 1, moved: 1, scopes: [] };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const result = await tools.mem_optimize.execute(
			"call-6",
			{
				dryRun: true,
				maxFacts: 10,
				batchSize: 2,
				useLlm: false,
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain('"removed": 1');
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/memory/optimize",
				body: {
					dryRun: true,
					maxFacts: 10,
					batchSize: 2,
					useLlm: false,
					projectPath: "/host/tmp/project",
				},
			},
		]);
	});

	it("publishes Xenonite tools through the core API contract", () => {
		const tools = listApiTools("/tmp/project");
		const names = tools.map((tool) => tool.name);

		expect(names).toContain("index_status");
		expect(names).toContain("context_engine");
		expect(names).toContain("search_query");
		expect(names).toContain("code_read");
		expect(names).toContain("mem_delete");
		expect(names).not.toContain("read");
		expect(names).not.toContain("raw_read");
		expect(names).not.toContain("grep");
		expect(names).not.toContain("find");
		expect(names).not.toContain("ls");
		expect(tools.find((tool) => tool.name === "context_engine")?.description).toContain("targets[].readArgs");
		expect(tools.find((tool) => tool.name === "index_status")?.description).toContain("indexing progress");
		expect(tools.find((tool) => tool.name === "code_read")?.description).toContain(
			"exact bounded source/text file span",
		);
	});

	it("keeps legacy local search tools behind explicit opt-in", () => {
		const tools = listApiTools("/tmp/project", { includeLegacyLocalSearchTools: true });
		const names = tools.map((tool) => tool.name);

		expect(names).toContain("grep");
		expect(names).toContain("find");
		expect(names).toContain("ls");
	});

	it("executes Xenonite tools through the core API contract", async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
			return {
				ok: true,
				async json() {
					return { ok: true, status: "indexed" };
				},
			} as Response;
		});

		const result = await executeApiTool("/tmp/project", "index_status", {});

		expect(result.ok).toBe(true);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain('"status": "indexed"');
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/code/status",
				body: { projectPath: "/host/tmp/project" },
			},
		]);
	});

	it("executes context_engine through the core API contract", async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
			return {
				ok: true,
				async json() {
					return { ok: true, assessment: { shouldReadMore: false } };
				},
			} as Response;
		});

		const result = await executeApiTool("/tmp/project", "context_engine", {
			task: "read secret",
			hints: { files: ["src/secret.ts"] },
			pathScope: "/tmp/project/src",
		});

		expect(result.ok).toBe(true);
		expect(calls).toEqual([
			{
				url: "http://127.0.0.1:18745/v1/engine/context",
				body: {
					projectPath: "/host/tmp/project",
					task: "read secret",
					hints: { files: ["src/secret.ts"] },
					pathScope: "/host/tmp/project/src",
				},
			},
		]);
	});
});
