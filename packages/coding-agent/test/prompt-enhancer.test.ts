import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@amaze/agent-core";
import type { Api, Model } from "@amaze/ai";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { extractRecentContext, getEnhancerModel } from "../src/utils/prompt-enhancer";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

function assistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

function fakeModel(provider: string, id: string): Model<Api> {
	return { provider, id, name: id } as unknown as Model<Api>;
}

function fakeRegistry(models: Model<Api>[]): ModelRegistry {
	return {
		getAvailable: () => models,
	} as unknown as ModelRegistry;
}

describe("extractRecentContext", () => {
	it("keeps only user/assistant text and labels roles", () => {
		const messages: AgentMessage[] = [
			userMessage("fix the login bug"),
			{ role: "toolResult", content: [{ type: "text", text: "tool noise" }] } as unknown as AgentMessage,
			assistantMessage("found it in auth.ts"),
		];
		const context = extractRecentContext(messages, 2000);
		expect(context).toBe("User: fix the login bug\n\nAssistant: found it in auth.ts");
	});

	it("truncates from the start, keeping the most recent tail", () => {
		const messages = [userMessage("a".repeat(50)), assistantMessage("b".repeat(50))];
		const context = extractRecentContext(messages, 30);
		expect(context.length).toBe(30);
		expect(context.endsWith("b".repeat(30))).toBe(true);
	});

	it("returns empty for non-positive budget", () => {
		expect(extractRecentContext([userMessage("hello")], 0)).toBe("");
	});

	it("skips empty-text messages", () => {
		const context = extractRecentContext([userMessage("   "), assistantMessage("real")], 2000);
		expect(context).toBe("Assistant: real");
	});
});

describe("getEnhancerModel", () => {
	const haiku = fakeModel("anthropic", "claude-haiku-4-5");
	const opus = fakeModel("anthropic", "claude-opus-4-6");

	it("resolves a configured provider/model pattern", () => {
		const settings = Settings.isolated({ "promptEnhancer.model": "anthropic/claude-haiku-4-5" });
		const model = getEnhancerModel(fakeRegistry([opus, haiku]), settings);
		expect(model?.id).toBe("claude-haiku-4-5");
	});

	it("falls back to the current model when nothing is configured or role-resolved", () => {
		const settings = Settings.isolated();
		const model = getEnhancerModel(fakeRegistry([opus]), settings, opus);
		expect(model?.id).toBe("claude-opus-4-6");
	});

	it("falls back when the configured pattern matches nothing", () => {
		const settings = Settings.isolated({ "promptEnhancer.model": "nonexistent/model-x" });
		const model = getEnhancerModel(fakeRegistry([haiku]), settings, haiku);
		expect(model?.id).toBe("claude-haiku-4-5");
	});

	it("returns undefined when no models are available", () => {
		const settings = Settings.isolated();
		expect(getEnhancerModel(fakeRegistry([]), settings)).toBeUndefined();
	});

	it("resolves a role name configured as the enhancer model", () => {
		const settings = Settings.isolated({
			"promptEnhancer.model": "Explore",
			modelRoles: { Explore: "anthropic/claude-haiku-4-5" },
		});
		const model = getEnhancerModel(fakeRegistry([opus, haiku]), settings);
		expect(model?.id).toBe("claude-haiku-4-5");
	});
});
