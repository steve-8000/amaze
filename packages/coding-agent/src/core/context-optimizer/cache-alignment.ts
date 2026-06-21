import { createHash } from "node:crypto";
import type { AgentMessage } from "@steve-8000/amaze-agent-core";
import type { ImageContent, TextContent, ToolResultMessage } from "@steve-8000/amaze-ai";

export interface CacheAlignmentPlan {
	stablePrefixMessages: number;
	stablePrefixTokens: number;
	stablePrefixHash: string;
	reordered: false;
	barrierReason: "tool-call" | "tool-result" | "none";
}

function approxTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function textFromContent(content: (TextContent | ImageContent)[] | string | undefined): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function stableMessageShape(message: AgentMessage): unknown {
	if (message.role === "user")
		return {
			role: message.role,
			content: textFromContent(message.content as string | (TextContent | ImageContent)[]),
		};
	if (message.role === "toolResult") {
		const toolResult = message as ToolResultMessage;
		return {
			role: message.role,
			toolCallId: toolResult.toolCallId,
			toolName: toolResult.toolName,
			isError: toolResult.isError,
			content: textFromContent(toolResult.content),
		};
	}
	if (message.role === "assistant") {
		return {
			role: message.role,
			content: message.content.map((block) => {
				if (block.type === "text") return { type: block.type, text: block.text };
				if (block.type === "thinking") return { type: block.type, redacted: block.redacted === true };
				if (block.type === "toolCall")
					return { type: block.type, id: block.id, name: block.name, arguments: block.arguments };
				return { type: block.type, subtype: block.subtype };
			}),
		};
	}
	if (message.role === "bashExecution")
		return { role: message.role, command: message.command, output: message.output, exitCode: message.exitCode };
	if (message.role === "custom")
		return { role: message.role, customType: message.customType, content: textFromContent(message.content) };
	if (message.role === "branchSummary")
		return { role: message.role, fromId: message.fromId, summary: message.summary };
	return { role: (message as { role?: string }).role };
}

function messageText(message: AgentMessage): string {
	const shape = stableMessageShape(message);
	return JSON.stringify(shape);
}

function hashMessages(messages: AgentMessage[]): string {
	const hash = createHash("sha256");
	for (const message of messages) {
		hash.update(JSON.stringify(stableMessageShape(message)));
		hash.update("\n");
	}
	return hash.digest("hex").slice(0, 16);
}

export function buildCacheAlignmentPlan(messages: AgentMessage[]): CacheAlignmentPlan {
	let stablePrefixMessages = 0;
	let stablePrefixTokens = 0;
	let barrierReason: CacheAlignmentPlan["barrierReason"] = "none";

	for (const message of messages) {
		if (message.role === "toolResult") {
			barrierReason = "tool-result";
			break;
		}
		if (message.role === "assistant" && message.content.some((block) => block.type === "toolCall")) {
			barrierReason = "tool-call";
			break;
		}
		stablePrefixMessages += 1;
		stablePrefixTokens += approxTokens(messageText(message));
	}

	return {
		stablePrefixMessages,
		stablePrefixTokens,
		stablePrefixHash: hashMessages(messages.slice(0, stablePrefixMessages)),
		reordered: false,
		barrierReason,
	};
}
