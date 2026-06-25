import { describe, expect, it } from "bun:test";
import eagerTaskPrompt from "../src/prompts/system/eager-task.md" with { type: "text" };
import subagentSystemPrompt from "../src/prompts/system/subagent-system-prompt.md" with { type: "text" };
import systemPromptTemplate from "../src/prompts/system/system-prompt.md" with { type: "text" };

describe("system prompt policy: compact tool contract", () => {
	it("keeps the decision order explicit without duplicating long policy prose", () => {
		expect(systemPromptTemplate).toContain("# Decision Order");
		expect(systemPromptTemplate).toContain("codebase_plan` → graph → LSP → AST → targeted regex/find/read");
		expect(systemPromptTemplate).toContain("Use the tool's native storage");
		expect(systemPromptTemplate).toContain("Do not paste candidate floods");
		expect(systemPromptTemplate).toContain("Verify the behavior that matters");
	});

	it("preserves profile, graph, and AST routing invariants", () => {
		expect(systemPromptTemplate).toContain("# Rocky Codebase Profiles");
		expect(systemPromptTemplate).toContain("start codebase discovery with `{{toolRefs.codebase_plan}}`");
		expect(systemPromptTemplate).toContain("Read selected point ids with `{{toolRefs.codebase_read}}`");
		expect(systemPromptTemplate).toContain("Expand only useful deferred clusters");
		expect(systemPromptTemplate).toContain("Revalidate stale plan points");
		expect(systemPromptTemplate).toContain("Fall back only when profiles are unavailable, stale, or insufficient");

		expect(systemPromptTemplate).toContain("# Codebase Graph");
		expect(systemPromptTemplate).toContain("use graph before regex or broad reads");
		expect(systemPromptTemplate).toContain("project inference/indexing failed");

		expect(systemPromptTemplate).toContain("# AST");
		expect(systemPromptTemplate).toContain("Use `{{toolRefs.ast_grep}}` as a syntax-aware outline");
		expect(systemPromptTemplate).toContain("Use `{{toolRefs.ast_edit}}` before line edits");
		expect(systemPromptTemplate).toContain("prefer it over `edit` for code");
	});

	it("keeps the eager-task delegation contract strict and short", () => {
		expect(systemPromptTemplate).toContain("## Delegation Rule");
		expect(systemPromptTemplate).toContain("Delegation is mandatory.");
		expect(systemPromptTemplate).toContain("Kubernetes/infrastructure: execute it yourself.");
		expect(systemPromptTemplate).toContain("Everything else: delegate via `{{toolRefs.task}}` before execution.");
		expect(systemPromptTemplate).toContain("A non-infra self-execution todo or plan is invalid.");
		expect(systemPromptTemplate).not.toContain("Do not execute an invalid todo list or work plan.");
	});

	it("keeps the delivery contract concise and absolute", () => {
		expect(systemPromptTemplate).toContain("<contract>");
		expect(systemPromptTemplate).toContain("Complete the user's actual ask end to end");
		expect(systemPromptTemplate).toContain("Never fabricate results");
		expect(systemPromptTemplate).toContain("Use tools and repo context before asking");
		expect(systemPromptTemplate).toContain("<verification>");
		expect(systemPromptTemplate).toContain("Re-check only when new evidence");
		expect(systemPromptTemplate).not.toContain("NEVER re-audit an applied edit");
	});
});

describe("subagent system prompt policy", () => {
	it("uses one compact tool contract for spawned workers", () => {
		expect(subagentSystemPrompt).toContain("# Tool Contract");
		expect(subagentSystemPrompt).toContain(
			"Use `codebase_plan` before graph, LSP, AST, regex, or broad reads when available",
		);
		expect(subagentSystemPrompt).toContain("`codebase_read`, `codebase_expand`, and `codebase_validate`");
		expect(subagentSystemPrompt).toContain("use graph before regex/broad reads");
		expect(subagentSystemPrompt).toContain("Use LSP for symbol-aware facts when available");
		expect(subagentSystemPrompt).toContain("use `ast_grep` before broad code reads");
		expect(subagentSystemPrompt).toContain("use `ast_edit` before line edits");
		expect(subagentSystemPrompt).toContain("Delegation is mandatory when your contract asks for it");
		expect(subagentSystemPrompt).not.toContain("# Rocky Codebase Profiles");
		expect(subagentSystemPrompt).not.toContain("# Investigation");
		expect(subagentSystemPrompt).not.toContain("# Delegation Rule");
	});
});

describe("system prompt policy: eager task always", () => {
	it("uses the mandatory delegation rule and the infra-only self-execution exception", () => {
		expect(eagerTaskPrompt).toContain("delegation contract is active.");
		expect(eagerTaskPrompt).toContain("Use Rocky codebase graph tools first");
		expect(eagerTaskPrompt).toContain("`codebase_plan` when available");
		expect(eagerTaskPrompt).toContain("Delegation is mandatory.");
		expect(eagerTaskPrompt).toContain("Kubernetes or infrastructure related: execute it yourself.");
		expect(eagerTaskPrompt).toContain("Everything else: delegate via `{{toolRefs.task}}` before execution.");
		expect(eagerTaskPrompt).not.toContain("single-file edit");
		expect(eagerTaskPrompt).not.toContain("direct answer");
	});
});
