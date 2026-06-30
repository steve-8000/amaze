import type { AgentTool, AgentToolResult } from "@steve-z8k/pi-agent-core";
import { type } from "arktype";
import { sanitizeSkillName } from "../autolearn/managed-skills";
import { isNameClaimedByAuthoredSkill } from "../extensibility/skills";
import learnDescription from "../prompts/tools/learn.md" with { type: "text" };
import type { ToolSession } from ".";
import { writeManagedSkill } from "./skill-backend";

const learnSchema = type({
	memory: type("string").describe("the durable, self-contained lesson to capture (what, when, why)"),
	"context?": type("string").describe("optional source context for the lesson"),
	skill: type({
		action: "'create' | 'update'",
		name: type("string").describe("kebab-case skill name"),
		description: type("string").describe("one-line description of when to use the skill"),
		"body?": type("string").describe("optional SKILL.md body in markdown (no frontmatter)"),
	}).describe("create or update a managed skill that captures this lesson"),
});

export type LearnParams = typeof learnSchema.infer;

/**
 * Capture one durable lesson as a managed skill.
 */
export class LearnTool implements AgentTool<typeof learnSchema> {
	readonly name = "capture_lesson";
	readonly approval = "write" as const;
	readonly label = "Capture Lesson";
	readonly description = learnDescription;
	readonly parameters = learnSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Capture a reusable lesson as a managed skill";

	constructor(readonly _session: ToolSession) {}

	static createIf(session: ToolSession): LearnTool | null {
		return session.settings.get("autolearn.enabled") ? new LearnTool(session) : null;
	}

	async execute(_id: string, params: LearnParams): Promise<AgentToolResult> {
		let safeSkillName: string | undefined;
		try {
			safeSkillName = sanitizeSkillName(params.skill.name);
		} catch {
			safeSkillName = undefined;
		}
		if (params.skill.action === "create" && safeSkillName && isNameClaimedByAuthoredSkill(safeSkillName)) {
			return {
				content: [
					{
						type: "text",
						text: `Did not create managed skill "${params.skill.name}": an authored skill of that name already exists. Choose a different name.`,
					},
				],
				isError: true,
				details: { skill: null, shadowed: true },
			};
		}

		const body =
			params.skill.body ??
			["## Lesson", "", params.memory, ...(params.context ? ["", "## Context", "", params.context] : [])].join("\n");
		try {
			await writeManagedSkill(this._session, {
				action: params.skill.action,
				name: params.skill.name,
				description: params.skill.description,
				body,
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Managed skill could not be written: ${reason}`);
		}

		const action = params.skill.action === "create" ? "created" : "updated";
		return {
			content: [
				{ type: "text", text: `Captured lesson as Circle managed skill "${params.skill.name}" (${action}).` },
			],
			details: { skill: params.skill.name },
		};
	}
}
