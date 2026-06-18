import { describe, expect, it } from "vitest";
import type { AssistantMessage, ToolResultMessage } from "@steve-8000/amaze-ai";
import { mapMessageForPaseoPiCompat } from "../src/core/paseo-pi-compat.ts";

function assistantToolCall(name: string, args: Record<string, any>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
		api: "openai-responses" as any,
		provider: "openai" as any,
		model: "test",
		usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } } as any,
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function toolResult(toolName: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName,
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 2,
	};
}

describe("paseo pi compatibility mapping", () => {
	it("maps subagent calls to shell-shaped Paseo tool cards", () => {
		const mapped = mapMessageForPaseoPiCompat(assistantToolCall("agent_run", { agent: "reviewer" }));
		const call = mapped.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
		expect(call.name).toBe("bash");
		expect(call.arguments).toMatchObject({ command: "agent_run reviewer", amazeToolName: "agent_run" });
	});

	it("maps code search calls to grep-shaped Paseo search cards", () => {
		const mapped = mapMessageForPaseoPiCompat(assistantToolCall("code_find", { pattern: "function $X($$$)", paths: ["src"] }));
		const call = mapped.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
		expect(call.name).toBe("grep");
		expect(call.arguments).toMatchObject({ pattern: "function $X($$$)", path: "src", amazeToolName: "code_find" });
	});

	it("keeps matched tool result names in sync with mapped tool calls", () => {
		const mapped = mapMessageForPaseoPiCompat(toolResult("web_search"));
		expect(mapped.toolName).toBe("grep");
		expect(mapped.details).toMatchObject({ amazeToolName: "web_search" });
	});

	it("preserves todowrite so Paseo can extract its native todo list UI", () => {
		const mapped = mapMessageForPaseoPiCompat(
			assistantToolCall("todowrite", {
				todos: [{ content: "Check Paseo todo UI", status: "in_progress" }],
			}),
		);
		const call = mapped.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
		expect(call.name).toBe("todowrite");
		expect(call.arguments).toMatchObject({
			todos: [{ content: "Check Paseo todo UI", status: "in_progress" }],
		});
	});
});
