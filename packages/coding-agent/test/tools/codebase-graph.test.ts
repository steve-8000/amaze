import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolSession } from "../../src/tools";
import {
	GetArchitectureTool,
	GetCodeSnippetTool,
	ListProjectsTool,
	QueryGraphTool,
	SearchCodeTool,
	SearchGraphTool,
	TracePathTool,
} from "../../src/tools/codebase-graph";

type TestFetch = NonNullable<ToolSession["fetch"]>;
type TestFetchInput = Parameters<TestFetch>[0];
type TestFetchInit = Parameters<TestFetch>[1];

function createTestSession(cwd = "/tmp/test", overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		...overrides,
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as ToolSession;
}

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
	const previous = process.env[name];
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
	try {
		return await fn();
	} finally {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	}
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "codebase-graph-test-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("codebase graph core tools", () => {
	it("infers the current indexed project through the HTTP endpoint for search_graph", async () => {
		const calls: unknown[] = [];
		const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
			const body = JSON.parse(String(init?.body));
			calls.push({ url: String(input), body });
			const toolName = body.params?.name ?? body.tool;
			if (toolName === "list_projects") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										projects: [
											{ name: "Users-steve-amaze-amaze-agent", root_path: "/workspaces/amaze-agent" },
										],
									}),
								},
							],
						},
					}),
				);
			}
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [{ type: "text", text: JSON.stringify({ ok: true, params: body.params.arguments }) }],
					},
				}),
			);
		};
		const tool = new SearchGraphTool(createTestSession("/workspaces/amaze-agent", { fetch }));

		await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
			await tool.execute("search-graph-test", { query: "build system prompt", label: "Function" });
		});

		expect(calls.map(call => (call as { body: { params?: { name?: string } } }).body.params?.name)).toEqual([
			"list_projects",
			"search_graph",
		]);
		expect((calls[1] as { body: { params: { arguments: unknown } } }).body.params.arguments).toEqual({
			query: "build system prompt",
			label: "Function",
			project: "Users-steve-amaze-amaze-agent",
		});
	});

	it("passes explicit project through without listing projects first", async () => {
		const calls: unknown[] = [];
		const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
			const body = JSON.parse(String(init?.body));
			calls.push({ url: String(input), body });
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [{ type: "text", text: JSON.stringify({ ok: true, params: body.params.arguments }) }],
					},
				}),
			);
		};
		const tool = new TracePathTool(createTestSession("/workspaces/amaze-agent", { fetch }));

		await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
			await tool.execute("trace-path-test", {
				project: "manual-project",
				function_name: "buildSystemPrompt",
				direction: "both",
			});
		});

		expect(calls).toHaveLength(1);
		expect((calls[0] as { body: { params: { name: string; arguments: unknown } } }).body.params).toEqual({
			name: "trace_path",
			arguments: {
				project: "manual-project",
				function_name: "buildSystemPrompt",
				direction: "both",
			},
		});
	});

	it("routes graph passthrough tools to the rocky backend, never the docker endpoint", async () => {
		// Regression: when memory.backend=rocky, get_code_snippet / trace_path /
		// get_architecture / query_graph used to silently fall through to the separate
		// AMAZE_CODEBASE_ENDPOINT backend (a different cache dir / project namespace),
		// reporting "project not found or not indexed" for a project search_graph could find.
		const rockyConfig: Record<string, unknown> = {
			"memory.backend": "rocky",
			"rocky.apiUrl": "http://rocky.test",
		};
		const settings = { get: (key: string) => rockyConfig[key] } as unknown as ToolSession["settings"];

		type GraphTool = { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
		type GraphToolCtor = new (session: ToolSession) => GraphTool;
		const cases: { Tool: GraphToolCtor; toolName: string; args: Record<string, unknown> }[] = [
			{ Tool: GetCodeSnippetTool, toolName: "get_code_snippet", args: { qualified_name: "Foo" } },
			{ Tool: TracePathTool, toolName: "trace_path", args: { function_name: "foo" } },
			{ Tool: GetArchitectureTool, toolName: "get_architecture", args: { aspects: ["packages"] } },
			{ Tool: QueryGraphTool, toolName: "query_graph", args: { query: "MATCH (n) RETURN n" } },
		];

		for (const { Tool, toolName, args } of cases) {
			const calls: { url: string; body: { tool?: string; arguments?: Record<string, unknown> } }[] = [];
			const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
				calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
				return new Response(JSON.stringify({ ok: true, search_scope: {}, result: { tool: toolName } }));
			};
			const tool = new Tool(createTestSession("/workspaces/amaze-agent", { fetch, settings }));

			await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
				await tool.execute(`${toolName}-rocky-test`, { ...args });
			});

			// list_projects is synthesized locally for the rocky backend (no network),
			// so the passthrough /call is the only request — and it must hit rocky.
			expect(calls).toHaveLength(1);
			expect(calls[0]?.url).toBe("http://rocky.test/v1/rocky/codebase/call");
			expect(calls[0]?.url).not.toContain("codebase.test");
			expect(calls[0]?.body.tool).toBe(toolName);
			expect(calls[0]?.body.arguments?.project).toBe("workspaces-amaze-agent");
			expect(calls[0]?.body.arguments).toMatchObject(args);
		}
	});

	it("infers a unique nested git workspace when cwd is an umbrella parent", async () => {
		await withTempDir(async root => {
			const nestedRoot = path.join(root, "amaze-agent");
			await mkdir(path.join(nestedRoot, ".git"), { recursive: true });
			const calls: unknown[] = [];
			const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
				const body = JSON.parse(String(init?.body));
				calls.push({ url: String(input), body });
				const toolName = body.params?.name ?? body.tool;
				if (toolName === "list_projects") {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							result: {
								content: [
									{
										type: "text",
										text: JSON.stringify({
											projects: [{ name: "Users-steve-omp-amaze-agent", root_path: nestedRoot }],
										}),
									},
								],
							},
						}),
					);
				}
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: {
							content: [{ type: "text", text: JSON.stringify({ ok: true, params: body.params.arguments }) }],
						},
					}),
				);
			};
			const tool = new SearchGraphTool(createTestSession(root, { fetch }));

			await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
				await tool.execute("search-graph-nested-git", { query: "build system prompt", label: "Function" });
			});

			expect(calls.map(call => (call as { body: { params?: { name?: string } } }).body.params?.name)).toEqual([
				"list_projects",
				"search_graph",
			]);
			expect((calls[1] as { body: { params: { arguments: unknown } } }).body.params.arguments).toEqual({
				query: "build system prompt",
				label: "Function",
				project: "Users-steve-omp-amaze-agent",
			});
		});
	});

	it("infers a unique nested package root when no nested git root is present", async () => {
		await withTempDir(async root => {
			const nestedRoot = path.join(root, "some-package");
			await mkdir(nestedRoot, { recursive: true });
			await writeFile(path.join(nestedRoot, "package.json"), "{}");
			const calls: unknown[] = [];
			const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
				const body = JSON.parse(String(init?.body));
				calls.push({ url: String(input), body });
				const toolName = body.params?.name ?? body.tool;
				if (toolName === "list_projects") {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							id: 1,
							result: {
								content: [
									{
										type: "text",
										text: JSON.stringify({
											projects: [{ name: "Users-steve-omp-some-package", root_path: nestedRoot }],
										}),
									},
								],
							},
						}),
					);
				}
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: {
							content: [{ type: "text", text: JSON.stringify({ ok: true, params: body.params.arguments }) }],
						},
					}),
				);
			};
			const tool = new SearchGraphTool(createTestSession(root, { fetch }));

			await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
				await tool.execute("search-graph-nested-package", { query: "build system prompt", label: "Function" });
			});

			expect(calls.map(call => (call as { body: { params?: { name?: string } } }).body.params?.name)).toEqual([
				"list_projects",
				"search_graph",
			]);
			expect((calls[1] as { body: { params: { arguments: unknown } } }).body.params.arguments).toEqual({
				query: "build system prompt",
				label: "Function",
				project: "Users-steve-omp-some-package",
			});
		});
	});

	it("refuses to guess when multiple nested indexed roots exist", async () => {
		await withTempDir(async root => {
			const amazeAgentRoot = path.join(root, "amaze-agent");
			const amazeRoot = path.join(root, "amaze");
			await mkdir(path.join(amazeAgentRoot, ".git"), { recursive: true });
			await mkdir(path.join(amazeRoot, ".git"), { recursive: true });
			const calls: unknown[] = [];
			const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
				const body = JSON.parse(String(init?.body));
				calls.push({ url: String(input), body });
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										projects: [
											{ name: "Users-steve-omp-amaze-agent", root_path: amazeAgentRoot },
											{ name: "Users-steve-omp-amaze", root_path: amazeRoot },
										],
									}),
								},
							],
						},
					}),
				);
			};
			const tool = new SearchGraphTool(createTestSession(root, { fetch }));

			await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", async () => {
				await expect(
					tool.execute("search-graph-nested-ambiguous", { query: "build system prompt", label: "Function" }),
				).rejects.toThrow(/Multiple nested indexed projects match cwd/);
			});

			expect(calls.map(call => (call as { body: { params?: { name?: string } } }).body.params?.name)).toEqual([
				"list_projects",
			]);
		});
	});

	it("proxies list_projects through the HTTP endpoint", async () => {
		const fetch = async () =>
			new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [
							{ type: "text", text: JSON.stringify({ projects: [{ name: "repo", root_path: "/repo" }] }) },
						],
					},
				}),
			);
		const tool = new ListProjectsTool(createTestSession("/repo", { fetch }));
		const result = await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", () =>
			tool.execute("list-projects-test", {}),
		);

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0] && "text" in result.content[0] ? result.content[0].text : "").toContain("repo");
	});

	it("uses the configured codebase HTTP endpoint", async () => {
		const calls: unknown[] = [];
		const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
			calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: { content: [{ type: "text", text: JSON.stringify({ ok: true, summary: "architecture" }) }] },
				}),
			);
		};
		const tool = new GetArchitectureTool(createTestSession("/repo", { fetch }));

		const result = await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", () =>
			tool.execute("get-architecture-test", { project: "repo", aspects: ["packages"] }),
		);

		expect(calls).toEqual([
			{
				url: "http://codebase.test/rpc",
				body: {
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "get_architecture", arguments: { project: "repo", aspects: ["packages"] } },
				},
			},
		]);
		expect(result.details?.serverName).toBe("codebase-endpoint");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("architecture");
	});

	it("passes an explicit Rocky search scope contract to Rocky codebase search", async () => {
		const calls: unknown[] = [];
		const fetch = async (input: TestFetchInput, init?: TestFetchInit) => {
			calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ ok: true, results: [], search_scope: { effective_roots: ["/repo"] } }));
		};
		const settings = {
			get: (name: string) => {
				if (name === "memory.backend") return "rocky";
				if (name === "rocky.apiUrl") return "http://rocky.test";
				if (name === "rocky.projectPath") return "/repo";
				return undefined;
			},
		};
		const tool = new SearchCodeTool(
			createTestSession("/repo/packages/app", { fetch, settings } as Partial<ToolSession>),
		);

		await tool.execute("search-code-rocky-scope", { pattern: "RockyMemoryService", scope: "parent_1" });

		expect(calls).toEqual([
			{
				url: "http://rocky.test/v1/rocky/codebase/search_code",
				body: {
					path: "/repo",
					cwd: "/repo/packages/app",
					scope: "parent_1",
					max_parent_depth: 1,
					pattern: "RockyMemoryService",
				},
			},
		]);
	});

	it("falls back to the endpoint cli route when rpc is not available", async () => {
		const calls: string[] = [];
		const fetch = async (input: TestFetchInput) => {
			calls.push(String(input));
			if (String(input).endsWith("/rpc")) return new Response("not found", { status: 404 });
			return new Response(JSON.stringify({ ok: true, projects: [{ name: "repo", root_path: "/repo" }] }));
		};
		const tool = new ListProjectsTool(createTestSession("/repo", { fetch }));

		const result = await withEnv("AMAZE_CODEBASE_ENDPOINT", "http://codebase.test", () =>
			tool.execute("list-projects-test", {}),
		);

		expect(calls).toEqual(["http://codebase.test/rpc", "http://codebase.test/cli"]);
		expect(result.details?.serverName).toBe("codebase-endpoint");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("repo");
	});

	it("fails clearly when no backend is available", async () => {
		const tool = new GetArchitectureTool(createTestSession("/repo"));
		await withEnv("AMAZE_CODEBASE_ENDPOINT", undefined, async () => {
			await withEnv("ROCKY_CODEBASE_ENDPOINT", undefined, async () => {
				await expect(
					tool.execute("get-architecture-test", { project: "repo", aspects: ["packages"] }),
				).rejects.toThrow("Codebase graph backend unavailable");
			});
		});
	});
});
