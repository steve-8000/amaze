import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import amazeSearchExtension from "../src/core/extensions/builtin/amaze-search/index.ts";

interface RegisteredTool {
	name: string;
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function writeConfig(configPath: string): void {
	writeFileSync(
		configPath,
		`
[tools.search]
enabled = true

[services.xenonite]
port = 18745
auto_index = false
`,
	);
}

function registerSearchTools() {
	const tools = new Map<string, RegisteredTool>();
	amazeSearchExtension({
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

describe("amaze search Xenonite MCP contract", () => {
	let originalConfig: string | undefined;
	let originalFetch: typeof globalThis.fetch;
	let configDir: string;

	beforeEach(() => {
		vi.restoreAllMocks();
		originalConfig = process.env.AMAZE_CONFIG;
		originalFetch = globalThis.fetch;
		configDir = mkdtempSync(join(tmpdir(), "amaze-search-"));
		const configPath = join(configDir, "amaze.toml");
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

	it("forwards search_query to Xenonite xenonite_code_op over /v1/mcp", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			calls.push({ url: String(url), body });
			return {
				ok: true,
				async json() {
					return { result: { content: [{ type: "text", text: "semantic result" }] } };
				},
			} as Response;
		});

		const tools = registerSearchTools();
		const result = await tools.get("search_query")?.execute("call-1", { query: "find auth flow", limit: 3 });

		expect(result?.content[0]?.text).toBe("semantic result");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://127.0.0.1:18745/v1/mcp");
		expect(calls[0]?.body).toMatchObject({
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "xenonite_code_op",
				arguments: {
					op: "codebase_search",
					args: { query: "find auth flow", limit: 3 },
				},
			},
		});
	});

	it("forwards index_build through the same Xenonite MCP code-op contract", async () => {
		let body: Record<string, unknown> | undefined;
		globalThis.fetch = vi.fn(async (_url, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return {
				ok: true,
				async json() {
					return { result: { content: [{ type: "text", text: "index started" }] } };
				},
			} as Response;
		});

		const tools = registerSearchTools();
		const result = await tools.get("index_build")?.execute("call-2", { projectPath: "/tmp/project", extraExtensions: ".vue" });

		expect(result?.content[0]?.text).toBe("index started");
		expect(body).toMatchObject({
			params: {
				name: "xenonite_code_op",
				arguments: {
					op: "codebase_index",
					args: { projectPath: "/tmp/project", extraExtensions: ".vue" },
				},
			},
		});
	});

	it("returns clear full-mode guidance when Xenonite does not expose xenonite_code_op", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			async json() {
				return { error: { code: -32602, message: "Unknown tool: xenonite_code_op" } };
			},
		}) as Response);

		const tools = registerSearchTools();
		const result = await tools.get("search_query")?.execute("call-3", { query: "anything" });

		expect(result?.content[0]?.text).toContain("Xenonite error");
		expect(result?.content[0]?.text).toContain("Unknown tool: xenonite_code_op");
	});
});
