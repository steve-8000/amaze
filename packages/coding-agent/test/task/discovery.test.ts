import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadBundledAgents } from "@steve-z8k/pi-coding-agent/task/agents";
import { discoverAgents } from "@steve-z8k/pi-coding-agent/task/discovery";

const OMP_AGENT_MD = [
	"---",
	"name: amaze-test-agent",
	"description: Amaze-native test agent.",
	"---",
	"You are an Amaze task agent.",
].join("\n");

const CLAUDE_AGENT_MD = [
	"---",
	"name: cc-test-agent",
	"description: Test Claude Code agent.",
	"tools: Read, Grep, Glob, Bash",
	"model: sonnet",
	"color: purple",
	"---",
	"You are a Claude Code custom subagent.",
].join("\n");

describe("discoverAgents", () => {
	let tempHome: string;
	let projectDir: string;

	beforeEach(async () => {
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-task-agent-discovery-"));
		projectDir = path.join(tempHome, "project");
		await fs.mkdir(projectDir, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tempHome, { recursive: true, force: true });
	});

	test("loads Amaze agents but skips Claude Code custom agents", async () => {
		await fs.mkdir(path.join(projectDir, ".amaze", "agents"), { recursive: true });
		await fs.writeFile(path.join(projectDir, ".amaze", "agents", "amaze-test-agent.md"), OMP_AGENT_MD);

		await fs.mkdir(path.join(tempHome, ".claude", "agents"), { recursive: true });
		await fs.writeFile(path.join(tempHome, ".claude", "agents", "user-cc-test-agent.md"), CLAUDE_AGENT_MD);
		await fs.mkdir(path.join(projectDir, ".claude", "agents"), { recursive: true });
		await fs.writeFile(path.join(projectDir, ".claude", "agents", "project-cc-test-agent.md"), CLAUDE_AGENT_MD);

		const { agents, projectAgentsDir } = await discoverAgents(projectDir, tempHome);
		const names = agents.map(agent => agent.name);

		expect(names).toContain("amaze-test-agent");
		expect(names).not.toContain("cc-test-agent");
		expect(projectAgentsDir).toBe(path.join(projectDir, ".amaze", "agents"));
	});
});

describe("bundled contract agents", () => {
	test("exposes simple contract agent names backed by configurable model roles", () => {
		const agents = loadBundledAgents();
		const byName = new Map(agents.map(agent => [agent.name, agent]));

		for (const name of ["ultra", "deep", "flash", "spark"]) {
			const agent = byName.get(name);
			expect(agent).toBeDefined();
			expect(agent?.model).toEqual([`pi/${name}`]);
			expect(agent?.systemPrompt).toContain("contract");
		}

		for (const name of ["ultra", "deep", "spark"]) {
			expect(byName.get(name)?.tools).toEqual(
				expect.arrayContaining([
					"mcp__circle_graph",
					"mcp__circle_search",
					"mcp__circle_snippet",
					"mcp__circle_trace",
					"mcp__circle_architecture",
					"skill_search",
					"skill_get",
				]),
			);
		}

		expect(byName.get("deep")?.description).toContain("merge synthesis");
		expect(byName.get("deep")?.tools).toEqual(
			expect.arrayContaining([
				"read",
				"search",
				"find",
				"mcp__circle_graph",
				"mcp__circle_search",
				"mcp__circle_snippet",
				"mcp__circle_trace",
				"mcp__circle_architecture",
				"skill_search",
				"skill_get",
				"bash",
				"edit",
				"write",
				"ast_grep",
				"ast_edit",
			]),
		);
	});
});
