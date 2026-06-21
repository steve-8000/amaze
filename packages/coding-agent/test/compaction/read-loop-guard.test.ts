import { describe, expect, it } from "vitest";

import { ReadLoopGuard } from "../../src/core/extensions/builtin/compaction/read-loop-guard.ts";

describe("ReadLoopGuard", () => {
	it("blocks identical read calls after a successful read", () => {
		const guard = new ReadLoopGuard();
		const input = { path: "src/example.ts", offset: 10, limit: 20 };

		expect(guard.beforeRead(input)).toBeUndefined();
		guard.afterRead(input);

		expect(guard.beforeRead(input)).toContain("Blocked repeated read");
	});

	it("blocks overlapping read ranges for the same file", () => {
		const guard = new ReadLoopGuard();

		guard.afterRead({ path: "./src/example.ts", offset: 10, limit: 20 });

		expect(guard.beforeRead({ path: "src/example.ts", offset: 25, limit: 5 })).toContain(
			"identical or overlapping read already ran",
		);
	});

	it("allows non-overlapping read ranges", () => {
		const guard = new ReadLoopGuard();

		guard.afterRead({ path: "src/example.ts", offset: 10, limit: 20 });

		expect(guard.beforeRead({ path: "src/example.ts", offset: 40, limit: 5 })).toBeUndefined();
	});
});
