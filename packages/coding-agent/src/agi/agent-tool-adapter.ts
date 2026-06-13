import type { AgentTool, AgentToolContext, AgentToolResult } from "@amaze/agent-core";
import type { ToolDescriptor, ToolDomain, ToolExecutionContext } from "../tools/registry/tool-descriptor";

/**
 * Production built-in tool surface adapter for the strict AGI runtime.
 *
 * The strict runtime never invents synthetic descriptors. It adapts the real
 * `AgentTool` built-ins into {@link ToolDescriptor}s so the registry role
 * executor drives the same tool implementations the interactive agent uses.
 * Two adapters exist:
 * - {@link descriptorFromAgentTool} — eager, one fixed tool instance (read-only).
 * - {@link descriptorFromLazyAgentTool} — builds the tool per execution against
 *   the execution context cwd, required for mutating tools whose underlying
 *   session resolves paths from its own cwd (e.g. a git worktree sandbox).
 */

export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit", "ast_edit", "bash"]);
export const ROLLBACK_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit", "ast_edit"]);

export type AgentToolDescriptorMeta = Pick<
	ToolDescriptor,
	"domain" | "riskLevel" | "mutatesWorkspace" | "requiresApproval" | "supportsRollback"
>;

export function descriptorMetaForToolName(name: string): AgentToolDescriptorMeta {
	if (name === "read") {
		return {
			domain: "filesystem",
			riskLevel: "LOW",
			mutatesWorkspace: false,
			requiresApproval: false,
			supportsRollback: false,
		};
	}
	const mutates = MUTATING_TOOL_NAMES.has(name);
	return {
		domain: domainFromToolName(name),
		riskLevel: mutates ? "HIGH" : "LOW",
		mutatesWorkspace: mutates,
		requiresApproval: false,
		supportsRollback: ROLLBACK_TOOL_NAMES.has(name),
	};
}

export function descriptorFromAgentTool(tool: AgentTool): ToolDescriptor {
	return buildDescriptor(tool.name, tool.label, tool.timeoutMs, tool.parameters, async () => tool);
}

export function descriptorFromLazyAgentTool(
	name: string,
	buildTool: (cwd: string) => AgentTool | Promise<AgentTool>,
	options: { label?: string; timeoutMs?: number; parameters?: unknown } = {},
): ToolDescriptor {
	return buildDescriptor(name, options.label, options.timeoutMs, options.parameters, (cwd: string) =>
		Promise.resolve(buildTool(cwd)),
	);
}

function buildDescriptor(
	name: string,
	label: string | undefined,
	timeoutMs: number | undefined,
	parameters: unknown,
	resolveTool: (cwd: string) => Promise<AgentTool>,
): ToolDescriptor {
	const meta = descriptorMetaForToolName(name);
	return {
		name,
		label,
		toolClass: "legacy",
		...meta,
		timeoutMs,
		schema: { input: parameters },
		execute: async (input, ctx) => {
			try {
				const tool = await resolveTool(ctx.cwd ?? process.cwd());
				const result = await tool.execute(
					ctx.toolCallId ?? `agi-runtime:${ctx.actionId ?? name}`,
					input as never,
					ctx.signal,
					undefined,
					agentToolContextFromExecutionContext(ctx),
				);
				return {
					ok: !result.isError,
					output: result,
					error: result.isError ? new Error(renderAgentToolError(result)) : undefined,
					raw: result,
				};
			} catch (error) {
				return {
					ok: false,
					output: undefined,
					error: error instanceof Error ? error : new Error(String(error)),
				};
			}
		},
	};
}

export function domainFromToolName(name: string): ToolDomain {
	if (name === "find" || name === "search") return "search";
	if (name === "github") return "vcs";
	if (name === "bash") return "shell";
	if (name === "web_search" || name === "browser") return "network";
	if (name.includes("memory") || name.includes("brain")) return "memory";
	if (name === "task" || name === "todo_write" || name === "todo_read") return "meta";
	return "unknown";
}

export function agentToolContextFromExecutionContext(ctx: ToolExecutionContext): AgentToolContext {
	// The legacy session carries the Settings instance via ctx.session for tools
	// that read configuration (e.g. write's LSP writethrough).
	const session = (ctx as { session?: unknown }).session;
	return {
		cwd: ctx.cwd ?? process.cwd(),
		hasUI: false,
		settings: session,
	} as unknown as AgentToolContext;
}

export function renderAgentToolError(result: AgentToolResult): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map(item => item.text)
		.join("\n");
}
