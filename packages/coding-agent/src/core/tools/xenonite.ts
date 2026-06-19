import { type TSchema, Type } from "typebox";
import { loadAmazeConfig } from "../../amaze/config.ts";
import type { ToolDefinition } from "../extensions/types.ts";

interface XenoniteToolSpec {
	name: string;
	endpoint: string;
	description: string;
	params: Record<string, TSchema>;
}

interface XenoniteCoreConfig {
	baseUrl: string;
	hostPrefix: string;
}

const projectPath = Type.Optional(Type.String({ description: "Absolute project directory path. Defaults to the current working directory." }));
const requiredProjectPath = Type.String({ description: "Absolute project directory path." });
const memoryScope = Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project"), Type.Literal("path")], {
	description: "Memory scope. 'global' is only for operator preferences/style; project facts should use project, folder facts should use path.",
}));
const memoryPath = Type.Optional(Type.String({ description: "Folder/path scope for path memory. Defaults to project scope when omitted." }));
const memoryPathId = Type.Optional(Type.String({ description: "Stable path memory id/namespace for folder-scoped memory." }));

const XENONITE_TOOL_SPECS: XenoniteToolSpec[] = [
	{
		name: "index_build",
		endpoint: "/v1/code/index",
		description: "Start indexing a codebase in the background. Poll index_status until complete before searching.",
		params: { projectPath, extraExtensions: Type.Optional(Type.String({ description: "Comma-separated extra file extensions to index (e.g. '.tpl,.blade')." })) },
	},
	{
		name: "index_sync",
		endpoint: "/v1/code/update",
		description: "Incrementally update an existing index; only re-indexes changed files.",
		params: { projectPath, extraExtensions: Type.Optional(Type.String({ description: "Comma-separated extra file extensions." })) },
	},
	{ name: "index_drop", endpoint: "/v1/code/remove", description: "Remove a project's index entirely from the vector store.", params: { projectPath: requiredProjectPath } },
	{ name: "index_stop", endpoint: "/v1/code/stop", description: "Stop any in-progress indexing for a project.", params: { projectPath } },
	{
		name: "index_watch",
		endpoint: "/v1/code/watch",
		description: "Start/stop the file watcher or get watcher status.",
		params: { projectPath, action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], { description: "start, stop, or status." })) },
	},
	{ name: "index_status", endpoint: "/v1/code/status", description: "Report indexing progress and index health for a project.", params: { projectPath } },
	{ name: "index_health", endpoint: "/v1/code/op", description: "Check infrastructure health: vector DB, embedding provider, model.", params: {} },
	{ name: "index_list", endpoint: "/v1/code/op", description: "List all indexed projects.", params: {} },
	{
		name: "search_query",
		endpoint: "/v1/code/search",
		description: "Semantic code search by natural-language query.",
		params: {
			query: Type.String({ description: "Natural-language search query." }),
			projectPath,
			limit: Type.Optional(Type.Number({ description: "Max results. Default 10" })),
		},
	},
	{ name: "graph_build", endpoint: "/v1/graph/build", description: "Build the dependency/symbol graph for a project.", params: { projectPath } },
	{
		name: "graph_query",
		endpoint: "/v1/graph/query",
		description: "Query the graph for a specific file's relationships.",
		params: { filePath: Type.String({ description: "Relative file path (e.g. 'src/index.ts')." }), projectPath },
	},
	{ name: "graph_stats", endpoint: "/v1/graph/stats", description: "Show graph statistics.", params: { projectPath } },
	{ name: "graph_cycles", endpoint: "/v1/graph/circular", description: "Find circular dependencies.", params: { projectPath } },
	{ name: "graph_view", endpoint: "/v1/graph/visualize", description: "Produce a visualization of the graph.", params: { projectPath } },
	{ name: "graph_drop", endpoint: "/v1/graph/remove", description: "Remove a project's graph.", params: { projectPath: requiredProjectPath } },
	{ name: "graph_status", endpoint: "/v1/graph/status", description: "Report graph build status.", params: { projectPath } },
	{
		name: "graph_impact",
		endpoint: "/v1/graph/impact",
		description: "Walk dependents to assess blast radius of a file or symbol.",
		params: {
			projectPath,
			target: Type.String({ description: "Target relative file path OR symbol name." }),
			depth: Type.Optional(Type.Number({ description: "Hops to walk back. Default 3, max 10." })),
		},
	},
	{
		name: "graph_trace",
		endpoint: "/v1/graph/flow",
		description: "Trace control/data flow from an entry symbol.",
		params: {
			projectPath,
			entrypoint: Type.Optional(Type.String({ description: "Symbol to trace from; omit to list entry points." })),
			file: Type.Optional(Type.String({ description: "File hint to disambiguate the symbol." })),
			depth: Type.Optional(Type.Number({ description: "Max DFS depth. Default 5, max 10." })),
		},
	},
	{
		name: "graph_symbol",
		endpoint: "/v1/graph/symbol",
		description: "Look up a symbol definition and references.",
		params: { projectPath, name: Type.String({ description: "Symbol name (e.g. 'validateUser')." }), file: Type.Optional(Type.String({ description: "File hint to disambiguate." })) },
	},
	{
		name: "graph_symbols",
		endpoint: "/v1/graph/symbols",
		description: "List symbols in a file or matching a query project-wide.",
		params: {
			projectPath,
			file: Type.Optional(Type.String({ description: "Relative file path to list symbols for." })),
			query: Type.Optional(Type.String({ description: "Substring to match symbol names." })),
			limit: Type.Optional(Type.Number({ description: "Max results. Default 200." })),
		},
	},
	{ name: "ctx_list", endpoint: "/v1/context", description: "List stored context artifacts for a project.", params: { projectPath } },
	{ name: "ctx_search", endpoint: "/v1/context/search", description: "Semantic search over stored context artifacts.", params: { query: Type.String({ description: "Natural-language query." }), projectPath } },
	{ name: "ctx_add", endpoint: "/v1/context/index", description: "Index context artifacts for later retrieval.", params: { projectPath } },
	{ name: "ctx_drop", endpoint: "/v1/context/remove", description: "Remove a project's context artifacts.", params: { projectPath: requiredProjectPath } },
];

const XENONITE_MEMORY_TOOL_SPECS: XenoniteToolSpec[] = [
	{
		name: "mem_recall",
		endpoint: "/v1/memory/recall",
		description: "Recall durable memory relevant to a query from previous sessions.",
		params: {
			query: Type.String({ description: "What to recall." }),
			top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum memory observations." })),
			scope: memoryScope,
			projectPath,
			path: memoryPath,
			pathId: memoryPathId,
		},
	},
	{
		name: "mem_search",
		endpoint: "/v1/memory/recall",
		description: "Semantic search over durable memory.",
		params: {
			query: Type.String({ description: "Search query." }),
			top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum memory observations." })),
			scope: memoryScope,
			projectPath,
			path: memoryPath,
			pathId: memoryPathId,
		},
	},
	{
		name: "mem_store",
		endpoint: "/v1/memory/store",
		description: "Store one durable memory observation for future sessions.",
		params: {
			text: Type.String({ description: "Standalone memory fact to store." }),
			source: Type.Union([Type.Literal("direct_user_request"), Type.Literal("verified_durable_fact")], {
				description: "Why storage is allowed: explicit user memory request or verified durable project fact/decision.",
			}),
			scope: memoryScope,
			projectPath,
			path: memoryPath,
			pathId: memoryPathId,
		},
	},
	{
		name: "mem_optimize",
		endpoint: "/v1/memory/optimize",
		description: "Dry-run or apply sequential LLM-assisted durable memory dedupe, cleanup, and scope reclassification.",
		params: {
			dryRun: Type.Optional(Type.Boolean({ description: "Preview only. Defaults to true unless apply is true." })),
			apply: Type.Optional(Type.Boolean({ description: "Apply the rewrite. Defaults to false." })),
			maxFacts: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: "Maximum facts to process in this run. Default 200." })),
			batchSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Sequential LLM batch size. Default 8." })),
			useLlm: Type.Optional(Type.Boolean({ description: "Use Xenonite's configured LLM for classification. Default true." })),
		},
	},
];

export type XenoniteToolName = string;
export const xenoniteToolNames = [...XENONITE_TOOL_SPECS, ...XENONITE_MEMORY_TOOL_SPECS].map((spec) => spec.name) as XenoniteToolName[];

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

function stringifyApiResult(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

function toXenonitePath(path: string | undefined, cwd: string, hostPrefix: string): string {
	const localPath = path?.trim() || cwd;
	if (localPath.startsWith(`${hostPrefix}/`) || localPath === hostPrefix) return localPath;
	if (!localPath.startsWith("/")) return localPath;
	return `${hostPrefix}${localPath}`;
}

function xenoniteConfig(): XenoniteCoreConfig {
	const config = loadAmazeConfig();
	return {
		baseUrl: normalizeBaseUrl(config.services.xenonite.url),
		hostPrefix: config.services.xenonite.hostPrefix,
	};
}

export function isXenoniteCoreEnabled(): boolean {
	const config = loadAmazeConfig();
	return config.services.xenonite.enabled && (config.tools.search.enabled || config.tools.mem.enabled);
}

function enabledSpecs(): XenoniteToolSpec[] {
	const config = loadAmazeConfig();
	if (!config.services.xenonite.enabled) return [];
	return [
		...(config.tools.search.enabled ? XENONITE_TOOL_SPECS : []),
		...(config.tools.mem.enabled ? XENONITE_MEMORY_TOOL_SPECS : []),
	];
}

function apiPayload(toolName: string, params: Record<string, unknown>, cwd: string, hostPrefix: string): Record<string, unknown> {
	const payload = { ...params };
	if ("projectPath" in payload || toolName !== "index_health" && toolName !== "index_list") {
		payload.projectPath = toXenonitePath(typeof payload.projectPath === "string" ? payload.projectPath : undefined, cwd, hostPrefix);
	}
	if (toolName === "index_health") return { op: "codebase_health", args: {} };
	if (toolName === "index_list") return { op: "codebase_list_projects", args: {} };
	if (toolName === "mem_recall" || toolName === "mem_search") {
		return memoryPayload(payload, cwd, hostPrefix, false);
	}
	if (toolName === "mem_store") {
		return memoryPayload(payload, cwd, hostPrefix, true);
	}
	return payload;
}

function memoryPayload(payload: Record<string, unknown>, cwd: string, hostPrefix: string, store: boolean): Record<string, unknown> {
	const requestedScope = typeof payload.scope === "string" ? payload.scope : undefined;
	const pathValue = typeof payload.path === "string" && payload.path.trim()
		? toXenonitePath(payload.path, cwd, hostPrefix)
		: undefined;
	const pathId = typeof payload.pathId === "string" && payload.pathId.trim() ? payload.pathId.trim() : undefined;
	let scope = requestedScope ?? (pathValue || pathId ? "path" : "project");
	if (store && scope === "global" && payload.source !== "direct_user_request") {
		scope = "project";
	}
	const project = toXenonitePath(typeof payload.projectPath === "string" ? payload.projectPath : undefined, cwd, hostPrefix);
	return {
		...(store ? { text: payload.text, source: payload.source } : { query: payload.query, top_k: payload.top_k }),
		memoryScope: scope,
		projectPath: project,
		...(pathValue ? { path: pathValue } : {}),
		...(pathId ? { pathId } : {}),
		session_id: "default",
	};
}

async function post(baseUrl: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(`${baseUrl}${endpoint}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Xenonite API ${endpoint} returned ${res.status}: ${await res.text().catch(() => "")}`);
	return await res.json();
}

async function get(baseUrl: string, endpoint: string): Promise<unknown> {
	const res = await fetch(`${baseUrl}${endpoint}`);
	if (!res.ok) throw new Error(`Xenonite API ${endpoint} returned ${res.status}: ${await res.text().catch(() => "")}`);
	return await res.json();
}

async function callXenoniteTool(config: XenoniteCoreConfig, spec: XenoniteToolSpec, params: Record<string, unknown>, cwd: string): Promise<string> {
	const payload = apiPayload(spec.name, params, cwd, config.hostPrefix);
	const data = await post(config.baseUrl, spec.endpoint, payload);
	return stringifyApiResult(data);
}

export async function autoPrepareXenoniteCore(cwd: string): Promise<void> {
	const config = loadAmazeConfig();
	if (!config.services.xenonite.enabled || !config.tools.search.enabled || !config.services.xenonite.autoIndex) return;
	const xenonite = xenoniteConfig();
	try {
		await get(xenonite.baseUrl, "/health");
	} catch (error) {
		if (config.services.xenonite.require) throw error;
		return;
	}
	const preparedProjectPath = toXenonitePath(undefined, cwd, xenonite.hostPrefix);
	await post(xenonite.baseUrl, "/v1/code/index", { projectPath: preparedProjectPath });
	if (config.services.xenonite.autoWatch) {
		await post(xenonite.baseUrl, "/v1/code/watch", { projectPath: preparedProjectPath, action: "start" }).catch(() => undefined);
	}
}

export function createXenoniteToolDefinitions(cwd: string): Record<XenoniteToolName, ToolDefinition> {
	const config = xenoniteConfig();
	return Object.fromEntries(
		enabledSpecs().map((spec) => [
			spec.name,
			{
				name: spec.name,
				label: spec.name,
				description: spec.description,
				parameters: Type.Object(spec.params),
				async execute(_id, params) {
					try {
						const text = await callXenoniteTool(config, spec, params as Record<string, unknown>, cwd);
						return { content: [{ type: "text", text }], details: undefined };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return {
							content: [{ type: "text", text: `Xenonite API unavailable at ${config.baseUrl}: ${message}` }],
							details: undefined,
						};
					}
				},
			} satisfies ToolDefinition,
		]),
	) as Record<XenoniteToolName, ToolDefinition>;
}
