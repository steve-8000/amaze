import type { AgentTool, AgentToolResult } from "@steve-z8k/pi-agent-core";
import { type } from "arktype";
import type { ToolSession } from ".";
import { callSkillTool, stripSkillBodiesFromSearchResult } from "./skill-backend";

const skillSearchSchema = type({
	query: type("string").describe("natural-language or keyword skill search query"),
	"limit?": type("number").describe("maximum number of skills to return"),
});

const skillGetSchema = type({
	name: type("string").describe("skill name to fetch"),
});

export type SkillSearchParams = typeof skillSearchSchema.infer;
export type SkillGetParams = typeof skillGetSchema.infer;

function asJsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export class SkillSearchTool implements AgentTool<typeof skillSearchSchema> {
	readonly name = "skill_search";
	readonly approval = "read" as const;
	readonly label = "Circle Skill Search";
	readonly description =
		"Search the Circle skills registry for applicable skills. Returns lightweight name/summary/tags/score results; use `skill_get` for the full body.";
	readonly parameters = skillSearchSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Search Circle skills";

	constructor(readonly session: ToolSession) {}

	async execute(_id: string, params: SkillSearchParams, signal?: AbortSignal): Promise<AgentToolResult> {
		const rawResult = await callSkillTool(
			this.session,
			"skill_search",
			{ query: params.query, ...(params.limit !== undefined ? { limit: params.limit } : {}) },
			signal,
		);
		const result = stripSkillBodiesFromSearchResult(rawResult);
		return {
			content: [{ type: "text", text: asJsonText(result) }],
			details: result,
		};
	}
}

export class SkillGetTool implements AgentTool<typeof skillGetSchema> {
	readonly name = "skill_get";
	readonly approval = "read" as const;
	readonly label = "Circle Skill Get";
	readonly description = "Fetch the full body of a named Circle skill returned by `skill_search`.";
	readonly parameters = skillGetSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Fetch a Circle skill";

	constructor(readonly session: ToolSession) {}

	async execute(_id: string, params: SkillGetParams, signal?: AbortSignal): Promise<AgentToolResult> {
		const result = await callSkillTool(this.session, "skill_get", { name: params.name }, signal);
		return {
			content: [{ type: "text", text: asJsonText(result) }],
			details: result,
		};
	}
}
