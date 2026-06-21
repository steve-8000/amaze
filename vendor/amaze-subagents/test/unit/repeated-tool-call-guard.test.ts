import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	createRepeatedToolCallGuard,
	toolCallSignature,
} from "../../src/runs/shared/repeated-tool-call-guard.ts";

describe("repeated tool-call guard", () => {
	it("detects repeated identical tool calls after the configured limit", () => {
		const guard = createRepeatedToolCallGuard(3);
		const args = { command: "set +e; npm test; code=$?; printf 'EXIT=%s\\n' \"$code\"" };

		assert.equal(guard.record("bash", args, 1), undefined);
		assert.equal(guard.record("bash", args, 2), undefined);
		assert.deepEqual(guard.record("bash", args, 3), {
			signature: toolCallSignature("bash", args),
			toolName: "bash",
			repeatCount: 3,
		});
	});

	it("normalizes object key order so reordered args cannot bypass detection", () => {
		const guard = createRepeatedToolCallGuard(2);

		assert.equal(guard.record("read", { offset: 1, path: "a.ts" }, 1), undefined);
		assert.deepEqual(guard.record("read", { path: "a.ts", offset: 1 }, 2), {
			signature: toolCallSignature("read", { offset: 1, path: "a.ts" }),
			toolName: "read",
			repeatCount: 2,
		});
	});

	it("does not count different arguments as the same call", () => {
		const guard = createRepeatedToolCallGuard(2);

		assert.equal(guard.record("read", { path: "a.ts", offset: 1 }, 1), undefined);
		assert.equal(guard.record("read", { path: "a.ts", offset: 2 }, 2), undefined);
	});
});
