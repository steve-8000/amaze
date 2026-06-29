import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	AMAZE_CODEBASE_TOOL_NAMES,
	AMAZE_SKILL_TOOL_NAMES,
	CODEBASE_MEMORY_NATIVE_TOOL_NAMES,
	CodebaseMemoryNativeAdapter,
	createCodebaseMemoryNativeToolDefinitions,
	resolveCodebaseMemoryBinary,
} from "../src/core/codebase/index.ts";
import { getApiTool, listApiTools } from "../src/core/tools/index.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const canonicalRoot = realpathSync(root);
	tempDirs.push(canonicalRoot);
	return canonicalRoot;
}

function writeExecutableNodeScript(path: string, source: string): void {
	writeFileSync(path, `#!/usr/bin/env node\n${source}`);
	chmodSync(path, 0o755);
}

describe("codebase-memory native contract", () => {
	test("tracks the original 14 codebase-memory-mcp tools separately from amaze skill tools", () => {
		expect(CODEBASE_MEMORY_NATIVE_TOOL_NAMES).toEqual([
			"index_repository",
			"search_graph",
			"query_graph",
			"trace_path",
			"get_code_snippet",
			"get_graph_schema",
			"get_architecture",
			"search_code",
			"list_projects",
			"delete_project",
			"index_status",
			"detect_changes",
			"manage_adr",
			"ingest_traces",
		]);
		expect(CODEBASE_MEMORY_NATIVE_TOOL_NAMES).toHaveLength(14);
		expect(AMAZE_SKILL_TOOL_NAMES).toEqual(["skill_search", "skill_get", "put_skill", "delete_skill"]);
		for (const skillTool of AMAZE_SKILL_TOOL_NAMES) {
			expect(CODEBASE_MEMORY_NATIVE_TOOL_NAMES).not.toContain(skillTool);
		}
		expect(AMAZE_CODEBASE_TOOL_NAMES).toEqual(
			expect.arrayContaining(["index_repository", "search_code", "skill_search", "delete_skill"]),
		);
	});

	test("resolves explicit native binary paths without requiring npm install scripts", () => {
		const root = tempDir("amaze-cbm-native-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(binaryPath, "process.exit(0);\n");

		const resolution = resolveCodebaseMemoryBinary({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});

		expect(resolution).toMatchObject({
			path: binaryPath,
			source: "env",
			platform: "darwin-arm64",
		});
		expect(resolution.checked_paths[0]).toBe(binaryPath);
	});

	test("does not resolve directories as native binaries", () => {
		const root = tempDir("amaze-cbm-native-dir-");
		const envDirectory = join(root, "env-codebase-memory-mcp");
		const packageDirectory = join(
			root,
			"package",
			"native",
			"codebase-memory-mcp",
			"darwin-arm64",
			"codebase-memory-mcp",
		);
		mkdirSync(envDirectory, { recursive: true });
		mkdirSync(packageDirectory, { recursive: true });

		const resolution = resolveCodebaseMemoryBinary({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: envDirectory },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});

		expect(resolution).toMatchObject({
			source: "missing",
			platform: "darwin-arm64",
		});
		expect(resolution.checked_paths).toEqual(expect.arrayContaining([envDirectory, packageDirectory]));
	});

	test("calls the native cli JSON mode and unwraps MCP text content", async () => {
		const root = tempDir("amaze-cbm-cli-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
const [, , subcommand, jsonFlag, toolName, argsJson] = process.argv;
if (subcommand !== "cli" || jsonFlag !== "--json") {
	process.exit(2);
}
const args = JSON.parse(argsJson);
const payload = { toolName, project: args.project, total: 1 };
process.stdout.write(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }) + "\\n");
`,
		);

		const adapter = new CodebaseMemoryNativeAdapter({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});

		await expect(adapter.callTool("search_graph", { project: "demo" })).resolves.toEqual({
			toolName: "search_graph",
			project: "demo",
			total: 1,
		});
	});

	test("turns native MCP error envelopes into adapter errors", async () => {
		const root = tempDir("amaze-cbm-error-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
process.stdout.write(JSON.stringify({
	isError: true,
	content: [{ type: "text", text: JSON.stringify({ error: "missing project" }) }]
}) + "\\n");
`,
		);

		const adapter = new CodebaseMemoryNativeAdapter({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});

		await expect(adapter.callTool("search_graph", {})).rejects.toThrow("missing project");
	});

	test("times out native subprocesses", async () => {
		const root = tempDir("amaze-cbm-timeout-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
setTimeout(() => {
	process.stdout.write(JSON.stringify({ content: [{ type: "text", text: "{}" }] }) + "\\n");
}, 10_000);
`,
		);

		const adapter = new CodebaseMemoryNativeAdapter({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
			timeoutMs: 25,
		});

		await expect(adapter.callTool("list_projects", {})).rejects.toThrow("codebase-memory-mcp failed");
	});

	test("aborts native subprocesses when the tool signal is cancelled", async () => {
		const root = tempDir("amaze-cbm-abort-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
setTimeout(() => {
	process.stdout.write(JSON.stringify({ content: [{ type: "text", text: "{}" }] }) + "\\n");
}, 10_000);
`,
		);

		const adapter = new CodebaseMemoryNativeAdapter({
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
			timeoutMs: 5_000,
		});
		const controller = new AbortController();
		const call = adapter.callTool("list_projects", {}, { signal: controller.signal });
		setTimeout(() => controller.abort(), 25);

		await expect(call).rejects.toThrow("aborted");
	});

	test("creates native tool definitions for the original 14 tools without amaze skill tools", async () => {
		const root = tempDir("amaze-cbm-native-tools-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
const toolName = process.argv[4];
process.stdout.write(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ ok: true, toolName }) }] }) + "\\n");
`,
		);

		const tools = createCodebaseMemoryNativeToolDefinitions(root, {
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});
		expect(tools.map((tool) => tool.name)).toEqual([...CODEBASE_MEMORY_NATIVE_TOOL_NAMES]);
		for (const skillTool of AMAZE_SKILL_TOOL_NAMES) {
			expect(tools.map((tool) => tool.name)).not.toContain(skillTool);
		}
		const queryGraph = tools.find((tool) => tool.name === "query_graph");
		await expect(
			queryGraph?.execute(
				"tool-call",
				{ project: "demo", query: "MATCH (n) RETURN n" },
				undefined,
				undefined,
				undefined as never,
			),
		).resolves.toEqual(
			expect.objectContaining({
				content: [{ type: "text", text: JSON.stringify({ ok: true, toolName: "query_graph" }) }],
				details: expect.objectContaining({
					envelope: expect.objectContaining({
						content: [{ type: "text", text: JSON.stringify({ ok: true, toolName: "query_graph" }) }],
					}),
				}),
				isError: false,
			}),
		);
	});

	test("preserves native MCP error envelopes in tool execution results", async () => {
		const root = tempDir("amaze-cbm-native-tool-error-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
process.stdout.write(JSON.stringify({
	isError: true,
	content: [{ type: "text", text: JSON.stringify({ error: "project not indexed" }) }]
}) + "\\n");
`,
		);

		const tools = createCodebaseMemoryNativeToolDefinitions(root, {
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});
		const searchGraph = tools.find((tool) => tool.name === "search_graph");

		await expect(
			searchGraph?.execute("tool-call", { project: "demo" }, undefined, undefined, undefined as never),
		).resolves.toEqual(
			expect.objectContaining({
				content: [{ type: "text", text: JSON.stringify({ error: "project not indexed" }) }],
				details: expect.objectContaining({
					envelope: expect.objectContaining({ isError: true }),
				}),
				isError: true,
			}),
		);
	});

	test("preserves native MCP content instead of rewrapping the first text payload", async () => {
		const root = tempDir("amaze-cbm-native-envelope-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(
			binaryPath,
			`
process.stdout.write(JSON.stringify({
	content: [
		{ type: "text", text: "primary" },
		{ type: "text", text: "secondary" }
	],
	structuredContent: { total: 2 }
}) + "\\n");
`,
		);

		const tools = createCodebaseMemoryNativeToolDefinitions(root, {
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin",
			arch: "arm64",
		});
		const listProjects = tools.find((tool) => tool.name === "list_projects");

		await expect(listProjects?.execute("tool-call", {}, undefined, undefined, undefined as never)).resolves.toEqual(
			expect.objectContaining({
				content: [
					{ type: "text", text: "primary" },
					{ type: "text", text: "secondary" },
				],
				details: expect.objectContaining({
					envelope: expect.objectContaining({
						structuredContent: { total: 2 },
					}),
				}),
				isError: false,
			}),
		);
	});

	test("adds native codebase-memory tools to the API tool catalog without replacing core tools", () => {
		const root = tempDir("amaze-cbm-api-tools-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(binaryPath, "process.exit(0);\n");
		const codebaseMemory = {
			env: { AMAZE_CODEBASE_MEMORY_MCP_BIN: binaryPath },
			packageDir: join(root, "package"),
			platform: "darwin" as const,
			arch: "arm64",
		};

		const defaultNames = listApiTools(root).map((tool) => tool.name);
		for (const nativeTool of CODEBASE_MEMORY_NATIVE_TOOL_NAMES) {
			expect(defaultNames).not.toContain(nativeTool);
		}

		const tools = listApiTools(root, { codebaseMemory });
		const names = tools.map((tool) => tool.name);

		expect(names).toEqual(expect.arrayContaining(["read", "bash", ...CODEBASE_MEMORY_NATIVE_TOOL_NAMES]));
		for (const skillTool of AMAZE_SKILL_TOOL_NAMES) {
			expect(names).not.toContain(skillTool);
		}
		expect(getApiTool(root, "trace_path", { codebaseMemory })?.description).toContain("native graph");
	});

	test("uses the same environment merge for API catalog gating as native tool execution", () => {
		const root = tempDir("amaze-cbm-api-env-merge-");
		const binaryPath = join(root, "codebase-memory-mcp");
		writeExecutableNodeScript(binaryPath, "process.exit(0);\n");
		const previousBinaryPath = process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN;
		process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN = binaryPath;

		try {
			const tools = listApiTools(root, {
				codebaseMemory: {
					env: { CBM_CACHE_DIR: join(root, "cache") },
					packageDir: join(root, "package"),
					platform: "darwin",
					arch: "arm64",
				},
			});

			expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([...CODEBASE_MEMORY_NATIVE_TOOL_NAMES]));
		} finally {
			if (previousBinaryPath === undefined) {
				delete process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN;
			} else {
				process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN = previousBinaryPath;
			}
		}
	});

	test.skipIf(!process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN)(
		"round-trips graph schema, query_graph, and trace_path through a real native binary",
		async () => {
			const root = tempDir("amaze-cbm-real-fixture-");
			const cacheDir = tempDir("amaze-cbm-real-cache-");
			execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "src", "model-resolver.ts"),
				[
					'export const defaultModelPerProvider: Record<string, string> = { openai: "gpt-5" };',
					"export function caller() { return callee(); }",
					"export function callee() { return defaultModelPerProvider.openai; }",
					"",
				].join("\n"),
			);
			const adapter = new CodebaseMemoryNativeAdapter({
				cwd: root,
				env: {
					AMAZE_CODEBASE_MEMORY_MCP_BIN: process.env.AMAZE_CODEBASE_MEMORY_MCP_BIN,
					CBM_CACHE_DIR: cacheDir,
				},
			});

			await expect(
				adapter.callTool("index_repository", {
					repo_path: root,
					mode: "fast",
					name: "amaze-native-real-smoke",
				}),
			).resolves.toMatchObject({ project: "amaze-native-real-smoke", status: "indexed" });
			await expect(adapter.callTool("get_graph_schema", { project: "amaze-native-real-smoke" })).resolves.toEqual(
				expect.objectContaining({
					node_labels: expect.arrayContaining([expect.objectContaining({ label: "Function" })]),
				}),
			);
			await expect(
				adapter.callTool("query_graph", {
					project: "amaze-native-real-smoke",
					query: "MATCH (f:Function) RETURN f.name LIMIT 5",
					max_rows: 5,
				}),
			).resolves.toMatchObject({
				rows: expect.arrayContaining([["caller"], ["callee"]]),
			});
			await expect(
				adapter.callTool("trace_path", {
					project: "amaze-native-real-smoke",
					function_name: "callee",
					direction: "both",
					depth: 2,
				}),
			).resolves.toMatchObject({
				function: "callee",
				callers: [expect.objectContaining({ name: "caller" })],
			});
			await expect(
				adapter.callTool("search_code", {
					project: "amaze-native-real-smoke",
					pattern: "defaultModelPerProvider",
					limit: 5,
				}),
			).resolves.toEqual(expect.objectContaining({ total_grep_matches: expect.any(Number) }));
		},
	);
});
