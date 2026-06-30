import { describe, expect, it } from "bun:test";
import { parseArgs } from "@steve-z8k/pi-coding-agent/cli/args";

describe("parseArgs — removed --advisor flag", () => {
	it("parses --advisor as a boolean flag", () => {
		const result = parseArgs(["--advisor"]);
		expect(result.unknownFlags.has("advisor")).toBe(false);
	});

	it("defaults advisor to undefined when flag is not provided", () => {
		const result = parseArgs([]);
		expect(result.unknownFlags.has("advisor")).toBe(false);
	});

	it("parses --advisor with other flags", () => {
		const result = parseArgs(["--advisor", "--model", "opus", "hello"]);
		expect(result.unknownFlags.has("advisor")).toBe(false);
		expect(result.model).toBe("opus");
		expect(result.messages).toContain("hello");
	});

	it("parses --advisor in any position", () => {
		const result1 = parseArgs(["--advisor", "prompt"]);
		const result2 = parseArgs(["prompt", "--advisor"]);
		const result3 = parseArgs(["--model", "opus", "--advisor", "prompt"]);

		expect(result1.unknownFlags.has("advisor")).toBe(false);
		expect(result2.unknownFlags.has("advisor")).toBe(false);
		expect(result3.unknownFlags.has("advisor")).toBe(false);
	});

	it("does not consume a value after --advisor", () => {
		const result = parseArgs(["--advisor", "--model", "opus"]);
		expect(result.unknownFlags.has("advisor")).toBe(false);
		expect(result.model).toBe("opus");
		expect(result.messages).toEqual([]);
	});
});
