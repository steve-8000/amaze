import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@amaze/pi-coding-agent/internal-urls";

describe("AmazeProtocolHandler", () => {
	it("treats amaze://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("amaze://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("tools/read.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("amaze://tools/read.md");
		const prefixed = await router.resolve("amaze://docs/tools/read.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# read");
	});
});
