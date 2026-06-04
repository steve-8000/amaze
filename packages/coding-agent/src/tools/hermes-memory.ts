import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import { prompt } from "@amaze/utils";
import * as z from "zod/v4";
import {
	createHermesMemoryConfig,
	type HermesMemoryEntry,
	HermesMemoryRuntime,
	type MemoryCategory,
	type MemoryResult,
	type MemoryTarget,
} from "../memory-backend/hermes";
import type { ToolSession } from "./index";

const memoryTargetSchema = z.enum(["memory", "user", "failure"]);
const memoryCategorySchema = z.enum(["failure", "correction", "insight", "preference", "convention", "tool-quirk"]);

const memorySchema = z.object({
	action: z.enum(["add", "replace", "remove"]).describe("Operation to perform"),
	target: memoryTargetSchema.describe("Memory target to mutate"),
	content: z.string().optional().describe("Content to add, or replacement content for replace"),
	old_text: z.string().optional().describe("Existing text to replace or remove"),
	category: memoryCategorySchema.optional().describe("Required when adding a failure memory"),
	failure_reason: z.string().optional().describe("Why the failure happened, for failure memories"),
});

const memorySearchSchema = z.object({
	query: z.string().describe("What to search for in durable Hermes memory"),
	target: memoryTargetSchema.optional().describe("Optional memory target filter"),
	category: memoryCategorySchema.optional().describe("Optional failure category filter"),
	limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10"),
});

type HermesMemoryDetails = {
	backend: "hermes";
	action: "add" | "replace" | "remove" | "search";
	success?: boolean;
	target?: MemoryTarget;
	count?: number;
	result?: MemoryResult;
	results?: HermesMemoryEntry[];
};

function createRuntime(session: ToolSession): HermesMemoryRuntime {
	return new HermesMemoryRuntime(
		createHermesMemoryConfig({
			settings: session.settings,
			agentDir: session.settings.getAgentDir(),
			cwd: session.cwd,
		}),
	);
}

async function withRuntime<T>(session: ToolSession, fn: (runtime: HermesMemoryRuntime) => Promise<T> | T): Promise<T> {
	const runtime = createRuntime(session);
	try {
		await runtime.load();
		return await fn(runtime);
	} finally {
		runtime.close();
	}
}

function renderMemoryResult(result: MemoryResult): string {
	if (!result.success) return result.error ?? "Hermes memory operation failed.";
	const extras: string[] = [];
	if (typeof result.entry_count === "number") extras.push(`${result.entry_count} entries`);
	if (typeof result.evicted_count === "number" && result.evicted_count > 0)
		extras.push(`${result.evicted_count} evicted`);
	return [result.message ?? "Hermes memory updated.", extras.join(", ")].filter(Boolean).join(" ");
}

function renderEntry(entry: HermesMemoryEntry): string {
	const tags = [entry.target, entry.category, entry.project].filter(Boolean).join("/");
	return `- ${tags ? `[${tags}] ` : ""}${entry.content}`;
}

function missing(field: string): never {
	throw new Error(`${field} is required.`);
}

export class HermesMemoryTool implements AgentTool<typeof memorySchema, HermesMemoryDetails> {
	readonly name = "memory";
	readonly label = "Memory";
	readonly summary = "Add, replace, or remove local Hermes memories";
	readonly loadMode = "discoverable";
	readonly parameters = memorySchema;
	readonly strict = true;
	readonly description = prompt.render(
		"Store or update durable local Hermes memory. Actions: add, replace, remove. Targets: memory, user, failure. Failure adds require category and may include failure_reason.",
	);

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): HermesMemoryTool | null {
		return session.settings.get("memory.backend") === "hermes" ? new HermesMemoryTool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: z.infer<typeof memorySchema>,
	): Promise<AgentToolResult<HermesMemoryDetails>> {
		const result = await withRuntime(this.session, async runtime => {
			switch (params.action) {
				case "add": {
					const content = params.content ?? missing("content");
					if (params.target === "failure") {
						const category = params.category ?? missing("category");
						return runtime.addFailure(content, {
							category: category as MemoryCategory,
							failureReason: params.failure_reason,
						});
					}
					return runtime.add(params.target, content);
				}
				case "replace":
					return runtime.replace(
						params.target,
						params.old_text ?? missing("old_text"),
						params.content ?? missing("content"),
					);
				case "remove":
					return runtime.remove(params.target, params.old_text ?? missing("old_text"));
			}
		});
		return {
			content: [{ type: "text", text: renderMemoryResult(result) }],
			details: {
				backend: "hermes",
				action: params.action,
				target: params.target,
				success: result.success,
				count: result.entry_count,
				result,
			},
		};
	}
}

export class HermesMemorySearchTool implements AgentTool<typeof memorySearchSchema, HermesMemoryDetails> {
	readonly name = "memory_search";
	readonly label = "MemorySearch";
	readonly summary = "Search local Hermes memories";
	readonly loadMode = "discoverable";
	readonly parameters = memorySearchSchema;
	readonly strict = true;
	readonly description = prompt.render(
		"Search durable local Hermes memory. Use when prior user preferences, project conventions, decisions, failures, corrections, insights, or tool quirks may matter.",
	);

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): HermesMemorySearchTool | null {
		return session.settings.get("memory.backend") === "hermes" ? new HermesMemorySearchTool(session) : null;
	}

	execute(
		_toolCallId: string,
		params: z.infer<typeof memorySearchSchema>,
	): Promise<AgentToolResult<HermesMemoryDetails>> {
		return withRuntime(this.session, runtime => {
			const results = runtime.search(params.query, {
				target: params.target,
				category: params.category,
				limit: params.limit,
			});
			return {
				content: [
					{
						type: "text",
						text: results.length ? results.map(renderEntry).join("\n") : "No matching Hermes memories found.",
					},
				],
				details: { backend: "hermes", action: "search", count: results.length, results },
			};
		});
	}
}
