import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolSession } from "../../src/tools";
import { stripSkillBodiesFromSearchResult } from "../../src/tools/rocky-skill-backend";
import { SkillGetTool, SkillSearchTool } from "../../src/tools/skill-search";

let rockyDir: string;
let previousRockySkillsDir: string | undefined;
let previousRockyHttpFallback: string | undefined;

function createTestSession(fetch?: ToolSession["fetch"]): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		fetch,
		settings: {
			get: (key: string) => (key === "rocky.apiUrl" ? "http://rocky.test" : undefined),
		},
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as ToolSession;
}

async function writeSkill(name: string, summary: string, body: string): Promise<void> {
	await fs.writeFile(
		path.join(rockyDir, `${name}.md`),
		["---", `name: ${name}`, `summary: ${summary}`, "tags:", "  - test", "version: 1", "---", "", body].join("\n"),
	);
}

beforeEach(async () => {
	rockyDir = await fs.mkdtemp(path.join(os.tmpdir(), "rocky-skill-tools-"));
	previousRockySkillsDir = process.env.ROCKY_SKILLS_DIR;
	previousRockyHttpFallback = process.env.ROCKY_SKILLS_USE_HTTP;
	process.env.ROCKY_SKILLS_DIR = rockyDir;
	delete process.env.ROCKY_SKILLS_USE_HTTP;
});

afterEach(async () => {
	if (previousRockySkillsDir === undefined) {
		delete process.env.ROCKY_SKILLS_DIR;
	} else {
		process.env.ROCKY_SKILLS_DIR = previousRockySkillsDir;
	}
	if (previousRockyHttpFallback === undefined) {
		delete process.env.ROCKY_SKILLS_USE_HTTP;
	} else {
		process.env.ROCKY_SKILLS_USE_HTTP = previousRockyHttpFallback;
	}
	await fs.rm(rockyDir, { recursive: true, force: true });
});

describe("Rocky skill search tools", () => {
	it("searches the local Rocky skill store without HTTP auth", async () => {
		const calls: unknown[] = [];
		await writeSkill("fp-k8s", "Kubernetes cluster operations", "Use kubectl for k8s cluster work.");
		const fetch: ToolSession["fetch"] = async (input, init) => {
			calls.push({ input, init });
			return new Response("unexpected", { status: 500 });
		};

		const result = await new SkillSearchTool(createTestSession(fetch)).execute("skill-search-test", {
			query: "k8s cluster",
			limit: 1,
		});

		expect(calls).toEqual([]);
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

	it("gets a skill by name from the local Rocky skill store", async () => {
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
