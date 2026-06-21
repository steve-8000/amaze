import type { AgentMessage } from "@steve-8000/amaze-agent-core";
import { describe, expect, it } from "vitest";
import { optimizeAgentContextMessages } from "../src/core/context-optimizer/index.ts";

function assistantToolCall(id: string, name: string, args: Record<string, unknown> = {}): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function toolResult(id: string, name = "read", text = "x".repeat(2000)): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function errorToolResult(id: string, text = "fatal error\n".repeat(500)): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError: true,
		timestamp: Date.now(),
	};
}

describe("native context optimizer", () => {
	it("is enabled by default and compresses consecutive tool outputs", () => {
		const messages: AgentMessage[] = [
			assistantToolCall("a", "read", { path: "a.ts" }),
			toolResult("a"),
			assistantToolCall("b", "read", { path: "b.ts" }),
			toolResult("b"),
		];

		const result = optimizeAgentContextMessages(messages, { preserveRecentMessages: 0 });

		expect(result.changed).toBe(true);
		expect(result.audit.mode).toBe("optimize");
		expect(result.audit.tokensSaved).toBeGreaterThan(0);
		expect(result.audit.transforms.some((t) => t.phase === "tool-output-compression")).toBe(true);
		expect(result.messages[1]).toMatchObject({ role: "toolResult" });
		if (result.messages[1]?.role !== "toolResult") throw new Error("expected toolResult");
		const text = result.messages[1].content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("[2 read results: a.ts, b.ts");
		expect(text).toContain("do not repeat identical or overlapping read calls");
	});

	it("supports audit mode without mutating messages", () => {
		const messages: AgentMessage[] = [
			assistantToolCall("a", "grep", { pattern: "foo" }),
			toolResult("a", "grep"),
			assistantToolCall("b", "grep", { pattern: "bar" }),
			toolResult("b", "grep"),
		];

		const result = optimizeAgentContextMessages(messages, {
			mode: "audit",
			preserveRecentMessages: 0,
		});

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
		expect(result.audit.mode).toBe("audit");
		expect(result.audit.transforms.some((t) => t.phase === "tool-output-compression")).toBe(true);
	});

	it("compresses large individual non-error tool outputs with a marker and preserved edges", () => {
		const largeText = `${"head".repeat(100)}\n${"middle".repeat(1000)}\n${"tail".repeat(100)}`;
		const messages: AgentMessage[] = [
			toolResult("a", "bash", largeText),
			{ role: "user", content: "next", timestamp: Date.now() },
		];

		const result = optimizeAgentContextMessages(messages, {
			compressToolResultsOverChars: 1000,
			compressedToolResultHeadChars: 40,
			compressedToolResultTailChars: 40,
			preserveRecentMessages: 1,
			preserveRecentToolResults: 8,
		});

		const compressed = result.messages[0];
		expect(result.changed).toBe(true);
		expect(result.audit.transforms.some((t) => t.kind === "compress-large-tool-results")).toBe(true);
		expect(compressed).toMatchObject({ role: "toolResult" });
		if (compressed.role !== "toolResult") throw new Error("expected toolResult");
		const text = compressed.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("[tool output compressed by native context optimizer");
		expect(text).toContain("head");
		expect(text).toContain("tail");
		expect(text.length).toBeLessThan(largeText.length);
	});

	it("preserves large error tool outputs verbatim", () => {
		const error = errorToolResult("a");
		const messages: AgentMessage[] = [error, { role: "user", content: "next", timestamp: Date.now() }];

		const result = optimizeAgentContextMessages(messages, {
			compressToolResultsOverChars: 100,
			preserveRecentMessages: 1,
		});

		expect(result.messages[0]).toBe(error);
		expect(result.audit.transforms.some((t) => t.kind === "preserve-error-tool-results")).toBe(true);
	});

	it("supports explicit off mode", () => {
		const messages: AgentMessage[] = [
			assistantToolCall("a", "read"),
			toolResult("a"),
			assistantToolCall("b", "read"),
			toolResult("b"),
		];

		const result = optimizeAgentContextMessages(messages, { mode: "off", preserveRecentMessages: 0 });

		expect(result.changed).toBe(false);
		expect(result.messages).toBe(messages);
		expect(result.audit.mode).toBe("off");
		expect(result.audit.transforms).toEqual([]);
	});

	it("phase 2 rolling window clears older tool results while preserving the recent tail", () => {
		const messages: AgentMessage[] = [toolResult("a", "bash"), toolResult("b", "bash"), toolResult("c", "bash")];

		const result = optimizeAgentContextMessages(messages, {
			preserveRecentMessages: 0,
			preserveRecentToolResults: 1,
		});

		expect(result.audit.transforms.some((t) => t.phase === "rolling-window")).toBe(true);
		expect(result.messages[0]).toMatchObject({ role: "toolResult" });
		expect(result.messages[1]).toMatchObject({ role: "toolResult" });
		if (result.messages[0]?.role !== "toolResult" || result.messages[1]?.role !== "toolResult") {
			throw new Error("expected toolResult");
		}
		const firstText = result.messages[0].content.find((part) => part.type === "text")?.text ?? "";
		const secondText = result.messages[1].content.find((part) => part.type === "text")?.text ?? "";
		expect(firstText).toContain("result omitted by context compaction");
		expect(firstText).toContain("Do not treat this as missing evidence");
		expect(secondText).toContain("result omitted by context compaction");
		expect(secondText).toContain("Do not treat this as missing evidence");
		expect(result.messages[2]).toBe(messages[2]);
	});

	it("phase 3 cache alignment audits stable prefix without reordering messages", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "stable intro", timestamp: Date.now() },
			assistantToolCall("a", "read"),
			toolResult("a"),
		];

		const result = optimizeAgentContextMessages(messages, { preserveRecentMessages: 0 });

		expect(result.audit.cacheAlignment.reordered).toBe(false);
		expect(result.audit.cacheAlignment.stablePrefixMessages).toBe(1);
		expect(result.audit.cacheAlignment.stablePrefixHash).toMatch(/^[a-f0-9]{16}$/);
		expect(result.audit.cacheAlignment.barrierReason).toBe("tool-call");
		expect(result.audit.transforms.some((t) => t.phase === "cache-alignment")).toBe(true);
	});

	it("uses deterministic cache alignment hashes for identical stable prefixes", () => {
		const left: AgentMessage[] = [
			{ role: "user", content: "stable intro", timestamp: 1 },
			assistantToolCall("a", "read"),
			toolResult("a"),
		];
		const right: AgentMessage[] = [
			{ role: "user", content: "stable intro", timestamp: 999 },
			assistantToolCall("b", "bash"),
			toolResult("b", "bash"),
		];

		const leftResult = optimizeAgentContextMessages(left, { preserveRecentMessages: 0 });
		const rightResult = optimizeAgentContextMessages(right, { preserveRecentMessages: 0 });

		expect(leftResult.audit.cacheAlignment.stablePrefixHash).toBe(rightResult.audit.cacheAlignment.stablePrefixHash);
	});
});
