import { describe, expect, it } from "bun:test";
import { escapeFts5Query } from "../../src/nexus/fts-escape";

describe("escapeFts5Query", () => {
	it("quotes plain queries", () => {
		expect(escapeFts5Query("foo")).toBe('"foo"');
	});

	it("does not promote operators unless advanced mode is explicit", () => {
		expect(escapeFts5Query("foo OR bar")).toBe('"foo OR bar"');
		expect(escapeFts5Query("foo OR bar", { advanced: true })).toBe("foo OR bar");
	});

	it("doubles internal quotes", () => {
		expect(escapeFts5Query('a"b')).toBe('"a""b"');
	});
});
