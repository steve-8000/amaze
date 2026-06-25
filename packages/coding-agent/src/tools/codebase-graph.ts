import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@amaze/pi-agent-core";
import { type } from "arktype";
import type { ToolSession } from ".";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";

type CodebaseProjectRecord = {
	name: string;
	root_path?: string;
};

type ListProjectsPayload = {
	projects?: CodebaseProjectRecord[];
};
type CodebaseToolContent =
	| { type: "text"; text: string }
	| { type: "image"; mimeType: string }
	| { type: "resource"; resource: { uri: string; text?: string } };

interface CodebaseToolCallResult {
	content?: CodebaseToolContent[];
	isError?: boolean;
}

interface CodebaseToolDetails {
	serverName: string;
	toolName: string;
	isError?: boolean;
	rawContent?: CodebaseToolContent[];
}

const listProjectsSchema = type({});
const searchGraphSchema = type({
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
	"scope?": type('"cwd" | "workspace" | "parent_1" | "parent_2" | "explicit_roots"').describe(
		"explicit Rocky search scope: current working directory, configured workspace, one/two parent levels, or explicit roots",
	),
	"roots?": type("string").array().describe("absolute roots to search when scope is explicit_roots"),
	"max_parent_depth?": type("number").describe(
		"parent depth for parent_1/parent_2 scope; defaults to the scope depth",
	),
	"query?": type("string").describe("natural-language or keyword full-text search"),
	"label?": type("string").describe("node label filter"),
	"name_pattern?": type("string").describe("regex for exact name matching"),
	"qn_pattern?": type("string").describe("regex for qualified-name matching"),
	"file_pattern?": type("string").describe("regex or glob-like filter on file paths"),
	"relationship?": type("string").describe("edge-type filter for degree-based searches"),
	"min_degree?": type("number").describe("minimum graph degree"),
	"max_degree?": type("number").describe("maximum graph degree"),
	"exclude_entry_points?": type("boolean").describe("omit routes, mains, and other entry points"),
	"include_connected?": type("boolean").describe("include connected nodes in the response"),
	"semantic_query?": type("string").array().describe("semantic-search keywords array"),
	"limit?": type("number").describe("max results per page"),
	"offset?": type("number").describe("pagination offset"),
});
const searchCodeSchema = type({
	pattern: type("string").describe("grep pattern to search in code"),
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
	"scope?": type('"cwd" | "workspace" | "parent_1" | "parent_2" | "explicit_roots"').describe(
		"explicit Rocky search scope: current working directory, configured workspace, one/two parent levels, or explicit roots",
	),
	"roots?": type("string").array().describe("absolute roots to search when scope is explicit_roots"),
	"max_parent_depth?": type("number").describe(
		"parent depth for parent_1/parent_2 scope; defaults to the scope depth",
	),
	"file_pattern?": type("string").describe("grep --include glob, e.g. *.ts"),
	"path_filter?": type("string").describe("regex filter on result paths"),
	"mode?": type('"compact" | "full" | "files"').describe("response mode"),
	"context?": type("number").describe("context lines around each grep hit"),
	"regex?": type("boolean").describe("treat pattern as regex"),
	"limit?": type("number").describe("max enriched results"),
});
const tracePathSchema = type({
	function_name: type("string").describe("exact function or method name to trace"),
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
	"direction?": type('"inbound" | "outbound" | "both"').describe("trace callers, callees, or both"),
	"depth?": type("number").describe("maximum hop depth"),
	"mode?": type('"calls" | "data_flow" | "cross_service"').describe("trace mode"),
	"parameter_name?": type("string").describe("parameter scope for data-flow tracing"),
	"edge_types?": type("string").array().describe("explicit edge types to follow"),
	"risk_labels?": type("boolean").describe("attach hop-distance risk labels"),
	"include_tests?": type("boolean").describe("include test files in the trace"),
});
const getCodeSnippetSchema = type({
	qualified_name: type("string").describe("full qualified_name from search_graph, or a short function name"),
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
	"include_neighbors?": type("boolean").describe("include nearby declarations and helpers"),
});
const getArchitectureSchema = type({
	aspects: type("string").array().atLeastLength(1).describe("architecture slices to summarize"),
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
});
const queryGraphSchema = type({
	query: type("string").describe("Cypher query"),
	"project?": type("string").describe(
		"indexed project name; defaults to the current workspace when uniquely resolvable, including a unique nested repo/package root",
	),
	"max_rows?": type("number").describe("optional result cap"),
});

const LIST_PROJECTS_DESCRIPTION = `List indexed Rocky codebase projects. Use this first when the current workspace is not the indexed project root, unique nested root, or when project resolution is ambiguous.`;
const SEARCH_GRAPH_DESCRIPTION = `Graph-augmented code discovery. Use this first to find functions, classes, routes, and variables by natural language, exact pattern, or semantic keywords. Defaults the project to the current workspace when uniquely resolvable, including a unique nested repo/package root.`;
const SEARCH_CODE_DESCRIPTION = `Graph-ranked text search over the indexed codebase. Use for literal-code queries when structural graph search is too broad, but still want results deduplicated and ranked by containing symbol.`;
const TRACE_PATH_DESCRIPTION = `Trace callers, callees, dependencies, and data flow through the code graph. Use after search_graph to understand impact and execution paths.`;
const GET_CODE_SNIPPET_DESCRIPTION = `Read the source for a discovered symbol by qualified name. Use after search_graph to open the exact body instead of reading whole files.`;
const GET_ARCHITECTURE_DESCRIPTION = `Summarize package structure, dependencies, and graph clusters for the indexed project. Use before broad manual exploration.`;
const QUERY_GRAPH_DESCRIPTION = `Run Cypher directly against the code graph for advanced multi-hop or aggregate analysis.`;

type ToolSchema =
	| typeof listProjectsSchema
	| typeof searchGraphSchema
	| typeof searchCodeSchema
	| typeof tracePathSchema
	| typeof getCodeSnippetSchema
	| typeof getArchitectureSchema
	| typeof queryGraphSchema;

type CoreGraphDescriptor = {
	name: string;
	label: string;
	description: string;
	toolName: string;
	schema: ToolSchema;
	inferProject?: boolean;
};

const CORE_GRAPH_DESCRIPTORS = {
	list_projects: {
		name: "list_projects",
		label: "ListProjects",
		description: LIST_PROJECTS_DESCRIPTION,
		toolName: "list_projects",
		schema: listProjectsSchema,
		inferProject: false,
	},
	search_graph: {
		name: "search_graph",
		label: "SearchGraph",
		description: SEARCH_GRAPH_DESCRIPTION,
		toolName: "search_graph",
		schema: searchGraphSchema,
		inferProject: true,
	},
	search_code: {
		name: "search_code",
		label: "SearchCode",
		description: SEARCH_CODE_DESCRIPTION,
		toolName: "search_code",
		schema: searchCodeSchema,
		inferProject: true,
	},
	trace_path: {
		name: "trace_path",
		label: "TracePath",
		description: TRACE_PATH_DESCRIPTION,
		toolName: "trace_path",
		schema: tracePathSchema,
		inferProject: true,
	},
	get_code_snippet: {
		name: "get_code_snippet",
		label: "GetCodeSnippet",
		description: GET_CODE_SNIPPET_DESCRIPTION,
		toolName: "get_code_snippet",
		schema: getCodeSnippetSchema,
		inferProject: true,
	},
	get_architecture: {
		name: "get_architecture",
		label: "GetArchitecture",
		description: GET_ARCHITECTURE_DESCRIPTION,
		toolName: "get_architecture",
		schema: getArchitectureSchema,
		inferProject: true,
	},
	query_graph: {
		name: "query_graph",
		label: "QueryGraph",
		description: QUERY_GRAPH_DESCRIPTION,
		toolName: "query_graph",
		schema: queryGraphSchema,
		inferProject: true,
	},
} as const satisfies Record<string, CoreGraphDescriptor>;

function backendUnavailableError(): ToolError {
	return new ToolError(
		"Codebase graph backend unavailable. Set memory.backend=rocky with rocky.apiUrl, or set AMAZE_CODEBASE_ENDPOINT/ROCKY_CODEBASE_ENDPOINT before using core graph tools.",
	);
}

function formatToolContent(content: CodebaseToolContent[]): string {
	const parts: string[] = [];
	for (const item of content) {
		switch (item.type) {
			case "text":
				parts.push(item.text);
				break;
			case "image":
				parts.push(`[Image: ${item.mimeType}]`);
				break;
			case "resource":
				parts.push(
					item.resource.text
						? `[Resource: ${item.resource.uri}]\n${item.resource.text}`
						: `[Resource: ${item.resource.uri}]`,
				);
				break;
		}
	}
	return parts.join("\n\n");
}

function adaptRpcResult(result: CodebaseToolCallResult, toolName: string): AgentToolResult<CodebaseToolDetails> {
	const text = formatToolContent(result.content ?? []);
	const contentText = result.isError ? `Error: ${text}` : text;
	return {
		content: [{ type: "text", text: contentText }],
		details: {
			serverName: "codebase-endpoint",
			toolName,
			isError: result.isError,
			rawContent: result.content,
		},
		...(result.isError ? { isError: true } : {}),
	};
}

function extractText(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map(item => item.text)
		.join("\n\n")
		.trim();
}

function parseJsonPayload(text: string): unknown {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				// Fall through to the clearer backend-output error below.
			}
		}
		throw new ToolError(`Could not parse codebase backend output:\n${text}`);
	}
}

function parseProjectsPayload(text: string): ListProjectsPayload {
	return parseJsonPayload(text) as ListProjectsPayload;
}

function normalizePath(value: string): string {
	return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

function projectRootCandidates(rootPath: string, cwd: string): string[] {
	const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!normalized) return [];
	const resolved = path.isAbsolute(rootPath) ? normalizePath(rootPath) : normalizePath(path.resolve(cwd, rootPath));
	const suffixCandidate = normalizePath(path.resolve("/", normalized.replace(/^\/+/, "")));
	return [...new Set([resolved, suffixCandidate])];
}

function pickProjectForCwd(projects: CodebaseProjectRecord[], cwd: string): string | null {
	const normalizedCwd = normalizePath(cwd);
	let best: { name: string; rootLength: number } | null = null;
	for (const project of projects) {
		if (!project.root_path) continue;
		for (const candidate of projectRootCandidates(project.root_path, cwd)) {
			const same = normalizedCwd === candidate;
			const nested = normalizedCwd.startsWith(`${candidate}/`);
			const suffix = normalizedCwd.endsWith(candidate) || normalizedCwd.endsWith(`${candidate}/`);
			if (!same && !nested && !suffix) continue;
			if (!best || candidate.length > best.rootLength) {
				best = { name: project.name, rootLength: candidate.length };
			}
		}
	}
	return best?.name ?? null;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findImmediateNestedProjectRoots(cwd: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(cwd, { withFileTypes: true });
		const roots: string[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const childRoot = path.join(cwd, entry.name);
			const [hasGit, hasPackageJson] = await Promise.all([
				pathExists(path.join(childRoot, ".git")),
				pathExists(path.join(childRoot, "package.json")),
			]);
			if (hasGit || hasPackageJson) roots.push(childRoot);
		}
		return roots;
	} catch {
		return [];
	}
}

async function inferProjectFromNestedRoots(
	projects: CodebaseProjectRecord[],
	cwd: string,
): Promise<{ match: string | null; ambiguous: string[] }> {
	const matches = new Set<string>();
	for (const childRoot of await findImmediateNestedProjectRoots(cwd)) {
		const match = pickProjectForCwd(projects, childRoot);
		if (match) matches.add(match);
	}
	const projectNames = [...matches].sort();
	if (projectNames.length === 1) {
		return { match: projectNames[0] ?? null, ambiguous: [] };
	}
	return { match: null, ambiguous: projectNames };
}
function envValue(...names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

function codebaseEndpoint(): string | undefined {
	return envValue("AMAZE_CODEBASE_ENDPOINT", "ROCKY_CODEBASE_ENDPOINT");
}

function rockyApiBase(session: ToolSession): string | undefined {
	const configured = session.settings?.get("rocky.apiUrl") || process.env.ROCKY_API_URL;
	if (!configured) return undefined;
	return configured.replace(/\/+$/, "");
}

function rockySearchScopeBody(session: ToolSession, args: Record<string, unknown>): Record<string, unknown> {
	const projectPath = session.settings?.get("rocky.projectPath") || process.env.ROCKY_PROJECT_PATH || session.cwd;
	const scope = typeof args.scope === "string" ? args.scope : "workspace";
	const body: Record<string, unknown> = {
		path: projectPath,
		cwd: session.cwd,
		scope,
	};
	if (Array.isArray(args.roots) && args.roots.every(root => typeof root === "string")) {
		body.roots = args.roots;
	}
	if (typeof args.max_parent_depth === "number") {
		body.max_parent_depth = args.max_parent_depth;
	} else if (scope === "parent_1") {
		body.max_parent_depth = 1;
	} else if (scope === "parent_2") {
		body.max_parent_depth = 2;
	}
	if (typeof args.limit === "number") {
		body.limit = args.limit;
	}
	return body;
}

function adaptCoreBackendPayload(
	payload: unknown,
	toolName: string,
	backend: string,
): AgentToolResult<CodebaseToolDetails> {
	const text = typeof payload === "string" ? payload : JSON.stringify(payload);
	const isError =
		typeof payload === "object" &&
		payload !== null &&
		"isError" in payload &&
		(payload as { isError?: unknown }).isError === true;
	return {
		content: [{ type: "text", text: isError ? `Error: ${text}` : text }],
		details: {
			serverName: backend,
			toolName,
			isError,
			rawContent: [{ type: "text", text }],
		},
		...(isError ? { isError: true } : {}),
	};
}

async function postEndpoint(session: ToolSession, url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
	const fetchImpl = session.fetch ?? fetch;
	return await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
}

async function callCodebaseEndpoint(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<CodebaseToolDetails> | undefined> {
	const endpoint = codebaseEndpoint();
	if (!endpoint) return undefined;
	const baseUrl = endpoint.replace(/\/+$/, "");
	const rpcResponse = await postEndpoint(
		session,
		`${baseUrl}/rpc`,
		{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } },
		signal,
	);
	const rpcText = await rpcResponse.text();
	if (rpcResponse.ok) {
		const rpcPayload = parseJsonPayload(rpcText) as { result?: CodebaseToolCallResult; error?: { message?: string } };
		if (rpcPayload.error) {
			throw new ToolError(
				`Codebase endpoint failed: ${rpcPayload.error.message ?? JSON.stringify(rpcPayload.error)}`,
			);
		}
		if (rpcPayload.result) return adaptRpcResult(rpcPayload.result, toolName);
	}
	const cliResponse = await postEndpoint(session, `${baseUrl}/cli`, { tool: toolName, arguments: args }, signal);
	const cliText = await cliResponse.text();
	if (!cliResponse.ok) {
		throw new ToolError(`Codebase endpoint failed (${cliResponse.status}): ${cliText || rpcText}`);
	}
	return adaptCoreBackendPayload(parseJsonPayload(cliText), toolName, "codebase-endpoint");
}

async function callRockyCodebaseEndpoint(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<CodebaseToolDetails> | undefined> {
	const baseUrl = rockyApiBase(session);
	if (!baseUrl) return undefined;
	const projectPath = session.settings?.get("rocky.projectPath") || process.env.ROCKY_PROJECT_PATH || session.cwd;
	if (toolName === "list_projects") {
		return adaptCoreBackendPayload(
			{ projects: [{ name: String(projectPath).replace(/^\/+/, "").replaceAll("/", "-"), root_path: projectPath }] },
			toolName,
			"rocky",
		);
	}
	const pathBody = rockySearchScopeBody(session, args);
	if (toolName === "search_graph") {
		const query = args.query ?? args.semantic_query ?? args.name_pattern ?? args.file_pattern ?? "";
		const response = await postEndpoint(
			session,
			`${baseUrl}/v1/rocky/codebase/search_graph`,
			{ ...pathBody, query },
			signal,
		);
		const text = await response.text();
		if (!response.ok) throw new ToolError(`Rocky codebase failed (${response.status}): ${text}`);
		return adaptCoreBackendPayload(parseJsonPayload(text), toolName, "rocky");
	}
	if (toolName === "search_code") {
		const pattern = args.pattern ?? args.query ?? "";
		const response = await postEndpoint(
			session,
			`${baseUrl}/v1/rocky/codebase/search_code`,
			{ ...pathBody, pattern },
			signal,
		);
		const text = await response.text();
		if (!response.ok) throw new ToolError(`Rocky codebase failed (${response.status}): ${text}`);
		return adaptCoreBackendPayload(parseJsonPayload(text), toolName, "rocky");
	}
	// Every other core graph tool (trace_path, get_code_snippet, get_architecture,
	// query_graph) must hit the SAME backend — and therefore the same project /
	// cache namespace — as search_graph/search_code. Routing them through a generic
	// rocky passthrough keeps them on the rocky binary instead of silently falling
	// through to a separate AMAZE_CODEBASE_ENDPOINT backend with a different cache dir.
	const response = await postEndpoint(
		session,
		`${baseUrl}/v1/rocky/codebase/call`,
		{ ...pathBody, tool: toolName, arguments: args },
		signal,
	);
	const text = await response.text();
	if (!response.ok) throw new ToolError(`Rocky codebase failed (${response.status}): ${text}`);
	return adaptCoreBackendPayload(parseJsonPayload(text), toolName, "rocky");
}

async function callCoreCodebaseBackend(
	session: ToolSession,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<CodebaseToolDetails>> {
	const rockyResult = await callRockyCodebaseEndpoint(session, toolName, args, signal);
	if (rockyResult) return rockyResult;
	const endpointResult = await callCodebaseEndpoint(session, toolName, args, signal);
	if (!endpointResult) throw backendUnavailableError();
	return endpointResult;
}

async function listProjectsViaBackend(session: ToolSession, signal?: AbortSignal): Promise<CodebaseProjectRecord[]> {
	const result = await callCoreCodebaseBackend(session, "list_projects", {}, signal);
	const payload = parseProjectsPayload(extractText(result));
	return payload.projects ?? [];
}

async function inferProject(session: ToolSession, explicitProject: unknown, signal?: AbortSignal): Promise<string> {
	if (typeof explicitProject === "string" && explicitProject.trim().length > 0) {
		return explicitProject;
	}
	const projects = await listProjectsViaBackend(session, signal);
	if (projects.length === 0) {
		throw new ToolError(
			"No indexed Rocky codebase projects available. Index the repository or pass `project` explicitly.",
		);
	}
	const match = pickProjectForCwd(projects, session.cwd);
	if (match) return match;
	const nestedMatch = await inferProjectFromNestedRoots(projects, session.cwd);
	if (nestedMatch.match) return nestedMatch.match;
	if (nestedMatch.ambiguous.length > 0) {
		throw new ToolError(
			`Multiple nested indexed projects match cwd ${session.cwd}: ${nestedMatch.ambiguous.join(", ")}. Call list_projects first or pass the \`project\` field explicitly.`,
		);
	}
	throw new ToolError(
		`Could not infer the indexed project for cwd ${session.cwd}. Call list_projects first or pass the \`project\` field explicitly.`,
	);
}

async function executeDescriptor(
	descriptor: CoreGraphDescriptor,
	session: ToolSession,
	_toolCallId: string,
	params: Record<string, unknown>,
	_onUpdate?: AgentToolUpdateCallback<CodebaseToolDetails>,
	_context?: unknown,
	signal?: AbortSignal,
): Promise<AgentToolResult<CodebaseToolDetails>> {
	throwIfAborted(signal);
	const args = { ...params };
	if (descriptor.inferProject) {
		args.project = await inferProject(session, args.project, signal);
	}
	try {
		return await callCoreCodebaseBackend(session, descriptor.toolName, args, signal);
	} catch (error) {
		if (error instanceof ToolError) throw error;
		throw backendUnavailableError();
	}
}

class CodebaseCoreTool<TSchema extends ToolSchema> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
	readonly strict = true;
	readonly approval = "read" as const;
	readonly loadMode = "essential" as const;

	constructor(
		private readonly session: ToolSession,
		private readonly descriptor: CoreGraphDescriptor & { schema: TSchema },
	) {
		this.name = descriptor.name;
		this.label = descriptor.label;
		this.description = descriptor.description;
		this.parameters = descriptor.schema;
	}

	async execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<CodebaseToolDetails>,
		context?: unknown,
	): Promise<AgentToolResult<CodebaseToolDetails>> {
		if (signal?.aborted) throw new ToolAbortError();
		return await executeDescriptor(this.descriptor, this.session, toolCallId, params, onUpdate, context, signal);
	}
}

export class ListProjectsTool extends CodebaseCoreTool<typeof listProjectsSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.list_projects);
	}
}

export class SearchGraphTool extends CodebaseCoreTool<typeof searchGraphSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.search_graph);
	}
}

export class SearchCodeTool extends CodebaseCoreTool<typeof searchCodeSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.search_code);
	}
}

export class TracePathTool extends CodebaseCoreTool<typeof tracePathSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.trace_path);
	}
}

export class GetCodeSnippetTool extends CodebaseCoreTool<typeof getCodeSnippetSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.get_code_snippet);
	}
}

export class GetArchitectureTool extends CodebaseCoreTool<typeof getArchitectureSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.get_architecture);
	}
}

export class QueryGraphTool extends CodebaseCoreTool<typeof queryGraphSchema> {
	constructor(session: ToolSession) {
		super(session, CORE_GRAPH_DESCRIPTORS.query_graph);
	}
}
