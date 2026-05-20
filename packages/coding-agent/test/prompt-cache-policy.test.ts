import { describe, expect, it } from "bun:test";
import { Settings } from "@amaze/coding-agent/config/settings";
import { resolvePromptCachePolicy } from "@amaze/coding-agent/prompt-cache-policy";

describe("prompt cache policy", () => {
	it("keeps orchestrators compact and on provider-default retention", () => {
		const policy = resolvePromptCachePolicy({ settings: Settings.isolated() });

		expect(policy).toEqual({
			role: "orchestrator",
			projectContextMode: "compact",
			cacheRetention: undefined,
		});
	});

	it("keeps subagents full-context and short-retention by default", () => {
		const settings = Settings.isolated({ "prompt.mainContextMode": "compact" });
		const policy = resolvePromptCachePolicy({ settings, taskDepth: 1, parentTaskPrefix: "0-Task" });

		expect(policy).toEqual({
			role: "subagent",
			projectContextMode: "full",
			cacheRetention: "short",
		});
	});

	it("honors explicit retention overrides without changing subagent context policy", () => {
		const settings = Settings.isolated({
			"prompt.mainContextMode": "full",
			"prompt.cache.orchestratorRetention": "none",
			"prompt.cache.subagentRetention": "long",
		});

		expect(resolvePromptCachePolicy({ settings })).toEqual({
			role: "orchestrator",
			projectContextMode: "full",
			cacheRetention: "none",
		});
		expect(resolvePromptCachePolicy({ settings, taskDepth: 1 })).toEqual({
			role: "subagent",
			projectContextMode: "full",
			cacheRetention: "long",
		});
	});
});
