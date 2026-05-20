import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import searchDescription from "../prompts/tools/rockey-memory-search.md" with { type: "text" };
import { renderRockeySearchResults } from "../rockey/admission";
import { normalizeRockeyCategory } from "../rockey/state";
import { RockeyStore } from "../rockey/store";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { RockeyStoredTarget } from "../rockey/types";
import type { ToolSession } from ".";

const rockeyMemorySearchSchema = z.object({
	query: z.string().describe("natural language or keyword search query"),
	scope: z
		.enum(["current_project", "global", "all"])
		.optional()
		.describe("search scope; defaults to current_project plus global"),
	target: z.enum(["memory", "user", "failure"]).optional(),
	category: z.enum(["failure", "correction", "insight", "preference", "convention", "tool-quirk"]).optional(),
	limit: z.number().int().min(1).max(20).optional(),
});

export type RockeyMemorySearchParams = z.infer<typeof rockeyMemorySearchSchema>;

export class RockeyMemorySearchTool implements AgentTool<typeof rockeyMemorySearchSchema> {
	readonly name = "memory_search";
	readonly label = "Memory Search";
	readonly description = searchDescription;
	readonly parameters = rockeyMemorySearchSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Search durable Rockey memory";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): RockeyMemorySearchTool | null {
		if (session.settings.get("memory.backend") !== "rockey") return null;
		return new RockeyMemorySearchTool(session);
	}

	async execute(_id: string, params: RockeyMemorySearchParams): Promise<AgentToolResult> {
		const store = new RockeyStore({
			agentDir: this.session.settings.getAgentDir(),
			cwd: resolveRockeyToolCwd(this.session),
		});
		try {
			const scopeMode = params.scope ?? "current_project";
			const entries = store.search({
				query: params.query,
				scope:
					scopeMode === "all"
						? undefined
						: scopeMode === "global"
							? { kind: "global", key: null, displayName: "global", cwd: null }
							: store.scope,
				includeGlobal: scopeMode === "current_project",
				target: params.target as RockeyStoredTarget | undefined,
				category: normalizeRockeyCategory(params.category),
				limit: params.limit ?? this.session.settings.get("rockey.searchResultMaxEntries") ?? 5,
			});
			const rendered = renderRockeySearchResults(entries, this.session.settings);
			return {
				content: [{ type: "text", text: rendered.text }],
				details: { count: entries.length, truncated: rendered.truncated, entries },
			};
		} finally {
			store.close();
		}
	}
}
