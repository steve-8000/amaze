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

	it("returns the configured canonical backend", () => {
		const off = Settings.isolated({ "memory.backend": "off" });
		const nexus = Settings.isolated({ "memory.backend": "nexus" });
		expect(resolveMemoryBackend(off).id).toBe("off");
		expect(resolveMemoryBackend(nexus).id).toBe("nexus");
	});
});
