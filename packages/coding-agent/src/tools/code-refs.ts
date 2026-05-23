import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeReference } from "../nexus/knowledge/types";
import { resolveNexusProjectScope } from "../nexus/scope";
import { resolveAgentCwd } from "./_agent-cwd";
import type { ToolSession } from ".";
import { oneLine, truncate } from "./repo-search";

const codeRefsSchema = z.object({
	symbol: z.string().describe("symbol, type, function, class, or API name to find references for"),
	path: z.string().optional().describe("optional exact repository-relative path"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type CodeRefsParams = z.infer<typeof codeRefsSchema>;

export class CodeRefsTool implements AgentTool<typeof codeRefsSchema> {
	readonly name = "code_refs";
	readonly label = "Code References";
	readonly description = "Find symbol references from Nexus repository knowledge.";
	readonly parameters = codeRefsSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Find Nexus-indexed code references";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): CodeRefsTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new CodeRefsTool(session);
	}

	async execute(_id: string, params: CodeRefsParams): Promise<AgentToolResult> {
		const cwd = resolveAgentCwd(this.session);
		const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
		const store = new NexusKnowledgeStore({ agentDir: this.session.settings.getAgentDir(), cwd });
		try {
			const references = store.codeReferences({ name: params.symbol, repoRoot, path: params.path, limit: params.limit });
			return {
				content: [{ type: "text", text: renderCodeReferences(params.symbol, references) }],
				details: { count: references.length, symbol: params.symbol, path: params.path, references },
			};
		} finally {
			store.close();
		}
	}
}

function renderCodeReferences(symbol: string, references: NexusKnowledgeReference[]): string {
	if (references.length === 0) return `No Nexus code references found for ${symbol}.`;
	const lines = [`Nexus code references for ${symbol}:`, ""];
	for (const reference of references) {
		const label = reference.definition
			? `${reference.definition.parentSymbol ? `${reference.definition.parentSymbol}.` : ""}${reference.definition.name}`
			: "unresolved";
		lines.push(
			`- ${reference.path}:${reference.line}:${reference.column} [${reference.kind}; chunk ${reference.chunkIndex} ${reference.chunkStartLine}-${reference.chunkEndLine}; target=${label}] ${truncate(oneLine(reference.snippet), 240)}`,
		);
	}
	return lines.join("\n");
}
