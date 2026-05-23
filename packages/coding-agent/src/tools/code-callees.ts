import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeCallee } from "../nexus/knowledge/types";
import { resolveNexusProjectScope } from "../nexus/scope";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { ToolSession } from ".";
import { oneLine, truncate } from "./repo-search";

const codeCalleesSchema = z.object({
	symbol: z.string().describe("symbol, type, function, class, or API name to inspect for outbound calls"),
	path: z.string().optional().describe("optional exact repository-relative path"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type CodeCalleesParams = z.infer<typeof codeCalleesSchema>;

export class CodeCalleesTool implements AgentTool<typeof codeCalleesSchema> {
	readonly name = "code_callees";
	readonly label = "Code Callees";
	readonly description = "Find outbound calls from a symbol using Nexus repository knowledge.";
	readonly parameters = codeCalleesSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Find Nexus-indexed code callees";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): CodeCalleesTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new CodeCalleesTool(session);
	}

	async execute(_id: string, params: CodeCalleesParams): Promise<AgentToolResult> {
		const cwd = resolveRockeyToolCwd(this.session);
		const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
		const store = new NexusKnowledgeStore({ agentDir: this.session.settings.getAgentDir(), cwd });
		try {
			const callees = store.codeCallees({ name: params.symbol, repoRoot, path: params.path, limit: params.limit });
			return {
				content: [{ type: "text", text: renderCodeCallees(params.symbol, callees) }],
				details: { count: callees.length, symbol: params.symbol, path: params.path, callees },
			};
		} finally {
			store.close();
		}
	}
}

function renderCodeCallees(symbol: string, callees: NexusKnowledgeCallee[]): string {
	if (callees.length === 0) return `No Nexus code callees found for ${symbol}.`;
	const lines = [`Nexus code callees for ${symbol}:`, ""];
	for (const callee of callees) {
		const calleeLabel = callee.callee ? `${callee.callee.path}:${callee.callee.line} ${callee.callee.name}` : callee.name;
		lines.push(`- ${callee.line}:${callee.column} [${calleeLabel}] ${truncate(oneLine(callee.snippet), 240)}`);
	}
	return lines.join("\n");
}
