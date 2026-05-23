import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { loadNexusConfig } from "../nexus/config";
import { NexusStore } from "../nexus/store";
import type { ToolSession } from ".";
import { resolveAgentCwd } from "./_agent-cwd";

const nexusMemoryExplainSchema = z.object({
	id: z.string().describe("Nexus memory id to explain"),
});

export type NexusMemoryExplainParams = z.infer<typeof nexusMemoryExplainSchema>;

export class NexusMemoryExplainTool implements AgentTool<typeof nexusMemoryExplainSchema> {
	readonly name = "memory_explain";
	readonly label = "Memory Explain";
	readonly description =
		"Explain why a Nexus memory exists by returning its source, event history, relations, and usage citations.";
	readonly parameters = nexusMemoryExplainSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Explain Nexus memory provenance";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): NexusMemoryExplainTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new NexusMemoryExplainTool(session);
	}

	async execute(_id: string, params: NexusMemoryExplainParams): Promise<AgentToolResult> {
		const config = loadNexusConfig(this.session.settings);
		const store = new NexusStore({
			agentDir: this.session.settings.getAgentDir(),
			cwd: resolveAgentCwd(this.session),
			contradictionThreshold: config.contradictionThreshold,
		});
		try {
			const explanation = store.explainMemory(params.id);
			if (!explanation.entry) {
				return {
					content: [{ type: "text", text: `No Nexus memory found for id ${params.id}.` }],
					details: { found: false, id: params.id },
				};
			}
			return {
				content: [{ type: "text", text: renderExplanation(explanation) }],
				details: { found: true, ...explanation },
			};
		} finally {
			store.close();
		}
	}
}

function renderExplanation(explanation: ReturnType<NexusStore["explainMemory"]>): string {
	const entry = explanation.entry;
	if (!entry) return "No Nexus memory found.";
	const lines = [
		"# Nexus Memory Explanation",
		"",
		`id: ${entry.id}`,
		`scope: ${entry.scopeKind}`,
		`target: ${entry.target}`,
		`confidence: ${entry.confidence}`,
		`staleness: ${entry.staleness}`,
		`status: ${entry.status}`,
		"",
		"## Content",
		entry.content,
		"",
		"## Source",
		`
${JSON.stringify(explanation.source ?? null, null, 2)}`,
		"",
		"## Events",
	];
	if (explanation.events.length === 0) lines.push("- No events.");
	else
		for (const event of explanation.events)
			lines.push(`- ${String(event.event_type ?? "event")} @ ${String(event.created_at ?? "unknown")}`);
	lines.push("", "## Relations");
	if (explanation.relations.length === 0) lines.push("- No relations.");
	else
		for (const relation of explanation.relations)
			lines.push(`- ${String(relation.from_id)} --${String(relation.relation)}--> ${String(relation.to_id)}`);
	lines.push("", "## Usage");
	if (explanation.usage.length === 0) lines.push("- No recorded usage.");
	else
		for (const usage of explanation.usage)
			lines.push(`- ${String(usage.used_at)} thread=${String(usage.thread_id ?? "")}`);
	lines.push("");
	return lines.join("\n");
}
