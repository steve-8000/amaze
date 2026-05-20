import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@amaze/agent-core";
import { Settings } from "../../src/config/settings";
import { resolveAgentThinkingLevelOverride } from "../../src/task";

describe("resolveAgentThinkingLevelOverride", () => {
	it("uses the configured per-agent thinking override when valid", () => {
		const settings = Settings.isolated({
			"task.agentThinkingOverrides": {
				explore: "low",
			},
		});

		expect(resolveAgentThinkingLevelOverride("explore", settings, ThinkingLevel.Medium)).toBe(ThinkingLevel.Low);
	});

	it("falls back to the agent default when the override is missing or invalid", () => {
		const settings = Settings.isolated({
			"task.agentThinkingOverrides": {
				explore: "not-a-level",
			},
		});

		expect(resolveAgentThinkingLevelOverride("explore", settings, ThinkingLevel.Medium)).toBe(ThinkingLevel.Medium);
		expect(resolveAgentThinkingLevelOverride("reviewer", settings, ThinkingLevel.High)).toBe(ThinkingLevel.High);
	});
});

describe("local subagent override config", () => {
	it("parses the curated local task agent model and thinking overrides", async () => {
		const settings = await Settings.init({ cwd: process.cwd(), agentDir: `${process.env.HOME}/.amaze/agent` });
		const modelOverrides = settings.get("task.agentModelOverrides");
		const thinkingOverrides = settings.get("task.agentThinkingOverrides");

		expect(modelOverrides.explore).toBe("openai/gpt-5.4");
		expect(modelOverrides.oracle).toBe("openai/gpt-5.5");
		expect(modelOverrides.researcher).toBe("xai/grok-4-fast-non-reasoning");
		expect(resolveAgentThinkingLevelOverride("explore", settings, ThinkingLevel.Medium)).toBe(ThinkingLevel.Low);
		expect(resolveAgentThinkingLevelOverride("oracle", settings, ThinkingLevel.High)).toBe(ThinkingLevel.XHigh);
		expect(thinkingOverrides.quick_task).toBe("minimal");
	});
});
