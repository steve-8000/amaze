import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { resolveMemoryBackend } from "../memory-backend";
import { resolveNexusProjectScope } from "../nexus/scope";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeSearchResult } from "../nexus/knowledge/types";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { ToolSession } from ".";

const repoSearchSchema = z.object({
	query: z.string().describe("natural language or keyword query over Nexus repository knowledge"),
	path_prefix: z.string().optional().describe("optional repository-relative path prefix"),
	limit: z.number().int().min(1).max(20).optional(),
	explain: z.boolean().optional().describe("include compact ranking and provenance diagnostics"),
});

export type RepoSearchParams = z.infer<typeof repoSearchSchema>;

export class RepoSearchTool implements AgentTool<typeof repoSearchSchema> {
	readonly name = "repo_search";
	readonly label = "Repo Search";
	readonly description = "Search Nexus repository knowledge for project files, conventions, symbols, and implementation notes.";
	readonly parameters = repoSearchSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Search Nexus repository knowledge";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): RepoSearchTool | null {
		if (resolveMemoryBackend(session.settings).id !== "nexus") return null;
		return new RepoSearchTool(session);
	}

	async execute(_id: string, params: RepoSearchParams): Promise<AgentToolResult> {
		const result = searchNexusRepositoryKnowledge(this.session, {
			query: params.query,
			pathPrefix: params.path_prefix,
			limit: params.limit,
			explain: params.explain,
		});
		const rendered = renderNexusKnowledgeSearchResults(result.entries, result.entryMaxChars, result.maxChars, result.explain);
		return {
			content: [{ type: "text", text: rendered.text }],
			details: { ...result, truncated: rendered.truncated },
		};
	}
}

export interface NexusKnowledgeSearchOptions {
	query: string;
	pathPrefix?: string;
	limit?: number;
	explain?: boolean;
}

export interface NexusKnowledgeSearchToolResult {
	count: number;
	truncated: boolean;
	entries: NexusKnowledgeSearchResult[];
	entryMaxChars: number;
	maxChars: number;
	explain: boolean;
}

export function searchNexusRepositoryKnowledge(session: ToolSession, options: NexusKnowledgeSearchOptions): NexusKnowledgeSearchToolResult {
	const cwd = resolveRockeyToolCwd(session);
	const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
	const store = new NexusKnowledgeStore({ agentDir: session.settings.getAgentDir(), cwd });
	try {
		const entryMaxChars = session.settings.get("nexus.searchEntryMaxChars") ?? 480;
		const maxChars = session.settings.get("nexus.searchResultMaxChars") ?? 2400;
		const entries = store.search({
			query: options.query,
			repoRoot,
			pathPrefix: options.pathPrefix,
			limit: options.limit ?? (session.settings.get("nexus.searchResultMaxEntries") ?? 5),
		});
		const rendered = renderNexusKnowledgeSearchResults(entries, entryMaxChars, maxChars, Boolean(options.explain));
		return { count: entries.length, truncated: rendered.truncated, entries, entryMaxChars, maxChars, explain: Boolean(options.explain) };
	} finally {
		store.close();
	}
}

export function renderNexusKnowledgeSearchResults(
	entries: NexusKnowledgeSearchResult[],
	entryMaxChars: number,
	maxChars: number,
	explain = false,
): { text: string; truncated: boolean } {
	if (entries.length === 0) return { text: "No Nexus repository knowledge results.", truncated: false };
	const lines = ["Nexus repository knowledge results:", ""];
	for (const entry of entries) {
		const provenance = `${entry.document.path}:${entry.chunk.startLine}-${entry.chunk.endLine}`;
		const diagnostics = explain ? ` [${entry.matchKind}; score=${entry.score.toFixed(3)}; ${entry.diagnostics.join(", ")}]` : "";
		const reserve = explain ? Math.min(entryMaxChars / 3, 96) : 0;
		lines.push(`- ${provenance}${diagnostics} ${truncate(oneLine(entry.chunk.content), Math.max(40, Math.floor(entryMaxChars - reserve)))}`);
	}
	let text = lines.join("\n");
	const truncated = text.length > maxChars;
	if (truncated) text = truncate(text, maxChars);
	return { text, truncated };
}

export function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function truncate(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
