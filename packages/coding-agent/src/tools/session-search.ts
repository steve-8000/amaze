import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import description from "../prompts/tools/session-search.md" with { type: "text" };
import { searchNexusSessionAnchors } from "../nexus/session-search";
import type { ToolSession } from ".";
import { resolveAgentCwd } from "./_agent-cwd";

const sessionSearchSchema = z.object({
	query: z.string().describe("search query"),
	scope: z.enum(["current_project", "all"]).optional(),
	role: z.enum(["user", "assistant", "system"]).optional(),
	since: z.string().optional().describe("ISO date lower bound"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type SessionSearchParams = z.infer<typeof sessionSearchSchema>;

export class SessionSearchTool implements AgentTool<typeof sessionSearchSchema> {
	readonly name = "session_search";
	readonly label = "Session Search";
	readonly description = description;
	readonly parameters = sessionSearchSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Search prior sessions for bounded anchors";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): SessionSearchTool | null {
		if (session.settings.get("memory.backend") !== "nexus") return null;
		return new SessionSearchTool(session);
	}

	async execute(_id: string, params: SessionSearchParams): Promise<AgentToolResult> {
		const result = searchNexusSessionAnchors(
			this.session.settings.getAgentDir(),
			resolveAgentCwd(this.session),
			this.session.settings,
			params.query,
			{
				scope: params.scope,
				role: params.role,
				since: params.since,
				limit: params.limit,
			},
		);
		return {
			content: [{ type: "text", text: result.text }],
			details: { count: result.anchors.length, anchors: result.anchors },
		};
	}
}
