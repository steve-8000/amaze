import type { AvailableTool } from "./types.ts";

const XENONITE_SEARCH_TOOLS = new Set([
	"context_engine",
	"index_build",
	"index_sync",
	"index_drop",
	"index_stop",
	"index_watch",
	"index_status",
	"index_health",
	"index_list",
	"search_query",
	"code_read",
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
	"mem_delete",
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

	if (tools.some((tool) => tool.category === "search" && tool.name === "context_engine")) {
		displayNames.push("`context_engine`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_recall")) {
		displayNames.push("`mem_recall`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_search")) {
		displayNames.push("`mem_search`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_store")) {
		displayNames.push("`mem_store`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_optimize")) {
		displayNames.push("`mem_optimize`");
	}
	if (tools.some((tool) => tool.category === "search" && tool.name === "mem_delete")) {
		displayNames.push("`mem_delete`");
	}
	if (tools.some((tool) => tool.name === "agent_run")) {
		displayNames.push("`agent_run`");
	}

	return displayNames.join(", ");
}

export function getFallbackToolsPromptDisplay(tools: AvailableTool[]): string {
	const fallbackNames = [
		"search_query",
		"code_read",
		"index_status",
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
		"grep",
		"glob",
	];
	const available = new Set(tools.map((tool) => tool.name));
	return fallbackNames
		.filter((name) => available.has(name))
		.map((name) => `\`${name}\``)
		.join(", ");
}

export function hasXenoniteProjectTools(tools: AvailableTool[]): boolean {
	return tools.some((tool) => XENONITE_SEARCH_TOOLS.has(tool.name));
}
