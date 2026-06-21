import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/core/extensions/builtin/compaction/prompts.ts";
import {
	createSectionContextCapsule,
	renderSectionContextCapsule,
} from "../src/core/extensions/builtin/compaction/section-context-capsule.ts";

describe("section context capsule", () => {
	it("preserves active todos, evidence, verification, and next action as structured sections", () => {
		const capsule = createSectionContextCapsule({
			intent: "port protocol features into amaze",
			currentGoal: "reach independently reviewed 98+ quality",
			todos: [
				{ id: "1", content: "fix Xenonite memory payload", status: "completed" },
				{ id: "2", content: "add section context compression", status: "in_progress" },
			],
			evidence: [
				{ kind: "file_read", value: "packages/coding-agent/src/core/tools/xenonite.ts" },
				{ kind: "file_changed", value: "packages/coding-agent/src/core/tools/xenonite.ts" },
				{ kind: "command", value: "npm -C packages/coding-agent run build", status: "pass" },
				{ kind: "verification", value: "npm -C packages/coding-agent test", status: "pass" },
				{ kind: "risk", value: "section capsule not yet wired into remote compaction" },
				{ kind: "memory", value: "Steve prioritizes section-context compression over message summaries" },
			],
			nextAction: "wire capsule into compaction prompt restoration",
			explorationNotes: ["line ".repeat(2000)],
		});

		expect(capsule.activeTodos).toEqual([
			{ id: "2", content: "add section context compression", status: "in_progress" },
		]);
		expect(capsule.filesRead).toContain("packages/coding-agent/src/core/tools/xenonite.ts");
		expect(capsule.filesChanged).toContain("packages/coding-agent/src/core/tools/xenonite.ts");
		expect(capsule.verification).toEqual([
			{ kind: "verification", value: "npm -C packages/coding-agent test", status: "pass" },
		]);
		expect(capsule.nextAction).toBe("wire capsule into compaction prompt restoration");
		expect(capsule.explorationSummary).toContain("[compressed]");
	});

	it("renders a restart-safe summary without dropping protected sections", () => {
		const rendered = renderSectionContextCapsule(
			createSectionContextCapsule({
				intent: "debug failing build",
				todos: [{ content: "run tests", status: "pending" }],
				evidence: [{ kind: "verification", value: "npm test failed", status: "fail" }],
				nextAction: "inspect failure log",
			}),
		);

		expect(rendered).toContain("Intent: debug failing build");
		expect(rendered).toContain("run tests");
		expect(rendered).toContain("npm test failed");
		expect(rendered).toContain("Next action: inspect failure log");
	});

	it("requires compaction prompts to preserve section context capsule fields", () => {
		for (const variant of ["default", "update", "branch"] as const) {
			const prompt = buildPrompt({
				variant,
				previousSummary: "Previous summary",
			}).user;

			expect(prompt).toContain("Section Context Capsule");
			expect(prompt).toContain("active todos");
			expect(prompt).toContain("verification evidence");
			expect(prompt).toContain("exact next action");
			expect(prompt).toContain("Do NOT summarize away file paths");
		}

		const turnPrefixPrompt = buildPrompt({
			variant: "turn_prefix",
			previousSummary: "Previous summary",
		}).user;
		expect(turnPrefixPrompt).toContain("Section Context Capsule");
		expect(turnPrefixPrompt).toContain("active todos");
		expect(turnPrefixPrompt).toContain("verification evidence");
		expect(turnPrefixPrompt).toContain("exact next action");
	});
});
