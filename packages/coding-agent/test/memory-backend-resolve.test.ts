import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@amaze/coding-agent/config/settings";
import { resolveMemoryBackend } from "@amaze/coding-agent/memory-backend";

describe("resolveMemoryBackend", () => {
	beforeEach(() => {
		resetSettingsForTest();
	});

	afterEach(() => {
		resetSettingsForTest();
	});

	it("returns the configured backend regardless of legacy memories.enabled", () => {
		const hindsight = Settings.isolated({ "memory.backend": "hindsight", "memories.enabled": false });
		const nexus = Settings.isolated({ "memory.backend": "nexus", "memories.enabled": true });
		expect(resolveMemoryBackend(hindsight).id).toBe("hindsight");
		expect(resolveMemoryBackend(nexus).id).toBe("nexus");
	});
});
