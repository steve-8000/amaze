import type { AssistantMessage, Message, ToolResultMessage } from "@steve-8000/amaze-ai";

type ToolCallBlock = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

const PASEO_PI_COMPAT_ENV = "AMAZE_PASEO_PI_COMPAT";

export function isPaseoPiCompatEnabled(): boolean {
	return process.env[PASEO_PI_COMPAT_ENV] === "1" || process.env[PASEO_PI_COMPAT_ENV] === "true";
}

function textFromUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function firstString(value: unknown, keys: string[]): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
	}
	return undefined;
}

function firstPath(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const direct = firstString(record, ["path", "filePath", "file"]);
	if (direct) return direct;
	const paths = record.paths ?? record.filePaths;
	if (Array.isArray(paths)) {
		return paths.find((path): path is string => typeof path === "string" && path.trim().length > 0);
	}
	return undefined;
}

function commandForTool(name: string, args: unknown): string {
	const renderedArgs = textFromUnknown(args);
	if (renderedArgs === undefined || renderedArgs === "undefined") return name;
	return `${name} ${renderedArgs}`;
}

function mapToolCallForPaseo(name: string, args: unknown): { name: string; arguments: Record<string, any> } {
	switch (name) {
		case "agent_run": {
			const agent = firstString(args, ["agent", "action"]) ?? "agent";
			return { name: "bash", arguments: { command: `agent_run ${agent}`, amazeToolName: name, amazeArguments: args } };
		}
		case "mem_recall":
		case "mem_search":
		case "mem_store":
		case "create_goal":
		case "update_goal":
		case "get_goal":
			return { name: "bash", arguments: { command: commandForTool(name, args), amazeToolName: name, amazeArguments: args } };
		case "web_search":
			return {
				name: "grep",
				arguments: { pattern: firstString(args, ["query"]) ?? textFromUnknown(args), amazeToolName: name, amazeArguments: args },
			};
		case "webfetch":
			return {
				name: "grep",
				arguments: { pattern: firstString(args, ["url"]) ?? textFromUnknown(args), amazeToolName: name, amazeArguments: args },
			};
		case "code_find":
			return {
				name: "grep",
				arguments: { pattern: firstString(args, ["pattern"]) ?? textFromUnknown(args), path: firstPath(args), amazeToolName: name, amazeArguments: args },
			};
		case "code_rewrite":
		case "apply_patch":
			return {
				name: "edit",
				arguments: {
					path: firstPath(args) ?? "patch",
					edits: [{ oldText: "", newText: textFromUnknown(args) }],
					amazeToolName: name,
					amazeArguments: args,
				},
			};
		case "lang_check":
		case "lang_jump":
		case "lang_verify":
		case "lang_rename":
			return {
				name: "grep",
				arguments: {
					pattern: firstString(args, ["filePath", "path", "newName"]) ?? name,
					path: firstPath(args),
					amazeToolName: name,
					amazeArguments: args,
				},
			};
		default:
			return { name, arguments: typeof args === "object" && args !== null && !Array.isArray(args) ? args : {} };
	}
}

function mapToolResultNameForPaseo(name: string): string {
	return mapToolCallForPaseo(name, undefined).name;
}

export function mapMessageForPaseoPiCompat<T extends Message>(message: T): T {
	if (message.role === "assistant") {
		const mapped: AssistantMessage = {
			...message,
			content: message.content.map((block) => {
				if (block.type !== "toolCall") return block;
				const mappedTool = mapToolCallForPaseo(block.name, block.arguments);
				if (mappedTool.name === block.name && mappedTool.arguments === block.arguments) return block;
				return {
					...block,
					name: mappedTool.name,
					arguments: mappedTool.arguments,
				} satisfies ToolCallBlock;
			}),
		};
		return mapped as T;
	}
	if (message.role === "toolResult") {
		const mappedName = mapToolResultNameForPaseo(message.toolName);
		if (mappedName === message.toolName) return message;
		const mapped: ToolResultMessage = {
			...message,
			toolName: mappedName,
			details: {
				...(typeof message.details === "object" && message.details !== null ? message.details : {}),
				amazeToolName: message.toolName,
			},
		};
		return mapped as T;
	}
	return message;
}
