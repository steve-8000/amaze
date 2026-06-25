import { afterEach, describe, expect, it, vi } from "bun:test";
import { Settings } from "@amaze/pi-coding-agent/config/settings";
import { isReadOnlyAgent, TaskTool } from "@amaze/pi-coding-agent/task";
import { loadBundledAgents } from "@amaze/pi-coding-agent/task/agents";
import * as discoveryModule from "@amaze/pi-coding-agent/task/discovery";
import type { AgentDefinition } from "@amaze/pi-coding-agent/task/types";
import type { ToolSession } from "@amaze/pi-coding-agent/tools";

function createSession(overrides: Partial<Record<string, unknown>> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(overrides),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as unknown as ToolSession;
}

function agentByName(agents: AgentDefinition[], name: string): AgentDefinition {
	const agent = agents.find(candidate => candidate.name === name);
	expect(agent).toBeDefined();
	return agent as AgentDefinition;
}

describe("task agent capability descriptions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("classifies bundled contract agents by tool capability", () => {
		const agents = loadBundledAgents();

		for (const name of ["finder", "helper"]) {
			expect(isReadOnlyAgent(agentByName(agents, name))).toBe(true);
		}
		for (const name of ["thinker", "coder", "fixer", "checker"]) {
			expect(isReadOnlyAgent(agentByName(agents, name))).toBe(false);
		}
	});

	it("leaves contract agents on the default read summarization behavior", () => {
		const agents = loadBundledAgents();

		for (const name of ["thinker", "coder", "finder", "fixer", "checker", "helper"]) {
			expect(agentByName(agents, name).readSummarize).toBeUndefined();
		}
	});

	it("marks read-only agents in the task description and keeps full agents unmarked", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [
				{
					name: "read_scout",
					description: "Read-only scout",
					systemPrompt: "Scout the codebase.",
					tools: ["read", "search", "find"],
					source: "project",
				},
				{
					name: "full_agent",
					description: "Full agent",
					systemPrompt: "Modify the codebase.",
					source: "project",
				},
			],
			projectAgentsDir: null,
		});

		const tool = await TaskTool.create(createSession());
		const description = tool.description;

		expect(description).toContain("# read_scout — READ-ONLY (no edit/write/exec tools)\nRead-only scout");
		expect(description).toContain("# full_agent\nFull agent");
		expect(description).not.toContain("# full_agent — READ-ONLY");
	});
});
