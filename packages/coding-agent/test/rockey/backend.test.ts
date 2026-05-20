import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { resolveMemoryBackend } from "../../src/memory-backend";

describe("rockey memory backend", () => {
	it("is selected by memory.backend without changing existing backend ids", () => {
		expect(resolveMemoryBackend(Settings.isolated({ "memory.backend": "off" })).id).toBe("off");
		expect(resolveMemoryBackend(Settings.isolated({ "memory.backend": "local" })).id).toBe("local");
		expect(resolveMemoryBackend(Settings.isolated({ "memory.backend": "hindsight" })).id).toBe("hindsight");
		expect(resolveMemoryBackend(Settings.isolated({ "memory.backend": "rockey" })).id).toBe("rockey");
	});
});
