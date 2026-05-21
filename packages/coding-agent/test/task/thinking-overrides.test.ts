import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@amaze/agent-core";
import { YAML } from "bun";
import { resetSettingsForTest, Settings } from "../../src/config/settings";
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
	it("parses task agent model and thinking overrides from config.yml", async () => {
		const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-thinking-overrides-"));
		try {
			await Bun.write(
				path.join(testDir, "config.yml"),
				YAML.stringify(
					{
						task: {
							agentModelOverrides: {
								explore: "openai/gpt-5.4",
								oracle: "openai/gpt-5.5",
								researcher: "xai/grok-4-fast-non-reasoning",
							},
							agentThinkingOverrides: {
								explore: "low",
								oracle: "xhigh",
								quick_task: "minimal",
							},
						},
					},
					null,
					2,
				),
			);

			resetSettingsForTest();
			const settings = await Settings.init({ cwd: process.cwd(), agentDir: testDir });
			const modelOverrides = settings.get("task.agentModelOverrides");
			const thinkingOverrides = settings.get("task.agentThinkingOverrides");

			expect(modelOverrides.explore).toBe("openai/gpt-5.4");
			expect(modelOverrides.oracle).toBe("openai/gpt-5.5");
			expect(modelOverrides.researcher).toBe("xai/grok-4-fast-non-reasoning");
			expect(resolveAgentThinkingLevelOverride("explore", settings, ThinkingLevel.Medium)).toBe(ThinkingLevel.Low);
			expect(resolveAgentThinkingLevelOverride("oracle", settings, ThinkingLevel.High)).toBe(ThinkingLevel.XHigh);
			expect(thinkingOverrides.quick_task).toBe("minimal");
		} finally {
			resetSettingsForTest();
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});
});
