import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import description from "../prompts/tools/rockey-session-search.md" with { type: "text" };
import { resolveMemoryBackend } from "../memory-backend";
import { searchRockeySessionAnchors } from "../rockey/session-search";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { ToolSession } from ".";

const rockeySessionSearchSchema = z.object({
	query: z.string().describe("search query"),
	scope: z.enum(["current_project", "all"]).optional(),
	role: z.enum(["user", "assistant", "system"]).optional(),
	since: z.string().optional().describe("ISO date lower bound"),
	limit: z.number().int().min(1).max(20).optional(),
});

export type RockeySessionSearchParams = z.infer<typeof rockeySessionSearchSchema>;

export class RockeySessionSearchTool implements AgentTool<typeof rockeySessionSearchSchema> {
	readonly name = "session_search";
	readonly label = "Session Search";
	readonly description = description;
	readonly parameters = rockeySessionSearchSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Search prior sessions for bounded anchors";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): RockeySessionSearchTool | null {
		const backend = session.settings.get("memory.backend");
		if (backend !== "rockey" && backend !== "nexus") return null;
		return new RockeySessionSearchTool(session);
	}

	async execute(_id: string, params: RockeySessionSearchParams): Promise<AgentToolResult> {
		const result = searchRockeySessionAnchors(
			this.session.settings.getAgentDir(),
			resolveRockeyToolCwd(this.session),
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
