import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { evaluateRockeyDoctor } from "../../src/rockey/doctor";

describe("Rockey doctor", () => {
	it("scores the default bounded Rockey configuration as pass", () => {
		const result = evaluateRockeyDoctor(Settings.isolated({ "memory.backend": "rockey" }));
		expect(result.status).toBe("PASS");
		expect(result.score).toBeGreaterThanOrEqual(9);
	});

	it("degrades when recall and search caps are unsafe", () => {
		const result = evaluateRockeyDoctor(
			Settings.isolated({
				"memory.backend": "rockey",
				"rockey.autoRecall": true,
				"rockey.autoRecallLimit": 20,
				"rockey.autoRecallMaxChars": 12000,
				"rockey.searchResultMaxEntries": 20,
				"rockey.searchResultMaxChars": 16000,
				"rockey.searchEntryMaxChars": 4000,
			}),
		);
		expect(result.status === "DEGRADED" || result.status === "FAIL").toBe(true);
		expect(result.score).toBeLessThan(8);
	});
});
