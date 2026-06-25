import { describe, expect, it } from "bun:test";
import { allowExtensionContextHooks } from "../context-policy";

describe("context policy", () => {
	it("allows extension context hooks for main sessions and denies them for contract subagents by default", () => {
		expect(allowExtensionContextHooks("main")).toBe(true);
		expect(allowExtensionContextHooks("contract")).toBe(false);
	});
});
