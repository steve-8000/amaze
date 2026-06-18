export const MCP_MIGRATION_MESSAGES = [
	"amaze mcp has moved to Xenonite. Use: cd ~/rocky/xenonite && npm run mcp",
	"For amaze memory/search tools over HTTP MCP, use: cd ~/rocky/xenonite && XENONITE_MCP_TOOL_MODE=full npm start",
	"For the experimental amaze-local adapter, use: amaze mcp-dev",
] as const;

export type McpEntrypointContract =
	| { kind: "xenonite-migration"; exitCode: 2; messages: readonly string[] }
	| { kind: "local-dev-adapter" }
	| { kind: "none" };

export function mcpEntrypointContract(args: readonly string[]): McpEntrypointContract {
	if (args[0] === "mcp") {
		return { kind: "xenonite-migration", exitCode: 2, messages: MCP_MIGRATION_MESSAGES };
	}
	if (args[0] === "mcp-dev") {
		return { kind: "local-dev-adapter" };
	}
	return { kind: "none" };
}
