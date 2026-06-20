export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";
export {
	autoPrepareXenoniteCore,
	createXenoniteToolDefinitions,
	isXenoniteCoreEnabled,
	type RecalledMemory,
	type RecalledMemoryItem,
	recallMemoryForTurn,
	storeMemoryFact,
	type XenoniteToolName,
	xenoniteToolNames,
} from "./xenonite.ts";

import type { AgentTool, AgentToolResult } from "@steve-8000/amaze-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";
import { createXenoniteToolDefinitions, isXenoniteCoreEnabled, type XenoniteToolName } from "./xenonite.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "raw_read" | "bash" | "edit" | "write" | "grep" | "find" | "ls" | XenoniteToolName;
export const allToolNames: Set<ToolName> = new Set(["raw_read", "bash", "edit", "write", "grep", "find", "ls"]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	includeLegacyLocalSearchTools?: boolean;
	includeRawReadTool?: boolean;
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<string, ToolDef> {
	const definitions: Record<string, ToolDef> = {
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
	};
	if (options?.includeRawReadTool) {
		definitions.raw_read = createReadToolDefinition(cwd, {
			...options?.read,
			toolName: "raw_read",
			label: "raw_read",
		});
	}
	if (options?.includeLegacyLocalSearchTools) {
		Object.assign(definitions, {
			grep: createGrepToolDefinition(cwd, options?.grep),
			find: createFindToolDefinition(cwd, options?.find),
			ls: createLsToolDefinition(cwd, options?.ls),
		});
	}
	if (isXenoniteCoreEnabled()) {
		Object.assign(definitions, createXenoniteToolDefinitions(cwd));
	}
	return definitions;
}

export interface ApiToolInfo {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	promptGuidelines?: string[];
}

export interface ApiToolExecutionResult {
	ok: boolean;
	content: AgentToolResult<unknown>["content"];
	isError?: boolean;
	details?: unknown;
}

export function listApiTools(cwd: string, options?: ToolsOptions): ApiToolInfo[] {
	return Object.values(createAllToolDefinitions(cwd, options)).map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as Record<string, unknown>,
		promptGuidelines: tool.promptGuidelines,
	}));
}

export function getApiTool(cwd: string, name: string, options?: ToolsOptions): ToolDef | undefined {
	return createAllToolDefinitions(cwd, options)[name as ToolName];
}

export async function executeApiTool(
	cwd: string,
	name: string,
	args: Record<string, unknown>,
	options: ToolsOptions & { signal?: AbortSignal; requestId?: string } = {},
): Promise<ApiToolExecutionResult> {
	const tool = getApiTool(cwd, name, options);
	if (!tool) {
		return {
			ok: false,
			isError: true,
			content: [{ type: "text", text: `Unknown API tool: ${name}` }],
		};
	}
	const result = await tool.execute(options.requestId ?? `api-${name}`, args as never, options.signal, undefined, {
		cwd,
	} as never);
	return {
		ok: result.isError !== true,
		content: result.content,
		isError: result.isError,
		details: result.details,
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, { ...options?.read, toolName: "raw_read", label: "raw_read" }),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, { ...options?.read, toolName: "raw_read", label: "raw_read" }),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}
