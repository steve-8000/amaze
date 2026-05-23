import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import searchDescription from "../prompts/tools/rockey-memory-search.md" with { type: "text" };
import { resolveMemoryBackend } from "../memory-backend";
import { NexusStore } from "../nexus/store";
import type { NexusMemoryEntry } from "../nexus/types";
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
	goal: z.string().optional().describe("optional active goal/task text used to re-rank recall toward currently relevant memories"),
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
	readonly summary = "Search durable Rockey-compatible memory";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): RockeyMemorySearchTool | null {
		const backend = session.settings.get("memory.backend");
		if (backend !== "rockey" && backend !== "nexus") return null;
		return new RockeyMemorySearchTool(session);
	}

	async execute(_id: string, params: RockeyMemorySearchParams): Promise<AgentToolResult> {
		const store = this.#createStore();
		try {
			const scopeMode = params.scope ?? "current_project";
			const limit = params.limit ?? this.#defaultLimit();
			if (store instanceof NexusStore) {
				const entries = store.search({
					query: params.query,
					scope: scopeMode,
					target: params.target,
					category: normalizeRockeyCategory(params.category),
					goal: params.goal,
					limit,
				});
				if (entries.length > 0) {
					store.recordUsage(entries.map(entry => entry.id), this.session.getSessionId?.() ?? undefined, undefined, "memory_search");
				}
				const rendered = renderNexusSearchResults(entries, this.#searchEntryMaxChars(), this.#searchResultMaxChars());
				return {
					content: [{ type: "text", text: rendered.text }],
					details: { count: entries.length, truncated: rendered.truncated, entries },
				};
			}
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
				limit,
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

	#createStore(): RockeyStore | NexusStore {
		const cwd = resolveRockeyToolCwd(this.session);
		if (resolveMemoryBackend(this.session.settings).id === "nexus") {
			return new NexusStore({ agentDir: this.session.settings.getAgentDir(), cwd });
		}
		return new RockeyStore({ agentDir: this.session.settings.getAgentDir(), cwd });
	}

	#defaultLimit(): number {
		return resolveMemoryBackend(this.session.settings).id === "nexus"
			? (this.session.settings.get("nexus.searchResultMaxEntries") ?? 5)
			: (this.session.settings.get("rockey.searchResultMaxEntries") ?? 5);
	}

	#searchEntryMaxChars(): number {
		return this.session.settings.get("nexus.searchEntryMaxChars") ?? 480;
	}

	#searchResultMaxChars(): number {
		return this.session.settings.get("nexus.searchResultMaxChars") ?? 2400;
	}
}

function renderNexusSearchResults(entries: NexusMemoryEntry[], entryMaxChars: number, maxChars: number): { text: string; truncated: boolean } {
	if (entries.length === 0) {
		return { text: "No Nexus memory results.", truncated: false };
	}
	const lines = ["Nexus memory results:", ""];
	for (const entry of entries) {
		lines.push(`- [${entry.scopeKind}/${entry.confidence}/${entry.staleness}] ${truncate(entry.content, entryMaxChars)}`);
	}
	let text = lines.join("\\n");
	const truncated = text.length > maxChars;
	if (truncated) text = truncate(text, maxChars);
	return { text, truncated };
}

function truncate(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
