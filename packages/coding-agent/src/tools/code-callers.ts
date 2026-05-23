import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeCaller } from "../nexus/knowledge/types";
import { resolveNexusProjectScope } from "../nexus/scope";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { ToolSession } from ".";
import { oneLine, truncate } from "./repo-search";

const codeCallersSchema = z.object({
	symbol: z.string().describe("symbol, type, function, class, or API name to find callers for"),
	path: z.string().optional().describe("optional exact repository-relative path"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type CodeCallersParams = z.infer<typeof codeCallersSchema>;

export class CodeCallersTool implements AgentTool<typeof codeCallersSchema> {
	readonly name = "code_callers";
	readonly label = "Code Callers";
	readonly description = "Find calling symbols for a target from Nexus repository knowledge.";
	readonly parameters = codeCallersSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Find Nexus-indexed code callers";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): CodeCallersTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new CodeCallersTool(session);
	}

	async execute(_id: string, params: CodeCallersParams): Promise<AgentToolResult> {
		const cwd = resolveRockeyToolCwd(this.session);
		const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
		const store = new NexusKnowledgeStore({ agentDir: this.session.settings.getAgentDir(), cwd });
		try {
			const callers = store.codeCallers({ name: params.symbol, repoRoot, path: params.path, limit: params.limit });
			return {
				content: [{ type: "text", text: renderCodeCallers(params.symbol, callers) }],
				details: { count: callers.length, symbol: params.symbol, path: params.path, callers },
			};
		} finally {
			store.close();
		}
	}
}

function renderCodeCallers(symbol: string, callers: NexusKnowledgeCaller[]): string {
	if (callers.length === 0) return `No Nexus code callers found for ${symbol}.`;
	const lines = [`Nexus code callers for ${symbol}:`, ""];
	for (const caller of callers) {
		const callerName = caller.caller ? `${caller.caller.parentSymbol ? `${caller.caller.parentSymbol}.` : ""}${caller.caller.name}` : "unknown caller";
		const callerSpan = caller.caller?.endLine && caller.caller.endLine > caller.caller.line ? `${caller.caller.line}-${caller.caller.endLine}` : `${caller.caller?.line ?? "?"}`;
		lines.push(
			`- ${caller.reference.path}:${caller.reference.line}:${caller.reference.column} [caller=${caller.caller ? `${caller.caller.path}:${callerSpan} ${callerName}` : callerName}] ${truncate(oneLine(caller.reference.snippet), 240)}`,
		);
	}
	return lines.join("\n");
}
