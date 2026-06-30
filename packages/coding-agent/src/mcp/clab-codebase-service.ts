import type { CustomTool } from "../extensibility/custom-tools/types";

export const AMAZE_CODEBASE_MCP_SERVER_NAME = "clab-codebase";
const AMAZE_CODEBASE_MCP_TOOL_PREFIX = "mcp__amaze_codebase_";

export type McpServerTagged = {
	mcpServerName?: string;
	name?: string;
};

export function isAmazeCodebaseMcpTool(value: McpServerTagged): boolean {
	if (value.mcpServerName === AMAZE_CODEBASE_MCP_SERVER_NAME) return true;
	return value.name?.startsWith(AMAZE_CODEBASE_MCP_TOOL_PREFIX) ?? false;
}

export function filterAmazeCodebaseMcpTools<T extends McpServerTagged>(tools: readonly T[]): T[] {
	return tools.filter(tool => !isAmazeCodebaseMcpTool(tool));
}

export function filterAmazeCodebaseLoadedTools<T extends { tool: CustomTool }>(tools: readonly T[]): T[] {
	return tools.filter(entry => !isAmazeCodebaseMcpTool(entry.tool));
}
