import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolSession } from "../../src/tools";
import { stripSkillBodiesFromSearchResult } from "../../src/tools/skill-backend";
import { SkillGetTool, SkillSearchTool } from "../../src/tools/skill-search";

let managedSkillsDir: string;
let previousManagedSkillsDir: string | undefined;

function createTestSession(mcpManager?: unknown): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		mcpManager,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as ToolSession;
}

function createCircleMcpManager(
	calls: Array<{ method: string; params: Record<string, unknown> }>,
	responses: Record<string, unknown>,
) {
	return {
		getTools: () =>
			Object.keys(responses).map(name => ({
				name,
				mcpToolName: name,
				mcpServerName: "circle",
			})),
		waitForConnection: async () => ({
			transport: {
				request: async (method: string, params: Record<string, unknown>) => {
					calls.push({ method, params });
					return {
						content: [{ type: "text", text: JSON.stringify(responses[String(params.name)]) }],
					};
				},
			},
		}),
	};
}

async function writeSkill(name: string, summary: string, body: string): Promise<void> {
	await fs.writeFile(
		path.join(managedSkillsDir, `${name}.md`),
		["---", `name: ${name}`, `summary: ${summary}`, "tags:", "  - test", "version: 1", "---", "", body].join("\n"),
	);
}

async function writeCircleSkillDir(name: string, summary: string, body: string): Promise<void> {
	const dir = path.join(managedSkillsDir, name);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify({ id: name, title: name, tags: "amaze,all-skills" }));
	await fs.writeFile(path.join(dir, "summary.txt"), summary);
	await fs.writeFile(path.join(dir, "SKILL.md"), body);
}

beforeEach(async () => {
	managedSkillsDir = await fs.mkdtemp(path.join(os.tmpdir(), "managed-skill-tools-"));
	previousManagedSkillsDir = process.env.CIRCLE_SKILLS_DIR;
	process.env.CIRCLE_SKILLS_DIR = managedSkillsDir;
});

afterEach(async () => {
	if (previousManagedSkillsDir === undefined) {
		delete process.env.CIRCLE_SKILLS_DIR;
	} else {
		process.env.CIRCLE_SKILLS_DIR = previousManagedSkillsDir;
	}
	await fs.rm(managedSkillsDir, { recursive: true, force: true });
});

describe("managed skill search tools", () => {
	it("prefers Circle MCP circle_skill_search over local storage", async () => {
		const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
		await writeSkill("fp-k8s", "Local Kubernetes cluster operations", "Local body that should be ignored.");
		const mcpManager = createCircleMcpManager(calls, {
			circle_skill_search: {
				search_mode: "bm25",
				results: [
					{
						id: "circle-k8s",
						title: "Circle K8s",
						path: "skills/circle-k8s.md",
						summary: "Circle Kubernetes cluster operations",
						rank: 1,
					},
				],
				total: 1,
			},
		});

		const result = await new SkillSearchTool(createTestSession(mcpManager)).execute("skill-search-test", {
			query: "k8s cluster",
			limit: 1,
		});

		expect(calls).toEqual([
			{
				method: "tools/call",
				params: { name: "circle_skill_search", arguments: { query: "k8s cluster", limit: 1 } },
			},
		]);
		expect(result.details).toEqual([
			{
				name: "circle-k8s",
				summary: "Circle Kubernetes cluster operations",
				tags: [],
				score: 1,
			},
		]);
		expect(JSON.stringify(result.details)).not.toContain("Local body");
		expect(result.content[0]).toEqual({
			type: "text",
			text: JSON.stringify(result.details, null, 2),
		});
	});

	it("prefers Circle MCP circle_skill_get over local storage", async () => {
		const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
		await writeSkill("fp-k8s", "Local Kubernetes cluster operations", "Local body that should be ignored.");
		const mcpManager = createCircleMcpManager(calls, {
			circle_skill_get: {
				id: "fp-k8s",
				summary: "Circle Kubernetes cluster operations",
				content: "Circle kubectl instructions",
				meta: JSON.stringify({ tags: "circle,managed", version: 3 }),
			},
		});

		const result = await new SkillGetTool(createTestSession(mcpManager)).execute("skill-get-test", {
			name: "fp-k8s",
		});

		expect(calls).toEqual([
			{
				method: "tools/call",
				params: { name: "circle_skill_get", arguments: { name: "fp-k8s", id: "fp-k8s" } },
			},
		]);
		expect(result.details).toEqual({
			name: "fp-k8s",
			summary: "Circle Kubernetes cluster operations",
			tags: ["circle", "managed"],
			body: "Circle kubectl instructions",
			version: 3,
		});
		expect(JSON.stringify(result.details)).not.toContain("Local body");
	});

	it("falls back to local managed skill storage when Circle MCP is unavailable", async () => {
		const waitCalls: string[] = [];
		await writeSkill("fp-k8s", "Kubernetes cluster operations", "Use kubectl for k8s cluster work.");
		const mcpManager = {
			getTools: () => [{ name: "circle_skill_search", mcpToolName: "circle_skill_search", mcpServerName: "circle" }],
			waitForConnection: async (name: string) => {
				waitCalls.push(name);
				throw new Error("Circle MCP unavailable");
			},
		};

		const result = await new SkillSearchTool(createTestSession(mcpManager)).execute("skill-search-test", {
			query: "k8s cluster",
			limit: 1,
		});

		expect(waitCalls).toEqual(["circle"]);
		expect(result.details).toEqual([
			{
				name: "fp-k8s",
				summary: "Kubernetes cluster operations",
				tags: ["test"],
				version: 1,
				score: 9,
			},
		]);
		expect(JSON.stringify(result.details)).not.toContain("Use kubectl for k8s cluster work.");
		expect(result.content[0]).toEqual({
			type: "text",
			text: JSON.stringify(result.details, null, 2),
		});
	});

	it("reads directory-backed Circle skill storage", async () => {
		await writeCircleSkillDir(
			"fp-cluster",
			"AKS and OVH management operations",
			"# FP Validated Operations\n\nUse kubectl.",
		);

		const searchResult = await new SkillSearchTool(createTestSession()).execute("skill-search-test", {
			query: "AKS OVH",
			limit: 1,
		});
		expect(searchResult.details).toEqual([
			{
				name: "fp-cluster",
				summary: "AKS and OVH management operations",
				tags: ["amaze", "all-skills"],
				version: 1,
				score: 8,
			},
		]);

		const getResult = await new SkillGetTool(createTestSession()).execute("skill-get-test", { name: "fp-cluster" });
		expect(getResult.details).toEqual({
			name: "fp-cluster",
			summary: "AKS and OVH management operations",
			tags: ["amaze", "all-skills"],
			body: "# FP Validated Operations\n\nUse kubectl.",
			version: 1,
		});
	});

	it("falls back to local Circle skill storage when MCP search is empty", async () => {
		const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
		await writeCircleSkillDir("fp-cluster", "AKS and OVH management operations", "# FP Validated Operations");
		const mcpManager = createCircleMcpManager(calls, {
			circle_skill_search: { search_mode: "bm25", results: [], total: 0 },
		});

		const result = await new SkillSearchTool(createTestSession(mcpManager)).execute("skill-search-test", {
			query: "AKS OVH",
			limit: 1,
		});

		expect(calls).toEqual([
			{
				method: "tools/call",
				params: { name: "circle_skill_search", arguments: { query: "AKS OVH", limit: 1 } },
			},
		]);
		expect(result.details).toEqual([
			{
				name: "fp-cluster",
				summary: "AKS and OVH management operations",
				tags: ["amaze", "all-skills"],
				version: 1,
				score: 8,
			},
		]);
	});

	it("gets a skill by name from local managed skill storage", async () => {
		await writeSkill("fp-k8s", "Kubernetes cluster operations", "Use kubectl.");

		const result = await new SkillGetTool(createTestSession()).execute("skill-get-test", { name: "fp-k8s" });

		expect(result.details).toEqual({
			name: "fp-k8s",
			summary: "Kubernetes cluster operations",
			tags: ["test"],
			body: "Use kubectl.",
			version: 1,
		});
	});

	it("strips skill bodies from any search backend result", () => {
		const result = stripSkillBodiesFromSearchResult([
			{
				name: "heavy-skill",
				summary: "Heavy summary",
				tags: ["test"],
				body: "Large body that must not enter the model context.",
				version: 2,
				score: 12,
			},
		]);

		expect(result).toEqual([
			{
				name: "heavy-skill",
				summary: "Heavy summary",
				tags: ["test"],
				version: 2,
				score: 12,
			},
		]);
		expect(JSON.stringify(result)).not.toContain("Large body");
	});
});
