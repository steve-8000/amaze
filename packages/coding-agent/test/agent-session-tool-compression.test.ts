import { describe, expect, it } from "bun:test";
import type { AfterToolCallContext } from "@amaze/agent-core";
import { applyAfterToolCallOverride, mergeAfterToolCallResult } from "../src/tool-compression";

describe("tool compression hook helpers", () => {
	it("merges compression result with a later TTSR override", () => {
		const merged = mergeAfterToolCallResult(
			{ content: [{ type: "text", text: "compressed" }], details: { compression: { applied: true } } },
			{
				content: [
					{ type: "text", text: "reminder" },
					{ type: "text", text: "compressed" },
				],
			},
		);
		expect(merged?.content).toEqual([
			{ type: "text", text: "reminder" },
			{ type: "text", text: "compressed" },
		]);
		expect(merged?.details).toEqual({ compression: { applied: true } });
	});

	it("applies overrides to the working afterToolCall context", () => {
		const ctx = {
			assistantMessage: { role: "assistant", content: [], timestamp: Date.now() },
			toolCall: { type: "toolCall", id: "tool-1", name: "bash", arguments: {} },
			args: {},
			result: { content: [{ type: "text", text: "original" }], details: { meta: { ok: true } }, isError: false },
			isError: false,
			context: {},
		} as unknown as AfterToolCallContext;
		const next = applyAfterToolCallOverride(ctx, {
			content: [{ type: "text", text: "compressed" }],
			details: { compression: { applied: true } },
		});
		expect(next.result.content).toEqual([{ type: "text", text: "compressed" }]);
		expect(next.result.details).toEqual({ compression: { applied: true } });
	});
});
