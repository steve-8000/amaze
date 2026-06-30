import { describe, expect, it } from "bun:test";
import eagerTaskPrompt from "../src/prompts/system/eager-task.md" with { type: "text" };
import sharedSystemPromptTail from "../src/prompts/system/shared-system-prompt-tail.md" with { type: "text" };
import subagentSystemPrompt from "../src/prompts/system/subagent-system-prompt.md" with { type: "text" };
import systemPromptTemplateBase from "../src/prompts/system/system-prompt.md" with { type: "text" };

const systemPromptTemplate = systemPromptTemplateBase.replace("{{sharedSystemPromptTail}}", sharedSystemPromptTail);

describe("system prompt policy: compact tool contract", () => {
	it("keeps the decision order explicit without duplicating long policy prose", () => {
		expect(systemPromptTemplate).toContain("# Decision Order");
		expect(systemPromptTemplate).toContain(
			"Circle MCP graph/search/snippet/trace/architecture tools when present → LSP → AST → targeted regex/find/read",
		);
		expect(systemPromptTemplate).toContain("Use the tool's native storage");
		expect(systemPromptTemplate).toContain("Do not paste candidate floods");
		expect(systemPromptTemplate).toContain("Verify the behavior that matters");
	});
	it("preserves direct Circle MCP and AST routing invariants", () => {
		expect(systemPromptTemplate).toContain("# Circle MCP");
		expect(systemPromptTemplate).toContain(
			"When Circle MCP tools are available, use them directly for code intelligence before regex or broad reads",
		);
		expect(systemPromptTemplate).toContain("`mcp__circle_graph` for definitions/relationships");
		expect(systemPromptTemplate).toContain("`mcp__circle_search` for graph-enriched text search");
		expect(systemPromptTemplate).toContain("`mcp__circle_snippet` for exact symbol source");
		expect(systemPromptTemplate).toContain("`mcp__circle_trace` for callers/callees/data flow");
		expect(systemPromptTemplate).toContain("`mcp__circle_architecture` for module overviews");
		expect(systemPromptTemplate).toContain(
			"Use `mcp__circle_status` and `mcp__circle_index` as needed when an index is missing or stale",
		);
		expect(systemPromptTemplate).toContain(
			"retry the original Circle MCP lookup once before treating graph lookup as unavailable",
		);

		expect(systemPromptTemplate).toContain("# AST");
		expect(systemPromptTemplate).toContain("Use `{{toolRefs.ast_grep}}` as a syntax-aware outline");
		expect(systemPromptTemplate).toContain("Use `{{toolRefs.ast_edit}}` before line edits");
		expect(systemPromptTemplate).toContain("prefer it over `edit` for code");
	});

	it("keeps the eager-task delegation contract strict and short", () => {
		expect(systemPromptTemplate).toContain("## Delegation Rule");
		expect(systemPromptTemplate).toContain("Delegation is mandatory.");
		expect(systemPromptTemplate).toContain(
			"Validator, node, Kubernetes, or infrastructure: execute it yourself; never delegate it.",
		);
		expect(systemPromptTemplate).toContain("Small/medium coding work: delegate implementation to `flash`");
		expect(systemPromptTemplate).toContain("Medium work MAY split into two `flash` tasks");
		expect(systemPromptTemplate).toContain(
			"Complex/risky coding work: use `flash` for isolated implementation candidate generation; reserve `deep` for audit/review/validation before merge.",
		);
		expect(systemPromptTemplate).toContain('with `agent: "flash"` and `isolated: true`');
		expect(systemPromptTemplate).toContain("Use `deep` as auditor for validation, merge synthesis, final fixes");
		expect(systemPromptTemplate).toContain("delegate to `spark` before using GitHub or web-search tools directly.");
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
			"Use Circle MCP tools directly when available before LSP, AST, regex, or broad reads",
		);
		expect(subagentSystemPrompt).toContain(
			"`mcp__circle_graph`, `mcp__circle_search`, `mcp__circle_snippet`, `mcp__circle_trace`, and `mcp__circle_architecture`",
		);
		expect(subagentSystemPrompt).toContain(
			"Use `mcp__circle_status` and `mcp__circle_index` as needed for missing or stale indexes",
		);
		expect(subagentSystemPrompt).toContain("Use LSP for symbol-aware facts when available");
		expect(subagentSystemPrompt).toContain("use `ast_grep` before broad code reads");
		expect(subagentSystemPrompt).toContain("use `ast_edit` before line edits");
		expect(subagentSystemPrompt).toContain("Delegation is mandatory when your contract asks for it");
		expect(subagentSystemPrompt).toContain("`flash`: implement small/medium coding work");
		expect(subagentSystemPrompt).toContain("`deep`: audit, verify, merge, synthesize, and fix integration issues");
		expect(subagentSystemPrompt).toContain("Auditor agents may edit/merge only when the contract explicitly asks");
		expect(subagentSystemPrompt).not.toContain("# Investigation");
		expect(subagentSystemPrompt).not.toContain("# Delegation Rule");
	});
});

describe("system prompt policy: eager task always", () => {
	it("uses the mandatory delegation rule and the infra-only self-execution exception", () => {
		expect(eagerTaskPrompt).toContain("delegation contract is active.");
		expect(eagerTaskPrompt).toContain("Use Circle MCP tools directly when available");
		expect(eagerTaskPrompt).toContain(
			"`mcp__circle_graph`, `mcp__circle_search`, `mcp__circle_snippet`, `mcp__circle_trace`, `mcp__circle_architecture`",
		);
		expect(eagerTaskPrompt).toContain("Delegation is mandatory.");
		expect(eagerTaskPrompt).toContain(
			"Validator, node, Kubernetes, or infrastructure work: execute it yourself; never delegate it.",
		);
		expect(eagerTaskPrompt).toContain("Small/medium coding work: delegate implementation to `flash`");
		expect(eagerTaskPrompt).toContain(
			"Complex/risky coding work: use `flash` for isolated implementation candidate generation; reserve `deep` for audit/review/validation before merge.",
		);
		expect(eagerTaskPrompt).toContain("Use `deep` as auditor for validation, merge synthesis, final fixes");
		expect(eagerTaskPrompt).toContain("delegate to `spark` before using GitHub or web-search tools directly.");
		expect(eagerTaskPrompt).not.toContain("single-file edit");
		expect(eagerTaskPrompt).not.toContain("direct answer");
	});
});
