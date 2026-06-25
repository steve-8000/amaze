import type { AgentMessage } from "@amaze/pi-agent-core";

export type ContextVisibility = "provider" | "ui" | "storage";

export type ContextSourceKind =
	| "system"
	| "user"
	| "tool_result"
	| "file_mention"
	| "extension"
	| "memory"
	| "mcp"
	| "irc"
	| "todo"
	| "task"
	| "compaction"
	| "retry"
	| "ttsr"
	| "autolearn"
	| "goal"
	| "plan"
	| "assistant"
	| "custom";

export type ContextTokenRisk = "low" | "medium" | "high";

export interface ProviderVisibleMessageAuditEntry {
	index: number;
	role: AgentMessage["role"];
	kind: ContextSourceKind;
	customType?: string;
	visibility: "provider";
	owner: string;
	reason: string;
	tokenRisk: ContextTokenRisk;
	hidden?: boolean;
}

export interface OmittedMessageAuditEntry {
	index: number;
	role: AgentMessage["role"];
	kind: ContextSourceKind;
	customType?: string;
	reason: string;
}

export interface ContextAudit {
	messages: ProviderVisibleMessageAuditEntry[];
	omitted: OmittedMessageAuditEntry[];
}

function tokenRiskForLength(length: number): ContextTokenRisk {
	if (length > 16_000) return "high";
	if (length > 4_000) return "medium";
	return "low";
}

function contentTextLength(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let length = 0;
	for (const part of content) {
		if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
			const text = part.text;
			if (typeof text === "string") length += text.length;
		}
	}
	return length;
}

function kindForCustomType(customType: string | undefined): ContextSourceKind {
	if (!customType) return "custom";
	if (customType.startsWith("irc:")) return "irc";
	if (customType.startsWith("todo") || customType === "eager-todo-prelude") return "todo";
	if (customType === "eager-task-prelude" || customType.startsWith("task")) return "task";
	if (customType.startsWith("ttsr")) return "ttsr";
	if (customType.startsWith("autolearn")) return "autolearn";
	if (customType.startsWith("goal-")) return "goal";
	if (customType.startsWith("plan-")) return "plan";
	if (customType.includes("compaction")) return "compaction";
	if (customType.includes("retry")) return "retry";
	return "custom";
}

function ownerFor(message: AgentMessage): string {
	if ("attribution" in message && typeof message.attribution === "string") {
		return message.attribution;
	}
	return message.role === "assistant" ? "assistant" : "agent";
}

function visibleEntry(
	message: AgentMessage,
	index: number,
	kind: ContextSourceKind,
	reason: string,
	tokenRisk: ContextTokenRisk,
	customType?: string,
	hidden?: boolean,
): ProviderVisibleMessageAuditEntry {
	return {
		index,
		role: message.role,
		kind,
		...(customType ? { customType } : {}),
		visibility: "provider",
		owner: ownerFor(message),
		reason,
		tokenRisk,
		...(hidden ? { hidden } : {}),
	};
}

function omittedEntry(
	message: AgentMessage,
	index: number,
	kind: ContextSourceKind,
	reason: string,
	customType?: string,
): OmittedMessageAuditEntry {
	return {
		index,
		role: message.role,
		kind,
		...(customType ? { customType } : {}),
		reason,
	};
}

export function auditProviderVisibleMessages(messages: AgentMessage[]): ContextAudit {
	const audit: ContextAudit = { messages: [], omitted: [] };
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		switch (message.role) {
			case "bashExecution":
				if (message.excludeFromContext) {
					audit.omitted.push(omittedEntry(message, index, "tool_result", "excludeFromContext is set"));
					break;
				}
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"tool_result",
						"bash execution output is converted to LLM context",
						tokenRiskForLength(message.command.length + message.output.length),
					),
				);
				break;
			case "pythonExecution":
				if (message.excludeFromContext) {
					audit.omitted.push(omittedEntry(message, index, "tool_result", "excludeFromContext is set"));
					break;
				}
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"tool_result",
						"python execution output is converted to LLM context",
						tokenRiskForLength(message.code.length + message.output.length),
					),
				);
				break;
			case "fileMention": {
				const length = message.files.reduce((sum, file) => sum + file.path.length + file.content.length, 0);
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"file_mention",
						"file mention content is converted to developer LLM context",
						tokenRiskForLength(length),
					),
				);
				break;
			}
			case "custom": {
				const kind = kindForCustomType(message.customType);
				audit.messages.push(
					visibleEntry(
						message,
						index,
						kind,
						"custom message content is converted to LLM context",
						tokenRiskForLength(contentTextLength(message.content)),
						message.customType,
						message.display === false,
					),
				);
				break;
			}
			case "hookMessage": {
				const kind = kindForCustomType(message.customType);
				audit.messages.push(
					visibleEntry(
						message,
						index,
						kind,
						"hook message content is converted to LLM context",
						tokenRiskForLength(contentTextLength(message.content)),
						message.customType,
						message.display === false,
					),
				);
				break;
			}
			case "branchSummary":
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"compaction",
						"branch summary is converted to LLM context",
						tokenRiskForLength(message.summary.length),
					),
				);
				break;
			case "compactionSummary":
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"compaction",
						"compaction summary is converted to LLM context",
						tokenRiskForLength(message.summary.length),
					),
				);
				break;
			case "user":
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"user",
						"user message content is converted to LLM context",
						tokenRiskForLength(contentTextLength(message.content)),
					),
				);
				break;
			case "developer":
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"system",
						"developer message content is converted to LLM context",
						tokenRiskForLength(contentTextLength(message.content)),
					),
				);
				break;
			case "assistant":
				audit.messages.push(
					visibleEntry(message, index, "assistant", "assistant history is converted to LLM context", "medium"),
				);
				break;
			case "toolResult":
				audit.messages.push(
					visibleEntry(
						message,
						index,
						"tool_result",
						"tool result content is converted to LLM context",
						tokenRiskForLength(contentTextLength(message.content)),
					),
				);
				break;
			default:
				message satisfies never;
		}
	}
	return audit;
}
