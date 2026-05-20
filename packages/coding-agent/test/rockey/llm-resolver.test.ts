import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { resolveRockeyModel } from "../../src/rockey/llm-resolver";

const modelRegistry = {
	getAll: () => [
		{ provider: "openai", id: "gpt-4.1-mini", contextWindow: 128_000 },
		{ provider: "anthropic", id: "claude-haiku-4.5", contextWindow: 200_000 },
	],
} as never;

describe("resolveRockeyModel", () => {
	it("prefers an explicit purpose model", () => {
		const settings = Settings.isolated({
			"rockey.llm.curation.model": "openai/gpt-4.1-mini",
			"rockey.llm.curation.modelRole": "memory",
		});
		settings.setModelRole("memory", "anthropic/claude-haiku-4.5");
		const resolved = resolveRockeyModel({ purpose: "curation", settings, modelRegistry });
		expect(resolved.model?.provider).toBe("openai");
		expect(resolved.source).toBe("explicit-model");
	});

	it("falls back through memory role and fallback role when exact settings are absent", () => {
		const settings = Settings.isolated({});
		settings.setModelRole("memory", "anthropic/claude-haiku-4.5");
		const resolved = resolveRockeyModel({ purpose: "scoring", settings, modelRegistry });
		expect(resolved.model?.provider).toBe("anthropic");
		expect(resolved.source).toBe("memory-role");
	});
});
