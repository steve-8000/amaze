import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAllToolDefinitions } from "../src/core/tools/index.ts";

function writeConfig(
	configPath: string,
	xenoniteConfig = 'enabled = true\ntransport = "http"\nport = 18745\nauto_index = false',
	memEnabled = true,
): void {
	writeFileSync(
		configPath,
		`
[tools.search]
enabled = true

[tools.mem]
enabled = ${memEnabled}

[services.rocky]
enabled = true
url = "http://rocky.example.test:30000"

[services.xenonite]
${xenoniteConfig}
`,
	);
}

describe("Xenonite/Rocky core tools", () => {
	let originalConfig: string | undefined;
	let configDir: string;
	let configPath: string;

	beforeEach(() => {
		vi.restoreAllMocks();
		originalConfig = process.env.AMAZE_CONFIG;
		configDir = mkdtempSync(join(tmpdir(), "xenonite-memory-tools-"));
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
		rmSync(configDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("registers Rocky native tools and keeps legacy Xenonite core tools disabled", () => {
		const tools = createAllToolDefinitions("/tmp/project");

		expect(tools.rocky_search).toBeDefined();
		expect(tools.rocky_memory_recall).toBeDefined();
		expect(tools.rocky_memory_search).toBeDefined();
		expect(tools.rocky_memory_store).toBeDefined();
		expect(tools.rocky_memory_optimize).toBeDefined();
		expect(tools.rocky_memory_delete).toBeDefined();
		expect(tools.mem_recall).toBeUndefined();
		expect(tools.mem_search).toBeUndefined();
		expect(tools.mem_store).toBeUndefined();
		expect(tools.mem_optimize).toBeUndefined();
		expect(tools.mem_delete).toBeUndefined();
		expect(tools.context_engine).toBeUndefined();
		expect(tools.code_read).toBeUndefined();
		expect(tools.search_query).toBeUndefined();
		expect(tools.index_status).toBeUndefined();
		expect(tools.graph_symbol).toBeUndefined();
		expect(tools.ctx_search).toBeUndefined();
	});

	it("calls configured Rocky URL for search", async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, body: JSON.parse(String(init?.body)) });
				return new Response(
					JSON.stringify({ status: "ok", evidence: [], runtime: { fastcontext: { used: true } } }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);
		const tools = createAllToolDefinitions("/tmp/project");

		const result = await tools.rocky_search.execute("call_1", { query: "find route" }, undefined, undefined, {
			cwd: "/tmp/project",
		} as Parameters<typeof tools.rocky_search.execute>[4]);

		expect(calls).toEqual([
			{
				url: "http://rocky.example.test:30000/v1/search",
				body: { query: "find route", projectPath: "/host/tmp/project", path: "/host/tmp/project" },
			},
		]);
		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type !== "text") throw new Error("expected text content");
		expect(firstContent.text).toContain('"status": "ok"');
	});
});
