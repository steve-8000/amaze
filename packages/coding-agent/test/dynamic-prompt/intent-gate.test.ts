import { describe, expect, test } from "vitest";
import { buildIntentGate } from "../../src/core/dynamic-prompt/intent-gate.ts";
import type { AvailableTool } from "../../src/core/dynamic-prompt/types.ts";

describe("buildIntentGate", () => {
	test("includes intent verbalization table", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Intent");
		expect(result).toContain("Surface Form");
		expect(result).toContain("True Intent");
	});

	test("includes request classification steps", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Trivial");
		expect(result).toContain("Explicit");
		expect(result).toContain("Exploratory");
		expect(result).toContain("Open-ended");
		expect(result).toContain("Ambiguous");
	});

	test("includes context-completion gate", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Context-Completion Gate");
	});

	test("includes turn-local intent reset", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Turn-Local Intent Reset");
	});

	test("does not promote low-level search tools as primary triggers", () => {
		const tools: AvailableTool[] = [{ name: "grep", category: "search" }];
		const result = buildIntentGate({ tools });

		expect(result).toContain("No specialized trigger tools");
		expect(result).not.toContain("Low-level repository tools");
	});

	test("adds fallback guidance when primary and low-level repository tools are available", () => {
		const tools: AvailableTool[] = [
			{ name: "context_engine", category: "search" },
			{ name: "code_read", category: "search" },
			{ name: "grep", category: "search" },
			{ name: "read", category: "other" },
		];
		const result = buildIntentGate({ tools });

		expect(result).toContain("context_engine");
		expect(result).toContain("repository discovery");
		expect(result).toContain("targets[]");
		expect(result).toContain("targets[].readArgs");
		expect(result).toContain("before citing code");
		expect(result).toContain('outputMode: "inline"');
		expect(result).toContain("Low-level repository tools");
		expect(result).toContain("code_read");
		expect(result).toContain("grep");
	});

	test("forces intent verbalization with the routing line", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("I read this as");
		expect(result).toContain("The routing line is required");
		expect(result).not.toContain("Keep the routing decision internal");
		expect(result).not.toContain("Do not expose classification labels");
	});

	test("includes routing map with surface form to approach mapping", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("explain");
		expect(result).toContain("implement");
		expect(result).toContain("error");
		expect(result).toContain("refactor");
	});

	test("keeps memory tools as primary triggers", () => {
		const tools: AvailableTool[] = [
			{ name: "mem_recall", category: "search" },
			{ name: "mem_search", category: "search" },
		];
		const result = buildIntentGate({ tools });

		expect(result).toContain("mem_recall");
		expect(result).toContain("mem_search");
		expect(result).toContain("Memory tools are a separate primary channel");
	});

	test("promotes agent_run orchestration as the default repository work decision layer when available", () => {
		const tools: AvailableTool[] = [
			{ name: "agent_run", category: "other" },
			{ name: "context_engine", category: "search" },
		];
		const result = buildIntentGate({ tools });

		expect(result).toContain("agent_run");
		expect(result).toContain("default decision layer");
		expect(result).toContain("classify the request");
		expect(result).toContain("select the profile");
		expect(result).toContain("execute directly or use child agents");
		expect(result).toContain("Bypass `agent_run` only");
	});
});
