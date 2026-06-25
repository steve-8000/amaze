import type { AgentTool, AgentToolResult } from "@amaze/pi-agent-core";
import { type } from "arktype";
import { sanitizeSkillName } from "../autolearn/managed-skills";
import { isNameClaimedByAuthoredSkill } from "../extensibility/skills";
import manageSkillDescription from "../prompts/tools/manage-skill.md" with { type: "text" };
import type { ToolSession } from ".";
import { deleteRockyManagedSkill, writeRockyManagedSkill } from "./rocky-skill-backend";

const manageSkillSchema = type({
	action: "'create' | 'update' | 'delete'",
	name: type("string").describe("kebab-case skill name"),
	"description?": type("string").describe(
		"one-line description of when to use the skill (required for create/update)",
	),
	"body?": type("string").describe("the SKILL.md body in markdown, no frontmatter (required for create/update)"),
}).narrow(
	(p, ctx) =>
		p.action === "delete" ||
		(p.description !== undefined && p.body !== undefined) ||
		// Enforce the action/field contract at validation time rather than only in
		// execute. Kept as a cross-field narrow (not a discriminated union) so the
		// wire schema stays a single root object — strict structured-output mode and
		// the Anthropic tool-schema builder both require that.
		ctx.mustBe('used with both "description" and "body" for "create" and "update"'),
);

export type ManageSkillParams = typeof manageSkillSchema.infer;

/**
 * Direct create/update/delete of Rocky-backed managed skills. Gated behind
 * `autolearn.enabled`; Rocky owns the canonical skill store.
 */
export class ManageSkillTool implements AgentTool<typeof manageSkillSchema> {
	readonly name = "manage_skill";
	readonly approval = "write" as const;
	readonly label = "Manage Skill";
	readonly description = manageSkillDescription;
	readonly parameters = manageSkillSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Create, update, or delete a Rocky-backed managed skill";

	constructor(readonly session: ToolSession) {}

	static createIf(session: ToolSession): ManageSkillTool | null {
		if (!session.settings.get("autolearn.enabled")) return null;
		return new ManageSkillTool(session);
	}

	async execute(_id: string, params: ManageSkillParams): Promise<AgentToolResult> {
		if (params.action === "delete") {
			await deleteRockyManagedSkill(this.session, params.name);
			return {
				content: [{ type: "text", text: `Deleted managed skill "${params.name}" from Rocky.` }],
				details: { action: "delete", name: params.name },
			};
		}

		// Defensive narrowing: the schema refine already rejects create/update
		// without both fields, so this is unreachable for valid input — it only
		// proves the strings are present to `writeManagedSkill`'s typed contract.
		if (!params.description || !params.body) {
			throw new Error(`"${params.action}" requires both "description" and "body".`);
		}
		// Refuse same-name creates while an authored skill is active. Even though
		// Rocky is now the backing store, creating a managed skill under an authored
		// name makes future skill lookup ambiguous and can hide the managed copy
		// from Amaze's first-wins skill discovery.
		if (params.action === "create" && isNameClaimedByAuthoredSkill(sanitizeSkillName(params.name))) {
			return {
				content: [
					{
						type: "text",
						text: `Cannot create managed skill "${params.name}": an authored skill of that name already exists. Choose a different name.`,
					},
				],
				isError: true,
				details: { action: "create", name: params.name, shadowed: true },
			};
		}
		const result = await writeRockyManagedSkill(this.session, {
			action: params.action,
			name: params.name,
			description: params.description,
			body: params.body,
		});
		const verb = params.action === "create" ? "Created" : "Updated";
		const version = result.version ? ` v${result.version}` : "";
		return {
			content: [{ type: "text", text: `${verb} managed skill "${params.name}" in Rocky${version}.` }],
			details: { action: params.action, name: params.name },
		};
	}
}
