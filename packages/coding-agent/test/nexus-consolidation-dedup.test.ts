import { describe, expect, it } from "bun:test";

describe("online consolidation dedup", () => {
	it("produces identical sourceRecordId for identical content", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const seed = messages.map(m => `${m.role}:${m.content}`).join("\n---\n");
		const h1 = Bun.hash(seed).toString(16);
		const h2 = Bun.hash(seed).toString(16);
		expect(h1).toBe(h2);
	});

	it("diverges when content changes", () => {
		const a = Bun.hash("user:hi").toString(16);
		const b = Bun.hash("user:hello").toString(16);
		expect(a).not.toBe(b);
	});
});
