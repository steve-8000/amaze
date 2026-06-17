import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { loadAmazeConfig } from "../../../../amaze/config.ts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../../types.ts";
import { XenoniteClient } from "./client.ts";

function messageText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
			.join("");
	}
	return "";
}

function sessionId(ctx: ExtensionContext): string {
	const sm = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
	return sm?.getSessionId?.() ?? "default";
}

function downMessage(action: string): string {
	return `Xenonite service is not reachable. Start it with: cd ~/rocky/xenonite && node src/server.mjs. (${action})`;
}

export default function amazeMemoryExtension(pi: ExtensionAPI): void {
	const config = loadAmazeConfig();
	const memEnabled = config.tools.mem.enabled;
	const skillsEnabled = Boolean((config.raw.skills as { enabled?: unknown } | undefined)?.enabled);
	if (!memEnabled && !skillsEnabled) return;

	const client = new XenoniteClient(config.services.xenonite.port);
	const autoImprove = Boolean((config.raw.skills as { auto_improve?: unknown } | undefined)?.auto_improve);
	let lastUserInput = "";

	if (memEnabled) {
		pi.on("input", async (event) => {
			lastUserInput = event.text;
		});

		pi.on("turn_end", async (event, ctx) => {
			const assistant = messageText(event.message);
			if (!lastUserInput && !assistant) return;
			try {
				await client.syncTurn(lastUserInput, assistant, sessionId(ctx));
				if (autoImprove) {
					await client.backgroundReview([{ role: "user", content: lastUserInput }, { role: "assistant", content: assistant }]);
				}
			} catch {
				// Memory sync and self-review are best-effort; a missing bridge must never break a turn.
			}
		});

		const recall: ToolDefinition = {
			name: "mem_recall",
			label: "mem_recall",
			description: "Recall durable memory relevant to a query from previous sessions.",
			parameters: Type.Object({ query: Type.String({ description: "What to recall." }) }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("mem_recall") }], details: undefined };
				const text = await client.prefetch((params as { query: string }).query, sessionId(ctx));
				return { content: [{ type: "text", text: text || "(no relevant memory)" }], details: undefined };
			},
		};

		const search: ToolDefinition = {
			name: "mem_search",
			label: "mem_search",
			description: "Semantic search over durable memory.",
			parameters: Type.Object({ query: Type.String({ description: "Search query." }) }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("mem_search") }], details: undefined };
				const text = await client.prefetch((params as { query: string }).query, sessionId(ctx));
				return { content: [{ type: "text", text: text || "(no matches)" }], details: undefined };
			},
		};

		pi.registerTool(recall);
		pi.registerTool(search);
	}

	if (skillsEnabled) {
		const skillManage: ToolDefinition = {
			name: "skill_manage",
			label: "skill_manage",
			description: "Create, edit, patch, or delete a reusable skill (procedural knowledge).",
			parameters: Type.Object({
				action: Type.String({ description: "create | edit | patch | delete | write_file" }),
				name: Type.String({ description: "Skill name." }),
				content: Type.Optional(Type.String({ description: "Full SKILL.md content for create/edit." })),
				category: Type.Optional(Type.String({ description: "Skill category." })),
				old_string: Type.Optional(Type.String({ description: "For patch: text to replace." })),
				new_string: Type.Optional(Type.String({ description: "For patch: replacement text." })),
			}),
			async execute(_id, params) {
				if (!(await client.isHealthy())) return { content: [{ type: "text", text: downMessage("skill_manage") }], details: undefined };
				const text = await client.skillManage(params as Record<string, unknown>);
				return { content: [{ type: "text", text }], details: undefined };
			},
		};
		pi.registerTool(skillManage);
	}
}
