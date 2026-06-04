import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import { prompt } from "@amaze/utils";
import * as z from "zod/v4";
import { mem0Conclude, mem0Profile, mem0Search } from "../memory-backend/mem0-backend";
import type { ToolSession } from "./index";

const profileSchema = z.object({});
const searchSchema = z.object({
	query: z.string().describe("What to search for in durable memory"),
	top_k: z.number().int().min(1).max(50).optional().describe("Max results, default from memory.mem0.topK"),
});
const concludeSchema = z.object({
	conclusion: z.string().describe("Durable fact, preference, or decision to store verbatim"),
});

type MemoryToolDetails = { backend: "mem0"; count?: number; action: "profile" | "search" | "conclude" };

export class Mem0ProfileTool implements AgentTool<typeof profileSchema, MemoryToolDetails> {
	readonly name = "mem0_profile";
	readonly label = "Mem0Profile";
	readonly summary = "Retrieve all stored mem0 memories about the user";
	readonly loadMode = "discoverable";
	readonly parameters = profileSchema;
	readonly strict = true;
	readonly description = prompt.render(
		"Retrieve all stored memories about the user — preferences, facts, and project context. Fast, no reranking. Use at conversation start when the current task needs user/project background.",
	);

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): Mem0ProfileTool | null {
		return session.settings.get("memory.backend") === "mem0" ? new Mem0ProfileTool(session) : null;
	}

	async execute(): Promise<AgentToolResult<MemoryToolDetails>> {
		const memories = await mem0Profile(this.session.settings);
		return {
			content: [
				{
					type: "text",
					text: memories.length ? memories.map(memory => `- ${memory}`).join("\n") : "No mem0 memories found.",
				},
			],
			details: { backend: "mem0", action: "profile", count: memories.length },
		};
	}
}

export class Mem0SearchTool implements AgentTool<typeof searchSchema, MemoryToolDetails> {
	readonly name = "mem0_search";
	readonly label = "Mem0Search";
	readonly summary = "Search mem0 memories by meaning";
	readonly loadMode = "discoverable";
	readonly parameters = searchSchema;
	readonly strict = true;
	readonly description = prompt.render(
		"Search memories by meaning. Returns relevant facts ranked by similarity. Use when durable user/project history may affect the current answer.",
	);

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): Mem0SearchTool | null {
		return session.settings.get("memory.backend") === "mem0" ? new Mem0SearchTool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: z.infer<typeof searchSchema>,
	): Promise<AgentToolResult<MemoryToolDetails>> {
		const memories = await mem0Search(this.session.settings, params.query, params.top_k);
		return {
			content: [
				{
					type: "text",
					text: memories.length
						? memories.map(memory => `- ${memory}`).join("\n")
						: "No matching mem0 memories found.",
				},
			],
			details: { backend: "mem0", action: "search", count: memories.length },
		};
	}
}

export class Mem0ConcludeTool implements AgentTool<typeof concludeSchema, MemoryToolDetails> {
	readonly name = "mem0_conclude";
	readonly label = "Mem0Conclude";
	readonly summary = "Store a durable mem0 fact verbatim";
	readonly loadMode = "discoverable";
	readonly parameters = concludeSchema;
	readonly strict = true;
	readonly description = prompt.render(
		"Store a durable fact about the user. Stored verbatim without LLM extraction. Use for explicit preferences, corrections, decisions, or long-lived project facts.",
	);

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): Mem0ConcludeTool | null {
		return session.settings.get("memory.backend") === "mem0" ? new Mem0ConcludeTool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: z.infer<typeof concludeSchema>,
	): Promise<AgentToolResult<MemoryToolDetails>> {
		await mem0Conclude(this.session.settings, params.conclusion);
		return {
			content: [{ type: "text", text: "Stored in mem0." }],
			details: { backend: "mem0", action: "conclude", count: 1 },
		};
	}
}
