import { describe, expect, it } from "vitest";
import { getAmazeUserAgent } from "../src/utils/amaze-user-agent.ts";

describe("getAmazeUserAgent", () => {
	it("formats the user agent with the runtime app name", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getAmazeUserAgent("1.2.3");

		expect(userAgent).toBe(`amaze/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^amaze\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
