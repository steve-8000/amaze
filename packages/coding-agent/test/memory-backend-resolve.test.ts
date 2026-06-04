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

	it("returns the no-op backend by default", () => {
		const settings = Settings.isolated({});
		expect(resolveMemoryBackend(settings).id).toBe("off");
	});

	it("returns mem0 when configured", () => {
		const settings = Settings.isolated({ "memory.backend": "mem0" });
		expect(resolveMemoryBackend(settings).id).toBe("mem0");
	});

	it("returns hermes when configured", () => {
		const settings = Settings.isolated({ "memory.backend": "hermes" });
		expect(resolveMemoryBackend(settings).id).toBe("hermes");
	});
});
