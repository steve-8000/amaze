import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
	transport: "tool" | "http";
	root: string;
	bin?: string;
}

export interface RecalledMemoryItem {
	text?: string;
	score?: number;
	source?: string;
	scope?: string;
	[key: string]: unknown;
}

export interface RecalledMemory {
	items: RecalledMemoryItem[];
	context: string;
}

interface MemoryRetrievalPolicy {
	candidateTopK: number;
	finalTopK: number;
	minRelevance: number;
	scoreMode: "similarity" | "distance";
}

const DEFAULT_MEMORY_RETRIEVAL_POLICY: MemoryRetrievalPolicy = {
	candidateTopK: 30,
	finalTopK: 5,
	minRelevance: 0.05,
	scoreMode: "similarity",
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function positiveIntegerSetting(value: unknown, fallback: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const normalized = Math.floor(value);
	if (normalized < 1) return fallback;
	return Math.min(normalized, max);
}

function relevanceSetting(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	if (value < 0 || value > 1) return fallback;
	return value;
}

function scoreModeSetting(
	value: unknown,
	fallback: MemoryRetrievalPolicy["scoreMode"],
): MemoryRetrievalPolicy["scoreMode"] {
	return value === "distance" || value === "similarity" ? value : fallback;
}

function memoryRetrievalPolicyFromConfig(config = loadAmazeConfig(), requestedTopK?: number): MemoryRetrievalPolicy {
	const tools = objectValue(config.raw.tools);
	const mem = objectValue(tools?.mem);
	const retrieval = objectValue(mem?.retrieval);
	const configuredFinalTopK = positiveIntegerSetting(
		retrieval?.final_top_k ?? retrieval?.finalTopK,
		DEFAULT_MEMORY_RETRIEVAL_POLICY.finalTopK,
		20,
	);
	const finalTopK = positiveIntegerSetting(requestedTopK, configuredFinalTopK, 20);
	const candidateTopK = positiveIntegerSetting(
		retrieval?.candidate_top_k ?? retrieval?.candidateTopK,
		DEFAULT_MEMORY_RETRIEVAL_POLICY.candidateTopK,
		100,
	);
	return {
		candidateTopK: Math.max(candidateTopK, finalTopK),
		finalTopK,
		minRelevance: relevanceSetting(
			retrieval?.min_relevance ?? retrieval?.minRelevance,
			DEFAULT_MEMORY_RETRIEVAL_POLICY.minRelevance,
		),
		scoreMode: scoreModeSetting(
			retrieval?.score_mode ?? retrieval?.scoreMode,
			DEFAULT_MEMORY_RETRIEVAL_POLICY.scoreMode,
		),
	};
}

const projectPath = Type.Optional(
	Type.String({ description: "Absolute project directory path. Defaults to the current working directory." }),
);
const requiredProjectPath = Type.String({ description: "Absolute project directory path." });
const memoryScope = Type.Optional(
	Type.Union([Type.Literal("global"), Type.Literal("project"), Type.Literal("path")], {
		description:
			"Memory scope. 'global' is only for operator preferences/style; project facts should use project, folder facts should use path.",
	}),
);
const memoryPath = Type.Optional(
	Type.String({ description: "Folder/path scope for path memory. Defaults to project scope when omitted." }),
);
const memoryPathId = Type.Optional(
	Type.String({ description: "Stable path memory id/namespace for folder-scoped memory." }),
);
const MAX_CODE_READ_LINES = 200;

const XENONITE_TOOL_SPECS: XenoniteToolSpec[] = [
	{
		name: "context_engine",
		endpoint: "/v1/engine/context",
		description:
			"Ask Xenonite Core Engine for the smallest sufficient repository/memory read targets. Default output is targets[] with targets[].readArgs for code_read handoff; inline source content is opt-in via outputMode='inline'. Treat targets[] as a ranked read plan, not source evidence: do not automatically code_read every target; read only the minimum target(s) needed for the conclusion or patch.",
		params: {
			projectPath,
			task: Type.String({ description: "The user's repository-context task or question." }),
			mode: Type.Optional(
				Type.Union([Type.Literal("answer"), Type.Literal("patch"), Type.Literal("investigate")], {
					description: "What the selected context should support.",
				}),
			),
			outputMode: Type.Optional(
				Type.Union([Type.Literal("targets"), Type.Literal("inline")], {
					description:
						"Response shape. Default 'targets' returns read targets only; 'inline' also returns bounded source content.",
				}),
			),
			hints: Type.Optional(
				Type.Object(
					{
						files: Type.Optional(
							Type.Array(Type.String(), {
								description: "Explicit relative or absolute files already mentioned by the user.",
							}),
						),
						symbols: Type.Optional(
							Type.Array(Type.String(), { description: "Symbols already mentioned by the user." }),
						),
					},
					{ description: "Optional known files/symbols. Explicit files bypass model exploration." },
				),
			),
			budget: Type.Optional(
				Type.Object(
					{
						maxTargets: Type.Optional(Type.Number({ description: "Maximum selected file ranges. Default 3." })),
						maxTotalLines: Type.Optional(
							Type.Number({ description: "Maximum lines per selected range. Default 240." }),
						),
						maxRounds: Type.Optional(
							Type.Number({ description: "Maximum FastContext planning rounds. Default 1." }),
						),
					},
					{ description: "Bounded exploration budget." },
				),
			),
			includeMemory: Type.Optional(
				Type.Boolean({ description: "Include selected scoped memory in the context packet." }),
			),
			memoryScope,
			pathScope: Type.Optional(Type.String({ description: "Optional path scope for memory selection." })),
		},
	},
	{
		name: "index_build",
		endpoint: "/v1/code/index",
		description: "Start indexing a codebase in the background. Poll index_status until complete before searching.",
		params: {
			projectPath,
			extraExtensions: Type.Optional(
				Type.String({ description: "Comma-separated extra file extensions to index (e.g. '.tpl,.blade')." }),
			),
		},
	},
	{
		name: "index_sync",
		endpoint: "/v1/code/update",
		description: "Incrementally update an existing index; only re-indexes changed files.",
		params: {
			projectPath,
			extraExtensions: Type.Optional(Type.String({ description: "Comma-separated extra file extensions." })),
		},
	},
	{
		name: "index_drop",
		endpoint: "/v1/code/remove",
		description: "Remove a project's index entirely from the vector store.",
		params: { projectPath: requiredProjectPath },
	},
	{
		name: "index_stop",
		endpoint: "/v1/code/stop",
		description: "Stop any in-progress indexing for a project.",
		params: { projectPath },
	},
	{
		name: "index_watch",
		endpoint: "/v1/code/watch",
		description: "Start/stop the file watcher or get watcher status.",
		params: {
			projectPath,
			action: Type.Optional(
				Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], {
					description: "start, stop, or status.",
				}),
			),
		},
	},
	{
		name: "index_status",
		endpoint: "/v1/code/status",
		description:
			"Report indexing progress and index health. Use when index state itself matters or context_engine reports stale/missing context.",
		params: { projectPath },
	},
	{
		name: "index_health",
		endpoint: "/v1/code/op",
		description: "Check infrastructure health: vector DB, embedding provider, model.",
		params: {},
	},
	{ name: "index_list", endpoint: "/v1/code/op", description: "List all indexed projects.", params: {} },
	{
		name: "search_query",
		endpoint: "/v1/code/search",
		description:
			"Semantic code search by natural-language query. Prefer context_engine for normal repository context; use search_query as fallback or for explicit search tasks.",
		params: {
			query: Type.String({ description: "Natural-language search query." }),
			projectPath,
			limit: Type.Optional(Type.Number({ description: "Max results. Default 10" })),
		},
	},
	{
		name: "code_read",
		endpoint: "/v1/code/read",
		description:
			"Read an exact bounded source/text file span as improved read evidence. Requires explicit startLine/endLine; returns no sufficiency, patch-readiness, or next-action judgement. When following context_engine targets, use this selectively for the minimum necessary evidence rather than reading every returned target.",
		params: {
			filePath: Type.String({ description: "Relative or absolute file path." }),
			projectPath,
			startLine: Type.Integer({ minimum: 1, description: "1-based start line. Required for exact evidence reads." }),
			endLine: Type.Integer({ minimum: 1, description: "1-based end line. Required for exact evidence reads." }),
			contextLines: Type.Optional(
				Type.Integer({ minimum: 0, maximum: 20, description: "Extra surrounding lines to include. Default 0." }),
			),
			maxLines: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 500,
					description: `Hard maximum returned lines. Default ${MAX_CODE_READ_LINES}. Requests exceeding this fail instead of truncating.`,
				}),
			),
			lineNumbers: Type.Optional(
				Type.Boolean({ description: "Prefix returned content with 1-based line numbers. Default true." }),
			),
		},
	},
	{
		name: "graph_build",
		endpoint: "/v1/graph/build",
		description: "Build the dependency/symbol graph for a project.",
		params: { projectPath },
	},
	{
		name: "graph_query",
		endpoint: "/v1/graph/query",
		description: "Query the graph for a specific file's relationships.",
		params: { filePath: Type.String({ description: "Relative file path (e.g. 'src/index.ts')." }), projectPath },
	},
	{ name: "graph_stats", endpoint: "/v1/graph/stats", description: "Show graph statistics.", params: { projectPath } },
	{
		name: "graph_cycles",
		endpoint: "/v1/graph/circular",
		description: "Find circular dependencies.",
		params: { projectPath },
	},
	{
		name: "graph_view",
		endpoint: "/v1/graph/visualize",
		description: "Produce a visualization of the graph.",
		params: { projectPath },
	},
	{
		name: "graph_drop",
		endpoint: "/v1/graph/remove",
		description: "Remove a project's graph.",
		params: { projectPath: requiredProjectPath },
	},
	{
		name: "graph_status",
		endpoint: "/v1/graph/status",
		description: "Report graph build status before graph/impact exploration.",
		params: { projectPath },
	},
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
		params: {
			projectPath,
			name: Type.String({ description: "Symbol name (e.g. 'validateUser')." }),
			file: Type.Optional(Type.String({ description: "File hint to disambiguate." })),
			includeBody: Type.Optional(
				Type.Boolean({ description: "Include a bounded source snippet around the symbol definition." }),
			),
			contextLines: Type.Optional(
				Type.Number({ description: "Lines around the symbol to include when includeBody is true. Default 40." }),
			),
		},
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
	{
		name: "ctx_list",
		endpoint: "/v1/context",
		description: "List stored context artifacts for a project.",
		params: { projectPath },
	},
	{
		name: "ctx_search",
		endpoint: "/v1/context/search",
		description: "Semantic search over stored context artifacts.",
		params: { query: Type.String({ description: "Natural-language query." }), projectPath },
	},
	{
		name: "ctx_add",
		endpoint: "/v1/context/index",
		description: "Index context artifacts for later retrieval.",
		params: { projectPath },
	},
	{
		name: "ctx_drop",
		endpoint: "/v1/context/remove",
		description: "Remove a project's context artifacts.",
		params: { projectPath: requiredProjectPath },
	},
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
				description:
					"Why storage is allowed: explicit user memory request or verified durable project fact/decision.",
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
		description:
			"Dry-run or apply sequential LLM-assisted durable memory dedupe, cleanup, and scope reclassification.",
		params: {
			dryRun: Type.Optional(Type.Boolean({ description: "Preview only. Defaults to true unless apply is true." })),
			apply: Type.Optional(Type.Boolean({ description: "Apply the rewrite. Defaults to false." })),
			maxFacts: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 1000,
					description: "Maximum facts to process in this run. Default 200.",
				}),
			),
			batchSize: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 20, description: "Sequential LLM batch size. Default 8." }),
			),
			useLlm: Type.Optional(
				Type.Boolean({ description: "Use Xenonite's configured LLM for classification. Default true." }),
			),
		},
	},
	{
		name: "mem_delete",
		endpoint: "/v1/memory/delete",
		description: "Delete durable memory facts in one scope by id, exact text, or text prefix.",
		params: {
			id: Type.Optional(Type.String({ description: "Exact memory fact id to delete." })),
			text: Type.Optional(Type.String({ description: "Exact memory fact text to delete." })),
			textPrefix: Type.Optional(Type.String({ description: "Delete facts whose text starts with this prefix." })),
			scope: memoryScope,
			projectPath,
			path: memoryPath,
			pathId: memoryPathId,
		},
	},
];

export type XenoniteToolName = string;
export const xenoniteToolNames = [...XENONITE_TOOL_SPECS, ...XENONITE_MEMORY_TOOL_SPECS].map(
	(spec) => spec.name,
) as XenoniteToolName[];

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

function fromXenonitePath(inputPath: string, hostPrefix: string): string {
	if (inputPath === hostPrefix) return "/";
	if (inputPath.startsWith(`${hostPrefix}/`)) return inputPath.slice(hostPrefix.length);
	return inputPath;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function languageFromFilePath(filePath: string): string | undefined {
	const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
	if (!extension) return undefined;
	const aliases: Record<string, string> = {
		js: "javascript",
		jsx: "jsx",
		ts: "typescript",
		tsx: "tsx",
		mjs: "javascript",
		cjs: "javascript",
		json: "json",
		md: "markdown",
		yml: "yaml",
		yaml: "yaml",
	};
	return aliases[extension] ?? extension;
}

function resolveCodeReadPath(
	filePathValue: unknown,
	projectPathValue: unknown,
	cwd: string,
	hostPrefix: string,
): { absolutePath: string; projectPath: string; relativePath: string } {
	if (typeof filePathValue !== "string" || !filePathValue.trim()) {
		throw new Error("code_read requires non-empty filePath.");
	}
	const projectPath = path.resolve(
		fromXenonitePath(
			typeof projectPathValue === "string" && projectPathValue.trim() ? projectPathValue : cwd,
			hostPrefix,
		),
	);
	const normalizedFilePath = fromXenonitePath(filePathValue.trim(), hostPrefix);
	const absolutePath = path.resolve(
		path.isAbsolute(normalizedFilePath) ? normalizedFilePath : path.join(projectPath, normalizedFilePath),
	);
	const relativePath = path.relative(projectPath, absolutePath) || path.basename(absolutePath);
	return { absolutePath, projectPath, relativePath };
}

export async function readExactCodeSpan(
	params: Record<string, unknown>,
	cwd: string,
	hostPrefix: string,
): Promise<Record<string, unknown>> {
	const startLine = normalizePositiveInteger(params.startLine, 0);
	const endLine = normalizePositiveInteger(params.endLine, 0);
	if (!startLine || !endLine) {
		throw new Error("code_read requires explicit integer startLine and endLine.");
	}
	if (endLine < startLine) {
		throw new Error(`code_read endLine (${endLine}) must be greater than or equal to startLine (${startLine}).`);
	}
	const contextLines = normalizeNonNegativeInteger(params.contextLines, 0);
	const maxLines = normalizePositiveInteger(params.maxLines, MAX_CODE_READ_LINES);
	const lineNumbers = params.lineNumbers !== false;
	const requestedLineCount = endLine - startLine + 1 + contextLines * 2;
	if (requestedLineCount > maxLines) {
		throw new Error(
			`code_read requested ${requestedLineCount} lines, exceeding maxLines ${maxLines}. Narrow the range instead of relying on truncation.`,
		);
	}
	const { absolutePath, projectPath, relativePath } = resolveCodeReadPath(
		params.filePath,
		params.projectPath,
		cwd,
		hostPrefix,
	);
	const raw = await readFile(absolutePath, "utf8");
	const lines = raw.split(/\r?\n/);
	const fileLineCount = lines.length;
	if (startLine > fileLineCount) {
		throw new Error(`code_read startLine ${startLine} is beyond file line count ${fileLineCount}.`);
	}
	const returnedStartLine = Math.max(1, startLine - contextLines);
	const returnedEndLine = Math.min(fileLineCount, endLine + contextLines);
	const returnedLineCount = returnedEndLine - returnedStartLine + 1;
	if (returnedLineCount > maxLines) {
		throw new Error(
			`code_read returned range would contain ${returnedLineCount} lines, exceeding maxLines ${maxLines}. Narrow the range.`,
		);
	}
	const selected = lines.slice(returnedStartLine - 1, returnedEndLine);
	return {
		ok: true,
		projectPath,
		filePath: absolutePath,
		relativePath,
		language: languageFromFilePath(absolutePath),
		requestedRange: { startLine, endLine, contextLines },
		returnedRange: { startLine: returnedStartLine, endLine: returnedEndLine },
		complete:
			returnedStartLine === Math.max(1, startLine - contextLines) &&
			returnedEndLine === Math.min(fileLineCount, endLine + contextLines),
		truncated: false,
		lineNumbers,
		content: selected.map((line, index) => (lineNumbers ? `${returnedStartLine + index}: ${line}` : line)).join("\n"),
	};
}

function xenoniteConfig(): XenoniteCoreConfig {
	const config = loadAmazeConfig();
	return {
		baseUrl: normalizeBaseUrl(config.services.xenonite.url),
		hostPrefix: config.services.xenonite.hostPrefix,
		transport: config.services.xenonite.transport,
		root: config.services.xenonite.root,
		bin: config.services.xenonite.bin,
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

function memoryToolsEnabled(): boolean {
	const config = loadAmazeConfig();
	return config.services.xenonite.enabled && config.tools.mem.enabled;
}

function apiPayload(
	toolName: string,
	params: Record<string, unknown>,
	cwd: string,
	hostPrefix: string,
): Record<string, unknown> {
	const payload = { ...params };
	if ("projectPath" in payload || (toolName !== "index_health" && toolName !== "index_list")) {
		payload.projectPath = toXenonitePath(
			typeof payload.projectPath === "string" ? payload.projectPath : undefined,
			cwd,
			hostPrefix,
		);
	}
	if (toolName === "index_health") return { op: "codebase_health", args: {} };
	if (toolName === "index_list") return { op: "codebase_list_projects", args: {} };
	if (toolName === "mem_recall" || toolName === "mem_search") {
		return memoryPayload(payload, cwd, hostPrefix, false);
	}
	if (toolName === "mem_store") {
		return memoryPayload(payload, cwd, hostPrefix, true);
	}
	if (toolName === "mem_delete") {
		return memoryDeletePayload(payload, cwd, hostPrefix);
	}
	if (toolName === "context_engine") {
		if (typeof payload.pathScope === "string" && payload.pathScope.trim()) {
			payload.pathScope = toXenonitePath(payload.pathScope, cwd, hostPrefix);
		}
		return payload;
	}
	return payload;
}

function localPayload(toolName: string, params: Record<string, unknown>, cwd: string): Record<string, unknown> {
	const payload = { ...params };
	if ("projectPath" in payload || (toolName !== "index_health" && toolName !== "index_list")) {
		payload.projectPath = path.resolve(
			typeof payload.projectPath === "string" && payload.projectPath.trim() ? payload.projectPath : cwd,
		);
	}
	if (toolName === "context_engine") {
		if (typeof payload.pathScope === "string" && payload.pathScope.trim()) {
			payload.pathScope = path.resolve(payload.pathScope);
		}
		return payload;
	}
	if (toolName === "mem_recall" || toolName === "mem_search") return memoryPayload(payload, cwd, "", false);
	if (toolName === "mem_store") return memoryPayload(payload, cwd, "", true);
	if (toolName === "mem_delete") return memoryDeletePayload(payload, cwd, "");
	return payload;
}

function localToolOp(toolName: string): string | undefined {
	const ops: Record<string, string> = {
		context_engine: "context_engine",
		code_read: "code_read",
		mem_recall: "memory_recall",
		mem_search: "memory_recall",
		mem_store: "memory_store",
		mem_optimize: "memory_optimize",
		mem_delete: "memory_delete",
	};
	return ops[toolName];
}

function memoryPayload(
	payload: Record<string, unknown>,
	cwd: string,
	hostPrefix: string,
	store: boolean,
): Record<string, unknown> {
	const requestedScope = typeof payload.scope === "string" ? payload.scope : undefined;
	const pathValue =
		typeof payload.path === "string" && payload.path.trim()
			? toXenonitePath(payload.path, cwd, hostPrefix)
			: undefined;
	const pathId = typeof payload.pathId === "string" && payload.pathId.trim() ? payload.pathId.trim() : undefined;
	let scope = requestedScope ?? (pathValue || pathId ? "path" : "project");
	if (store && scope === "global" && payload.source !== "direct_user_request") {
		scope = "project";
	}
	const project = toXenonitePath(
		typeof payload.projectPath === "string" ? payload.projectPath : undefined,
		cwd,
		hostPrefix,
	);
	return {
		...(store ? { text: payload.text, source: payload.source } : { query: payload.query, top_k: payload.top_k }),
		memoryScope: scope,
		projectPath: project,
		...(pathValue ? { path: pathValue } : {}),
		...(pathId ? { pathId } : {}),
		session_id: "default",
	};
}

function memoryDeletePayload(
	payload: Record<string, unknown>,
	cwd: string,
	hostPrefix: string,
): Record<string, unknown> {
	return {
		...memoryPayload(payload, cwd, hostPrefix, false),
		id: payload.id,
		text: payload.text,
		textPrefix: payload.textPrefix,
	};
}

async function post(
	baseUrl: string,
	endpoint: string,
	body: Record<string, unknown>,
	timeoutMs = 60_000,
): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetch(`${baseUrl}${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Xenonite API ${endpoint} timed out after ${timeoutMs}ms`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
	if (!res.ok) throw new Error(`Xenonite API ${endpoint} returned ${res.status}: ${await res.text().catch(() => "")}`);
	return await res.json();
}

async function get(baseUrl: string, endpoint: string, timeoutMs = 60_000): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetch(`${baseUrl}${endpoint}`, { signal: controller.signal });
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Xenonite API ${endpoint} timed out after ${timeoutMs}ms`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
	if (!res.ok) throw new Error(`Xenonite API ${endpoint} returned ${res.status}: ${await res.text().catch(() => "")}`);
	return await res.json();
}

async function callLocalXenoniteTool(
	config: XenoniteCoreConfig,
	op: string,
	args: Record<string, unknown>,
	timeoutMs = 60_000,
): Promise<unknown> {
	const command = config.bin ?? "cargo";
	const commandArgs = config.bin ? ["tool"] : ["run", "--quiet", "--", "tool"];
	const child = spawn(command, commandArgs, {
		cwd: config.root,
		env: { ...process.env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const input = JSON.stringify({ op, args });
	let stdout = "";
	let stderr = "";
	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.end(input);
	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	}).finally(() => clearTimeout(timer));
	if (exitCode !== 0) {
		throw new Error(`Xenonite local tool ${op} exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	try {
		return JSON.parse(stdout);
	} catch (error) {
		throw new Error(
			`Xenonite local tool ${op} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const FRESHEN_DEBOUNCE_MS = 2_000;
const FRESHEN_REQUEST_TIMEOUT_MS = 1_500;
const CONTEXT_ENGINE_EXPLORE_TIMEOUT_MS = 10 * 60_000;
const freshenByProject = new Map<string, { at: number; promise?: Promise<void> }>();

function hasExplicitContextFiles(params: Record<string, unknown>): boolean {
	const hints = params.hints;
	if (!hints || typeof hints !== "object") return false;
	const files = (hints as { files?: unknown }).files;
	return Array.isArray(files) && files.some((file) => typeof file === "string" && file.trim());
}

function shouldFreshenBeforeTool(toolName: string): boolean {
	return (
		toolName === "context_engine" ||
		toolName === "search_query" ||
		toolName === "code_read" ||
		toolName.startsWith("graph_")
	);
}

async function freshenProjectIndex(
	config: XenoniteCoreConfig,
	params: Record<string, unknown>,
	cwd: string,
): Promise<void> {
	const projectPath = toXenonitePath(
		typeof params.projectPath === "string" ? params.projectPath : undefined,
		cwd,
		config.hostPrefix,
	);
	const previous = freshenByProject.get(projectPath);
	const now = Date.now();
	if (previous?.promise) return previous.promise;
	if (previous && now - previous.at < FRESHEN_DEBOUNCE_MS) return;
	const promise = (async () => {
		const status = await post(config.baseUrl, "/v1/code/status", { projectPath }, FRESHEN_REQUEST_TIMEOUT_MS).catch(
			() => undefined,
		);
		if (isCompletedCodeStatus(status)) {
			await post(config.baseUrl, "/v1/code/update", { projectPath }, FRESHEN_REQUEST_TIMEOUT_MS).catch(
				() => undefined,
			);
		} else {
			await post(config.baseUrl, "/v1/code/index", { projectPath }, FRESHEN_REQUEST_TIMEOUT_MS).catch(
				() => undefined,
			);
		}
	})().finally(() => {
		freshenByProject.set(projectPath, { at: Date.now() });
	});
	freshenByProject.set(projectPath, { at: now, promise });
	return promise;
}

async function callXenoniteTool(
	config: XenoniteCoreConfig,
	spec: XenoniteToolSpec,
	params: Record<string, unknown>,
	cwd: string,
): Promise<string> {
	if (spec.name === "code_read") {
		return stringifyApiResult(await readExactCodeSpan(params, cwd, config.hostPrefix));
	}
	const localOp = localToolOp(spec.name);
	if (config.transport === "tool" && localOp) {
		const timeoutMs =
			spec.name === "context_engine" && !hasExplicitContextFiles(params)
				? CONTEXT_ENGINE_EXPLORE_TIMEOUT_MS
				: undefined;
		const data = await callLocalXenoniteTool(config, localOp, localPayload(spec.name, params, cwd), timeoutMs);
		return stringifyApiResult(data);
	}
	if (shouldFreshenBeforeTool(spec.name) && !(spec.name === "context_engine" && hasExplicitContextFiles(params))) {
		void freshenProjectIndex(config, params, cwd).catch(() => undefined);
	}
	const payload = apiPayload(spec.name, params, cwd, config.hostPrefix);
	const timeoutMs =
		spec.name === "context_engine" && !hasExplicitContextFiles(params)
			? CONTEXT_ENGINE_EXPLORE_TIMEOUT_MS
			: undefined;
	const data = await post(config.baseUrl, spec.endpoint, payload, timeoutMs);
	return stringifyApiResult(data);
}

function memoryTokens(value: string): Set<string> {
	const tokens = value.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
	return new Set(tokens);
}

function lexicalRelevance(queryTokens: Set<string>, text: string): number {
	if (queryTokens.size === 0) return 0;
	const textTokens = memoryTokens(text);
	if (textTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of queryTokens) {
		if (textTokens.has(token)) overlap++;
	}
	return overlap / queryTokens.size;
}

function normalizeMemoryScore(item: RecalledMemoryItem, scoreMode: MemoryRetrievalPolicy["scoreMode"]): number {
	if (typeof item.score !== "number" || !Number.isFinite(item.score)) return 0;
	if (scoreMode === "distance") {
		if (item.score < 0) return 0;
		return 1 / (1 + item.score);
	}
	if (item.score <= 0) return 0;
	return Math.min(item.score, 1);
}

function itemText(item: RecalledMemoryItem): string {
	return typeof item.text === "string" ? item.text.trim() : "";
}

function rankMemoryItems(
	items: RecalledMemoryItem[],
	query: string,
	policy: MemoryRetrievalPolicy,
): RecalledMemoryItem[] {
	const queryTokens = memoryTokens(query);
	const hasAnyExplicitScore = items.some((item) => typeof item.score === "number" && Number.isFinite(item.score));
	return items
		.map((item, index) => {
			const text = itemText(item);
			const lexical = lexicalRelevance(queryTokens, text);
			const vector = normalizeMemoryScore(item, policy.scoreMode);
			return {
				item,
				index,
				relevance: Math.max(vector, lexical),
				hasExplicitScore: typeof item.score === "number" && Number.isFinite(item.score),
			};
		})
		.filter((candidate) => itemText(candidate.item).length > 0)
		.filter((candidate) => {
			if (!hasAnyExplicitScore && !candidate.hasExplicitScore && candidate.relevance === 0) return true;
			return candidate.relevance >= policy.minRelevance;
		})
		.sort((left, right) => right.relevance - left.relevance || left.index - right.index)
		.slice(0, policy.finalTopK)
		.map((candidate) => candidate.item);
}

function contextFromMemoryItems(items: RecalledMemoryItem[]): string {
	return items.map(itemText).filter(Boolean).join("\n");
}

export async function recallMemoryForTurn(
	cwd: string,
	query: string,
	topK?: number,
): Promise<RecalledMemory | undefined> {
	if (!memoryToolsEnabled()) return undefined;
	const config = xenoniteConfig();
	const policy = memoryRetrievalPolicyFromConfig(undefined, topK);
	const candidateTopK = Math.max(policy.candidateTopK, policy.finalTopK);
	const payload =
		config.transport === "tool"
			? memoryPayload({ query, top_k: candidateTopK, scope: "project" }, cwd, "", false)
			: memoryPayload({ query, top_k: candidateTopK, scope: "project" }, cwd, config.hostPrefix, false);
	try {
		const data =
			config.transport === "tool"
				? await callLocalXenoniteTool(config, "memory_recall", payload, 3_000)
				: await post(config.baseUrl, "/v1/memory/recall", payload, 3_000);
		if (!data || typeof data !== "object") return undefined;
		const record = data as { items?: unknown; context?: unknown };
		const items = Array.isArray(record.items)
			? record.items.filter((item): item is RecalledMemoryItem => Boolean(item) && typeof item === "object")
			: [];
		const context = typeof record.context === "string" ? record.context.trim() : "";
		const selectedItems = rankMemoryItems(items, query, policy);
		if (items.length > 0) {
			if (selectedItems.length === 0) return undefined;
			return { items: selectedItems, context: contextFromMemoryItems(selectedItems) };
		}
		if (!context) return undefined;
		return { items: [], context };
	} catch {
		return undefined;
	}
}

export async function storeMemoryFact(
	cwd: string,
	text: string,
	source: "direct_user_request" | "verified_durable_fact" = "verified_durable_fact",
): Promise<boolean> {
	if (!memoryToolsEnabled()) return false;
	const fact = text.trim();
	if (!fact) return false;
	const config = xenoniteConfig();
	const payload =
		config.transport === "tool"
			? memoryPayload({ text: fact, source, scope: "project" }, cwd, "", true)
			: memoryPayload({ text: fact, source, scope: "project" }, cwd, config.hostPrefix, true);
	try {
		const data =
			config.transport === "tool"
				? await callLocalXenoniteTool(config, "memory_store", payload, 5_000)
				: await post(config.baseUrl, "/v1/memory/store", payload, 5_000);
		return Boolean(data && typeof data === "object" && (data as { added?: unknown }).added);
	} catch {
		return false;
	}
}

function isCompletedCodeStatus(value: unknown): boolean {
	return Boolean(
		value &&
			typeof value === "object" &&
			"ok" in value &&
			(value as { ok?: unknown }).ok === true &&
			"status" in value &&
			(value as { status?: unknown }).status === "completed",
	);
}

export async function autoPrepareXenoniteCore(cwd: string): Promise<void> {
	const config = loadAmazeConfig();
	if (!config.services.xenonite.enabled || !config.tools.search.enabled || !config.services.xenonite.autoIndex) return;
	const xenonite = xenoniteConfig();
	if (xenonite.transport === "tool") return;
	try {
		await get(xenonite.baseUrl, "/health");
	} catch (error) {
		if (config.services.xenonite.require) throw error;
		return;
	}
	const preparedProjectPath = toXenonitePath(undefined, cwd, xenonite.hostPrefix);
	const status = await post(xenonite.baseUrl, "/v1/code/status", { projectPath: preparedProjectPath }).catch(
		() => undefined,
	);
	if (isCompletedCodeStatus(status)) {
		await post(xenonite.baseUrl, "/v1/code/update", { projectPath: preparedProjectPath });
	} else {
		await post(xenonite.baseUrl, "/v1/code/index", { projectPath: preparedProjectPath });
	}
	if (config.services.xenonite.autoWatch) {
		await post(xenonite.baseUrl, "/v1/code/watch", { projectPath: preparedProjectPath, action: "start" }).catch(
			() => undefined,
		);
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
