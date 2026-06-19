import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createAllToolDefinitions } from "../src/core/tools/index.ts";

function writeConfig(configPath: string, xenoniteConfig = "enabled = true\nport = 18745\nauto_index = false"): void {
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
		writeConfig(configPath, 'enabled = false\nurl = "http://127.0.0.1:18745"\nauto_index = false');

		const tools = createAllToolDefinitions("/tmp/project");

		expect(tools.search_query).toBeUndefined();
		expect(tools.index_status).toBeUndefined();
	});

	it("calls the configured Xenonite url directly instead of MCP", async () => {
		writeConfig(configPath, 'enabled = true\nurl = "http://xenonite.example.test:9876/custom/"\nport = 18745\nauto_index = false');
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
			return {
				ok: true,
				async json() {
					return { ok: true, results: [{ relativePath: "src/storage.rs" }] };
				},
			} as Response;
		});

		const tools = createAllToolDefinitions("/tmp/project");
		const result = await tools.search_query.execute("call-1", { query: "zvec storage", limit: 3 }, undefined, undefined, context);

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("src/storage.rs");
		expect(calls).toEqual([
			{
				url: "http://xenonite.example.test:9876/custom/v1/code/search",
				body: {
					query: "zvec storage",
					limit: 3,
					projectPath: "/host/tmp/project",
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
		const result = await tools.mem_recall.execute("call-3", { query: "project decision", top_k: 2 }, undefined, undefined, context);

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
		await tools.mem_store.execute("call-4", {
			text: "This repo uses zvec storage.",
			source: "verified_durable_fact",
			scope: "global",
		}, undefined, undefined, context);
		await tools.mem_store.execute("call-5", {
			text: "Operator prefers concise Korean reports.",
			source: "direct_user_request",
			scope: "global",
		}, undefined, undefined, context);

		expect(calls.map((call) => call.body.memoryScope)).toEqual(["project", "global"]);
		expect(calls[0]?.body.projectPath).toBe("/host/tmp/project");
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
		const result = await tools.mem_optimize.execute("call-6", {
			dryRun: true,
			maxFacts: 10,
			batchSize: 2,
			useLlm: false,
		}, undefined, undefined, context);

		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("\"removed\": 1");
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
});
