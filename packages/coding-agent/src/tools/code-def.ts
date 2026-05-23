import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeSymbol } from "../nexus/knowledge/types";
import { resolveNexusProjectScope } from "../nexus/scope";
import { resolveAgentCwd } from "./_agent-cwd";
import type { ToolSession } from ".";
import { truncate } from "./repo-search";

const codeDefSchema = z.object({
	symbol: z.string().describe("symbol, type, function, class, or API name to look up"),
	path: z.string().optional().describe("optional exact repository-relative path"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type CodeDefParams = z.infer<typeof codeDefSchema>;

export class CodeDefTool implements AgentTool<typeof codeDefSchema> {
	readonly name = "code_def";
	readonly label = "Code Definition";
	readonly description = "Find a symbol definition from Nexus repository knowledge.";
	readonly parameters = codeDefSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Find Nexus-indexed code definitions";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): CodeDefTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new CodeDefTool(session);
	}

	async execute(_id: string, params: CodeDefParams): Promise<AgentToolResult> {
		const cwd = resolveAgentCwd(this.session);
		const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
		const store = new NexusKnowledgeStore({ agentDir: this.session.settings.getAgentDir(), cwd });
		try {
			const definitions = store.codeDefinitions({ name: params.symbol, repoRoot, path: params.path, limit: params.limit });
			return {
				content: [{ type: "text", text: renderCodeDefinitions(params.symbol, definitions) }],
				details: { count: definitions.length, symbol: params.symbol, path: params.path, definitions },
			};
		} finally {
			store.close();
		}
	}
}

function renderCodeDefinitions(symbol: string, definitions: NexusKnowledgeSymbol[]): string {
	if (definitions.length === 0) return `No Nexus code definitions found for ${symbol}.`;
	const lines = [`Nexus code definitions for ${symbol}:`, ""];
	for (const definition of definitions) {
		const label = definition.parentSymbol ? `${definition.parentSymbol}.${definition.name}` : definition.name;
		const span = definition.endLine && definition.endLine > definition.line ? `${definition.line}-${definition.endLine}` : `${definition.line}`;
		lines.push(`- ${definition.path}:${span}:${definition.column} [${definition.kind}${definition.exported ? ", exported" : ""}] ${label} :: ${truncate(definition.signature, 240)}`);
	}
	return lines.join("\n");
}
