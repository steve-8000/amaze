import type { AvailableTool } from "./types.ts";

const XENONITE_SEARCH_TOOLS = new Set([
	"index_build",
	"index_sync",
	"index_drop",
	"index_stop",
	"index_watch",
	"index_status",
	"index_health",
	"index_list",
	"search_query",
	"graph_build",
	"graph_query",
	"graph_stats",
	"graph_cycles",
	"graph_view",
	"graph_drop",
	"graph_status",
	"graph_impact",
	"graph_trace",
	"graph_symbol",
	"graph_symbols",
	"ctx_list",
	"ctx_search",
	"ctx_add",
	"ctx_drop",
	"mem_recall",
	"mem_search",
	"mem_store",
	"mem_optimize",
]);

function getToolCategory(name: string): AvailableTool["category"] {
	if (XENONITE_SEARCH_TOOLS.has(name)) {
		return "search";
	}
	if (name === "grep" || name === "glob") {
		return "search";
	}
	if (name.startsWith("session_")) {
		return "session";
	}
	if (name === "skill") {
		return "command";
	}
	return "other";
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
	return toolNames.map((name) => ({ name, category: getToolCategory(name) }));
}

export function getToolsPromptDisplay(tools: AvailableTool[]): string {
	const displayNames: string[] = [];

	if (tools.some((tool) => tool.category === "search" && tool.name === "search_query")) {
		displayNames.push("`search_query`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "index_status")) {
		displayNames.push("`index_status`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_recall")) {
		displayNames.push("`mem_recall`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_optimize")) {
		displayNames.push("`mem_optimize`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "grep")) {
		displayNames.push("`grep`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "glob")) {
		displayNames.push("`glob`");
	}

	return displayNames.join(", ");
}
