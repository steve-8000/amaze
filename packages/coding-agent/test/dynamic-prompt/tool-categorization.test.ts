import { describe, expect, test } from "vitest";
import {
	categorizeTools,
	getFallbackToolsPromptDisplay,
	getToolsPromptDisplay,
} from "../../src/core/dynamic-prompt/tool-categorization.ts";

describe("categorizeTools", () => {
	test("categorizes lsp_ and ast_grep prefixed tools as other", () => {
		const tools = categorizeTools(["lsp_goto_definition", "ast_grep_search"]);

		for (const tool of tools) {
			expect(tool.category).toBe("other");
		}
	});

	test("categorizes grep and glob as search", () => {
		const tools = categorizeTools(["grep", "glob"]);

		expect(tools).toEqual([
			{ name: "grep", category: "search" },
			{ name: "glob", category: "search" },
		]);
	});

	test("categorizes Xenonite project search tools as search", () => {
		const tools = categorizeTools([
			"context_engine",
			"search_query",
			"code_read",
			"index_status",
			"graph_symbol",
			"ctx_search",
		]);

		expect(tools).toEqual([
			{ name: "context_engine", category: "search" },
			{ name: "search_query", category: "search" },
			{ name: "code_read", category: "search" },
			{ name: "index_status", category: "search" },
			{ name: "graph_symbol", category: "search" },
			{ name: "ctx_search", category: "search" },
		]);
	});

	test("categorizes session_ prefixed tools as session", () => {
		const tools = categorizeTools(["session_list", "session_read"]);

		for (const tool of tools) {
			expect(tool.category).toBe("session");
		}
	});

	test("categorizes skill as command", () => {
		const tools = categorizeTools(["skill"]);

		expect(tools[0].category).toBe("command");
	});

	test("categorizes remaining tools as other", () => {
		const tools = categorizeTools(["read", "bash", "edit", "write"]);

		for (const tool of tools) {
			expect(tool.category).toBe("other");
		}
	});

	test("handles mixed tools correctly", () => {
		const tools = categorizeTools(["read", "lsp_diagnostics", "grep", "ast_grep_search", "bash"]);

		expect(tools).toHaveLength(5);
		expect(tools.find((t) => t.name === "lsp_diagnostics")?.category).toBe("other");
		expect(tools.find((t) => t.name === "grep")?.category).toBe("search");
		expect(tools.find((t) => t.name === "ast_grep_search")?.category).toBe("other");
		expect(tools.find((t) => t.name === "read")?.category).toBe("other");
		expect(tools.find((t) => t.name === "bash")?.category).toBe("other");
	});

	test("returns empty array for empty input", () => {
		expect(categorizeTools([])).toEqual([]);
	});
});

describe("getToolsPromptDisplay", () => {
	test("does not display lsp tools", () => {
		const tools = categorizeTools(["lsp_goto_definition", "lsp_find_references"]);
		const display = getToolsPromptDisplay(tools);

		expect(display).toBe("");
	});

	test("does not show low-level literal search tools as primary triggers", () => {
		const tools = categorizeTools(["grep", "glob"]);
		const display = getToolsPromptDisplay(tools);

		expect(display).toBe("");
	});

	test("shows primary repository context tools before agent orchestration", () => {
		const tools = categorizeTools(["grep", "context_engine", "search_query", "index_status", "agent_run"]);
		const display = getToolsPromptDisplay(tools);

		expect(display).toBe("`context_engine`, `agent_run`");
	});

	test("only displays primary trigger tools, not low-level search, lsp, or ast", () => {
		const tools = categorizeTools(["grep", "lsp_diagnostics", "ast_grep_search"]);
		const display = getToolsPromptDisplay(tools);

		expect(display).not.toContain("`grep`");
		expect(display).not.toContain("lsp");
		expect(display).not.toContain("ast");
	});

	test("returns empty string when only other-category tools exist", () => {
		const tools = categorizeTools(["read", "bash", "edit", "write"]);
		const display = getToolsPromptDisplay(tools);

		expect(display).toBe("");
	});

	test("returns empty string for empty input", () => {
		expect(getToolsPromptDisplay([])).toBe("");
	});
});

describe("getFallbackToolsPromptDisplay", () => {
	test("shows low-level repository tools as fallback tools", () => {
		const tools = categorizeTools([
			"grep",
			"glob",
			"search_query",
			"code_read",
			"index_status",
			"graph_symbol",
			"ctx_search",
			"context_engine",
		]);
		const display = getFallbackToolsPromptDisplay(tools);

		expect(display).toBe("`search_query`, `code_read`, `index_status`, `graph_symbol`, `ctx_search`, `grep`, `glob`");
		expect(display).not.toContain("context_engine");
	});

	test("returns empty string when no fallback tools exist", () => {
		const tools = categorizeTools(["context_engine", "agent_run"]);

		expect(getFallbackToolsPromptDisplay(tools)).toBe("");
	});
});
