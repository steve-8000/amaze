import { type TSchema, Type } from "typebox";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";
import {
	AMAZE_CODEBASE_TOOL_NAMES,
	CODEBASE_MEMORY_NATIVE_TOOL_NAMES,
	type CodebaseMemoryNativeToolName,
} from "./contract.ts";
import { CodebaseMemoryNativeAdapter, type CodebaseMemoryNativeAdapterOptions } from "./native.ts";

export {
	AMAZE_CODEBASE_TOOL_NAMES,
	AMAZE_LEGACY_CODEBASE_TOOL_NAMES,
	AMAZE_SKILL_TOOL_NAMES,
	CODEBASE_MEMORY_NATIVE_TOOL_ALIASES,
	CODEBASE_MEMORY_NATIVE_TOOL_NAMES,
} from "./contract.ts";

const emptySchema = Type.Object({}, { additionalProperties: false });
const nativeProjectSchema = Type.Object(
	{
		project: Type.String({ description: "Project id." }),
	},
	{ additionalProperties: true },
);

const nativeSchemas = {
	index_repository: Type.Object(
		{
			repo_path: Type.String({ description: "Path to the repository." }),
			mode: Type.Optional(
				Type.Union([
					Type.Literal("full"),
					Type.Literal("moderate"),
					Type.Literal("fast"),
					Type.Literal("cross-repo-intelligence"),
				]),
			),
			target_projects: Type.Optional(Type.Array(Type.String())),
			name: Type.Optional(Type.String({ description: "Override the derived project name." })),
			persistence: Type.Optional(Type.Boolean({ description: "Write .codebase-memory/graph.db.zst artifact." })),
		},
		{ additionalProperties: true },
	),
	search_graph: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			query: Type.Optional(Type.String({ description: "BM25/natural-language search query." })),
			label: Type.Optional(Type.String()),
			name_pattern: Type.Optional(Type.String({ description: "Regex over node name." })),
			qn_pattern: Type.Optional(Type.String({ description: "Regex over qualified name." })),
			file_pattern: Type.Optional(Type.String()),
			relationship: Type.Optional(Type.String()),
			min_degree: Type.Optional(Type.Integer({ minimum: 0 })),
			max_degree: Type.Optional(Type.Integer({ minimum: 0 })),
			exclude_entry_points: Type.Optional(Type.Boolean()),
			include_connected: Type.Optional(Type.Boolean()),
			semantic_query: Type.Optional(Type.Array(Type.String())),
			limit: Type.Optional(Type.Integer({ minimum: 0 })),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
		},
		{ additionalProperties: true },
	),
	query_graph: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			query: Type.String({ description: "Read-only Cypher-like query." }),
			max_rows: Type.Optional(Type.Integer({ minimum: 0 })),
		},
		{ additionalProperties: true },
	),
	trace_path: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			function_name: Type.String({ description: "Function or qualified function name." }),
			direction: Type.Optional(
				Type.Union([Type.Literal("inbound"), Type.Literal("outbound"), Type.Literal("both")]),
			),
			depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
			mode: Type.Optional(
				Type.Union([Type.Literal("calls"), Type.Literal("data_flow"), Type.Literal("cross_service")]),
			),
			parameter_name: Type.Optional(Type.String()),
			edge_types: Type.Optional(Type.Array(Type.String())),
			risk_labels: Type.Optional(Type.Boolean()),
			include_tests: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: true },
	),
	get_code_snippet: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			qualified_name: Type.String({ description: "Qualified name from search_graph, or short symbol name." }),
			include_neighbors: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: true },
	),
	get_graph_schema: nativeProjectSchema,
	get_architecture: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			path: Type.Optional(Type.String({ description: "Optional path prefix scope." })),
			aspects: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: true },
	),
	search_code: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			pattern: Type.String({ description: "Text or regex pattern." }),
			file_pattern: Type.Optional(Type.String()),
			path_filter: Type.Optional(Type.String()),
			mode: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("full"), Type.Literal("files")])),
			context: Type.Optional(Type.Integer({ minimum: 0 })),
			regex: Type.Optional(Type.Boolean()),
			limit: Type.Optional(Type.Integer({ minimum: 0 })),
		},
		{ additionalProperties: true },
	),
	list_projects: emptySchema,
	delete_project: nativeProjectSchema,
	index_status: nativeProjectSchema,
	detect_changes: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			scope: Type.Optional(Type.String()),
			depth: Type.Optional(Type.Integer({ minimum: 0 })),
			base_branch: Type.Optional(Type.String()),
			since: Type.Optional(Type.String({ description: "Git ref or tag to compare from." })),
		},
		{ additionalProperties: true },
	),
	manage_adr: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			mode: Type.Optional(Type.Union([Type.Literal("get"), Type.Literal("update"), Type.Literal("sections")])),
			content: Type.Optional(Type.String()),
			sections: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: true },
	),
	ingest_traces: Type.Object(
		{
			project: Type.String({ description: "Project id." }),
			traces: Type.Array(Type.Record(Type.String(), Type.Unknown())),
		},
		{ additionalProperties: true },
	),
} satisfies Record<CodebaseMemoryNativeToolName, TSchema>;

const nativeDescriptions = {
	index_repository: "Index a repository into the native codebase-memory knowledge graph.",
	search_graph: "Search native code graph nodes by BM25, regex, label, file, degree, or semantic query.",
	query_graph: "Execute a read-only Cypher-like query against the native code graph.",
	trace_path: "Trace callers, callees, data flow, or cross-service paths through the native graph.",
	get_code_snippet: "Read source for a native graph symbol by qualified name.",
	get_graph_schema: "Return native graph node labels, edge types, and property schema.",
	get_architecture: "Return native architecture overview, clusters, dependencies, and ADR context.",
	search_code: "Run graph-augmented native code search.",
	list_projects: "List projects indexed by the native codebase-memory engine.",
	delete_project: "Delete one project from the native codebase-memory store.",
	index_status: "Inspect one native codebase-memory project index.",
	detect_changes: "Map git changes to affected native graph symbols and risk.",
	manage_adr: "Read, update, or inspect native Architecture Decision Records.",
	ingest_traces: "Ingest runtime traces into the native code graph.",
} satisfies Record<CodebaseMemoryNativeToolName, string>;

const nativePromptSnippets = {
	index_repository: "Index a repository into the native code graph",
	search_graph: "Search native graph nodes",
	query_graph: "Run a native graph query",
	trace_path: "Trace callers, callees, or data flow",
	get_code_snippet: "Read native graph symbol source",
	get_graph_schema: "Inspect native graph schema",
	get_architecture: "Summarize native graph architecture",
	search_code: "Search code with native graph enrichment",
	list_projects: "List native indexed projects",
	delete_project: "Delete a native project index",
	index_status: "Inspect native index status",
	detect_changes: "Analyze native graph change impact",
	manage_adr: "Manage native architecture records",
	ingest_traces: "Ingest runtime traces",
} satisfies Record<CodebaseMemoryNativeToolName, string>;

export type CodebaseMemoryNativeToolOptions = Omit<CodebaseMemoryNativeAdapterOptions, "cwd">;

export function createCodebaseMemoryNativeToolDefinitions(
	cwd: string,
	options: CodebaseMemoryNativeToolOptions = {},
): ToolDefinition[] {
	const adapter = new CodebaseMemoryNativeAdapter({ ...options, cwd });
	return CODEBASE_MEMORY_NATIVE_TOOL_NAMES.map((name) =>
		defineTool({
			name,
			label: name,
			description: nativeDescriptions[name],
			promptSnippet: nativePromptSnippets[name],
			parameters: nativeSchemas[name],
			async execute(_toolCallId, params, signal) {
				const result = await adapter.callToolResult(name, params as Record<string, unknown>, { signal });
				return {
					content: result.content,
					details: {
						envelope: result.envelope,
						stdout: result.stdout,
						stderr: result.stderr,
					},
					isError: result.isError,
				};
			},
		}),
	);
}

export function getAmazeLegacyCodebaseToolNames(): readonly string[] {
	return AMAZE_CODEBASE_TOOL_NAMES;
}
