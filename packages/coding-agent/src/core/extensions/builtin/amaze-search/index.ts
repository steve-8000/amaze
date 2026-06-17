import { type TSchema, Type } from "typebox";
import { loadAmazeConfig } from "../../../../amaze/config.ts";
import type { ExtensionAPI, ToolDefinition } from "../../types.ts";

type HandlerKey = "Index" | "Query" | "Graph" | "Context" | "Manage";

interface SearchToolSpec {
	name: string;
	origName: string;
	handler: HandlerKey;
	description: string;
	params: Record<string, TSchema>;
}

const pp = Type.Optional(Type.String({ description: "Absolute project directory path. Defaults to the current working directory." }));
const ppReq = Type.String({ description: "Absolute project directory path." });

const SPECS: SearchToolSpec[] = [
	{ name: "index_build", origName: "codebase_index", handler: "Index", description: "Start indexing a codebase in the background. Poll index_status until complete before searching.", params: { projectPath: pp, extraExtensions: Type.Optional(Type.String({ description: "Comma-separated extra file extensions to index (e.g. '.tpl,.blade')." })) } },
	{ name: "index_sync", origName: "codebase_update", handler: "Index", description: "Incrementally update an existing index; only re-indexes changed files.", params: { projectPath: pp, extraExtensions: Type.Optional(Type.String({ description: "Comma-separated extra file extensions." })) } },
	{ name: "index_drop", origName: "codebase_remove", handler: "Index", description: "Remove a project's index entirely from the vector store.", params: { projectPath: ppReq } },
	{ name: "index_stop", origName: "codebase_stop", handler: "Index", description: "Stop any in-progress indexing for a project.", params: { projectPath: pp } },
	{ name: "index_watch", origName: "codebase_watch", handler: "Index", description: "Start/stop the file watcher or get watcher status.", params: { projectPath: pp, action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], { description: "start, stop, or status." })) } },
	{ name: "index_status", origName: "codebase_status", handler: "Query", description: "Report indexing progress and index health for a project.", params: { projectPath: pp } },
	{ name: "index_health", origName: "codebase_health", handler: "Manage", description: "Check infrastructure health: vector DB, embedding provider, model.", params: {} },
	{ name: "index_list", origName: "codebase_list_projects", handler: "Manage", description: "List all indexed projects.", params: {} },

	{ name: "search_query", origName: "codebase_search", handler: "Query", description: "Semantic code search by natural-language query.", params: { query: Type.String({ description: "Natural-language search query." }), projectPath: pp, limit: Type.Optional(Type.Number({ description: "Max results. Default 10." })) } },

	{ name: "graph_build", origName: "codebase_graph_build", handler: "Graph", description: "Build the dependency/symbol graph for a project.", params: { projectPath: pp } },
	{ name: "graph_query", origName: "codebase_graph_query", handler: "Graph", description: "Query the graph for a specific file's relationships.", params: { filePath: Type.String({ description: "Relative file path (e.g. 'src/index.ts')." }), projectPath: pp } },
	{ name: "graph_stats", origName: "codebase_graph_stats", handler: "Graph", description: "Show graph statistics.", params: { projectPath: pp } },
	{ name: "graph_cycles", origName: "codebase_graph_circular", handler: "Graph", description: "Find circular dependencies.", params: { projectPath: pp } },
	{ name: "graph_view", origName: "codebase_graph_visualize", handler: "Graph", description: "Produce a visualization of the graph.", params: { projectPath: pp } },
	{ name: "graph_drop", origName: "codebase_graph_remove", handler: "Graph", description: "Remove a project's graph.", params: { projectPath: ppReq } },
	{ name: "graph_status", origName: "codebase_graph_status", handler: "Graph", description: "Report graph build status.", params: { projectPath: pp } },
	{ name: "graph_impact", origName: "codebase_impact", handler: "Graph", description: "Walk dependents to assess blast radius of a file or symbol.", params: { projectPath: pp, target: Type.String({ description: "Target relative file path OR symbol name." }), depth: Type.Optional(Type.Number({ description: "Hops to walk back. Default 3, max 10." })) } },
	{ name: "graph_trace", origName: "codebase_flow", handler: "Graph", description: "Trace control/data flow from an entry symbol.", params: { projectPath: pp, entrypoint: Type.Optional(Type.String({ description: "Symbol to trace from; omit to list entry points." })), file: Type.Optional(Type.String({ description: "File hint to disambiguate the symbol." })), depth: Type.Optional(Type.Number({ description: "Max DFS depth. Default 5, max 10." })) } },
	{ name: "graph_symbol", origName: "codebase_symbol", handler: "Graph", description: "Look up a symbol definition and references.", params: { projectPath: pp, name: Type.String({ description: "Symbol name (e.g. 'validateUser')." }), file: Type.Optional(Type.String({ description: "File hint to disambiguate." })) } },
	{ name: "graph_symbols", origName: "codebase_symbols", handler: "Graph", description: "List symbols in a file or matching a query project-wide.", params: { projectPath: pp, file: Type.Optional(Type.String({ description: "Relative file path to list symbols for." })), query: Type.Optional(Type.String({ description: "Substring to match symbol names." })), limit: Type.Optional(Type.Number({ description: "Max results. Default 200." })) } },

	{ name: "ctx_list", origName: "codebase_context", handler: "Context", description: "List stored context artifacts for a project.", params: { projectPath: pp } },
	{ name: "ctx_search", origName: "codebase_context_search", handler: "Context", description: "Semantic search over stored context artifacts.", params: { query: Type.String({ description: "Natural-language query." }), projectPath: pp } },
	{ name: "ctx_add", origName: "codebase_context_index", handler: "Context", description: "Index context artifacts for later retrieval.", params: { projectPath: pp } },
	{ name: "ctx_drop", origName: "codebase_context_remove", handler: "Context", description: "Remove a project's context artifacts.", params: { projectPath: ppReq } },
];

// Code-engine tools forward to the Xenonite service over HTTP. amaze holds no
// vector store, embeddings, or socraticode code in-process.
export default function amazeSearchExtension(pi: ExtensionAPI): void {
	const config = loadAmazeConfig();
	if (!config.tools.search.enabled) return;
	const base = `http://127.0.0.1:${config.services.xenonite.port}`;

	for (const spec of SPECS) {
		const tool: ToolDefinition = {
			name: spec.name,
			label: spec.name,
			description: spec.description,
			parameters: Type.Object(spec.params),
			async execute(_id, params) {
				try {
					const res = await fetch(`${base}/v1/code/call`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ op: spec.origName, args: params }),
					});
					const data = (await res.json()) as { result?: string; error?: string };
					return { content: [{ type: "text", text: data.result ?? data.error ?? "" }], details: undefined };
				} catch {
					return {
						content: [{ type: "text", text: `Xenonite service not reachable at ${base}. Start it: cd ~/rocky/xenonite && node src/server.mjs` }],
						details: undefined,
					};
				}
			},
		};
		pi.registerTool(tool);
	}
}
