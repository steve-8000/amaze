import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@steve-z8k/pi-agent-core";
import type { Message } from "@steve-z8k/pi-ai";
import { convertToLlm } from "../../session/messages";
import { auditProviderVisibleMessages } from "../context-audit";

function textContent(messages: Message[]): string {
	const texts: string[] = [];
	for (const message of messages) {
		if (typeof message.content === "string") {
			texts.push(message.content);
			continue;
		}
		for (const part of message.content) {
			if (part.type === "text") {
				texts.push(part.text);
			}
		}
	}
	return texts.join("\n");
}

describe("context audit", () => {
	it("marks hidden custom content as provider-visible without leaking details", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "session-stop-continuation",
				content: "visible hidden continuation",
				display: false,
				details: { secret: "details must stay local" },
				attribution: "agent",
				timestamp: 1,
			},
		];

		const audit = auditProviderVisibleMessages(messages);
		const llmText = textContent(convertToLlm(messages));

		expect(audit.messages).toEqual([
			{
				index: 0,
				role: "custom",
				kind: "custom",
				customType: "session-stop-continuation",
				visibility: "provider",
				owner: "agent",
				reason: "custom message content is converted to LLM context",
				tokenRisk: "low",
				hidden: true,
			},
		]);
		expect(audit.omitted).toEqual([]);
		expect(llmText).toContain("visible hidden continuation");
		expect(llmText).not.toContain("details must stay local");
	});

	it("omits execution messages that are explicitly excluded from context", () => {
		const messages: AgentMessage[] = [
			{
				role: "bashExecution",
				command: "printf hidden",
				output: "excluded shell output",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: 1,
			},
			{
				role: "pythonExecution",
				code: "print('hidden')",
				output: "excluded python output",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: 2,
			},
		];

		const audit = auditProviderVisibleMessages(messages);
		const llmText = textContent(convertToLlm(messages));

		expect(audit.messages).toEqual([]);
		expect(audit.omitted).toEqual([
			{
				index: 0,
				role: "bashExecution",
				kind: "tool_result",
				reason: "excludeFromContext is set",
			},
			{
				index: 1,
				role: "pythonExecution",
				kind: "tool_result",
				reason: "excludeFromContext is set",
			},
		]);
		expect(llmText).not.toContain("excluded shell output");
		expect(llmText).not.toContain("excluded python output");
	});
});
