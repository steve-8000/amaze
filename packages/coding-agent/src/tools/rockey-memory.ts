import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import memoryDescription from "../prompts/tools/rockey-memory.md" with { type: "text" };
import { resolveMemoryBackend } from "../memory-backend";
import { NexusStore } from "../nexus/store";
import { normalizeRockeyCategory } from "../rockey/state";
import { RockeyStore } from "../rockey/store";
import { resolveRockeyToolCwd } from "../rockey/tool-session";
import type { RockeyMemoryTarget } from "../rockey/types";
import type { ToolSession } from ".";

const rockeyMemorySchema = z.object({
	action: z.enum(["add", "replace", "remove"]).describe("memory operation"),
	target: z.enum(["memory", "user", "project", "failure"]).describe("memory target"),
	content: z.string().optional().describe("entry content for add/replace"),
	old_text: z.string().optional().describe("substring identifying an entry for replace/remove"),
	category: z.enum(["failure", "correction", "insight", "preference", "convention", "tool-quirk"]).optional(),
	failure_reason: z.string().optional(),
});

export type RockeyMemoryParams = z.infer<typeof rockeyMemorySchema>;

export class RockeyMemoryTool implements AgentTool<typeof rockeyMemorySchema> {
	readonly name = "memory";
	readonly label = "Memory";
	readonly description = memoryDescription;
	readonly parameters = rockeyMemorySchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly summary = "Save durable facts in Rockey-compatible memory";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): RockeyMemoryTool | null {
		const backend = session.settings.get("memory.backend");
		if (backend !== "rockey" && backend !== "nexus") return null;
		return new RockeyMemoryTool(session);
	}

	async execute(_id: string, params: RockeyMemoryParams): Promise<AgentToolResult> {
		const store = this.#createStore();
		try {
			const target = params.target as RockeyMemoryTarget;
			const result =
				store instanceof NexusStore
					? this.#executeWithNexusStore(store, target, params)
					: this.#executeWithRockeyStore(store, target, params);
			if (result.success) await store.renderArtifacts();
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
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

	#executeWithRockeyStore(store: RockeyStore, target: RockeyMemoryTarget, params: RockeyMemoryParams) {
		switch (params.action) {
			case "add":
				if (!params.content) return { success: false, error: "content is required for add." };
				return store.add({
					target,
					content: params.content,
					category: normalizeRockeyCategory(params.category),
					failureReason: params.failure_reason,
				});
			case "replace":
				if (!params.old_text) return { success: false, error: "old_text is required for replace." };
				if (!params.content) return { success: false, error: "content is required for replace." };
				return store.replace({ target, oldText: params.old_text, content: params.content });
			case "remove":
				if (!params.old_text) return { success: false, error: "old_text is required for remove." };
				return store.remove({ target, oldText: params.old_text });
		}
	}

	#executeWithNexusStore(store: NexusStore, target: RockeyMemoryTarget, params: RockeyMemoryParams) {
		switch (params.action) {
			case "add":
				if (!params.content) return { success: false, error: "content is required for add." };
				return store.add({
					target,
					content: params.content,
					category: normalizeRockeyCategory(params.category),
					failureReason: params.failure_reason,
				});
			case "replace":
				if (!params.old_text) return { success: false, error: "old_text is required for replace." };
				if (!params.content) return { success: false, error: "content is required for replace." };
				return store.replace({ target, oldText: params.old_text, content: params.content });
			case "remove":
				if (!params.old_text) return { success: false, error: "old_text is required for remove." };
				return store.remove({ target, oldText: params.old_text });
		}
	}
}
