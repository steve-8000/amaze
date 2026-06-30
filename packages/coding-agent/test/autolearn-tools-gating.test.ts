import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type SettingPath, Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import {
	resetActiveSkillsForTests,
	type Skill,
	setActiveSkills,
} from "@steve-z8k/pi-coding-agent/extensibility/skills";
import { createTools, type ToolSession } from "@steve-z8k/pi-coding-agent/tools";
import { ManageSkillTool } from "@steve-z8k/pi-coding-agent/tools/manage-skill";
import { getAgentDir, setAgentDir } from "@steve-z8k/pi-utils/dirs";
import { type } from "arktype";

function makeSession(
	settingsOverrides: Partial<Record<SettingPath, unknown>> = {},
	extra: Partial<ToolSession> = {},
): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		skipPythonPreflight: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(settingsOverrides),
		...extra,
	};
}

describe("autolearn tool gating", () => {
	it("offers no managed-skill tool by default (autolearn disabled)", async () => {
		const names = (await createTools(makeSession())).map(t => t.name);
		expect(names).not.toContain("manage_skill");
	});

	it("offers manage_skill when enabled", async () => {
		const names = (await createTools(makeSession({ "autolearn.enabled": true }))).map(t => t.name);
		expect(names).toContain("manage_skill");
	});

	it("marks manage_skill essential", async () => {
		const tools = await createTools(makeSession({ "autolearn.enabled": true }));
		const manage = tools.find(t => t.name === "manage_skill");
		expect(manage).toBeDefined();
		expect(manage?.loadMode).toBe("essential");
	});

	it("force-includes manage_skill into an explicit restricted toolNames list", async () => {
		const names = (await createTools(makeSession({ "autolearn.enabled": true }), ["read"])).map(t => t.name);
		expect(names).toContain("manage_skill");
	});

	it("excludes manage_skill from a subagent even with an explicit list", async () => {
		const sub = (await createTools(makeSession({ "autolearn.enabled": true }, { taskDepth: 1 }), ["read"])).map(
			t => t.name,
		);
		expect(sub).not.toContain("manage_skill");

		const subDiscovered = (await createTools(makeSession({ "autolearn.enabled": true }, { taskDepth: 1 }))).map(
			t => t.name,
		);
		expect(subDiscovered).not.toContain("manage_skill");
	});
});

describe("manage_skill execute", () => {
	let tempHome: string;
	let originalAgentDir: string;
	let previousCircleSkillsDir: string | undefined;

	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-manage-skill-"));
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".amaze", "agent"));
		previousCircleSkillsDir = process.env.CIRCLE_SKILLS_DIR;
		process.env.CIRCLE_SKILLS_DIR = path.join(tempHome, ".circle", "skills");
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		if (previousCircleSkillsDir === undefined) delete process.env.CIRCLE_SKILLS_DIR;
		else process.env.CIRCLE_SKILLS_DIR = previousCircleSkillsDir;
		resetActiveSkillsForTests();
		await fs.rm(tempHome, { recursive: true, force: true });
	});

	const tool = () =>
		ManageSkillTool.createIf(
			makeSession(
				{ "autolearn.enabled": true },
				{
					settings: {
						get: (key: string) => (key === "autolearn.enabled" ? true : undefined),
					} as ToolSession["settings"],
				},
			),
		)!;

	it("create and delete write through the local Circle skill store", async () => {
		await tool().execute("1", { action: "create", name: "demo", description: "When to demo.", body: "# Demo" });
		const skillPath = path.join(tempHome, ".circle", "skills", "demo.md");
		const content = await Bun.file(skillPath).text();
		expect(content).toContain("summary: When to demo.");
		expect(content).toContain("# Demo");

		await tool().execute("2", { action: "delete", name: "demo" });
		expect(await Bun.file(skillPath).exists()).toBe(false);
	});

	it("preserves create/update existence contracts over Circle upsert", async () => {
		await tool().execute("1", { action: "create", name: "demo", description: "When to demo.", body: "# Demo" });
		await expect(
			tool().execute("2", { action: "create", name: "demo", description: "When to demo.", body: "# Demo 2" }),
		).rejects.toThrow(/already exists/);
		await expect(
			tool().execute("3", {
				action: "update",
				name: "missing",
				description: "When missing.",
				body: "# Missing",
			}),
		).rejects.toThrow(/does not exist/);

		await tool().execute("4", {
			action: "update",
			name: "demo",
			description: "When to demo.",
			body: "# Updated",
		});
		expect(await Bun.file(path.join(tempHome, ".circle", "skills", "demo.md")).text()).toContain("# Updated");
	});

	it("rejects create without a body and delete of a missing skill", async () => {
		await expect(tool().execute("3", { action: "create", name: "nobody", description: "d" })).rejects.toThrow(
			/requires/,
		);
		await expect(tool().execute("4", { action: "delete", name: "absent" })).rejects.toThrow(/does not exist/);
	});

	it("schema rejects create/update without description+body but allows delete", () => {
		const schema = tool().parameters;
		expect(schema({ action: "create", name: "x" }) instanceof type.errors).toBe(true);
		expect(schema({ action: "update", name: "x", description: "d" }) instanceof type.errors).toBe(true);
		expect(schema({ action: "create", name: "x", description: "d", body: "b" }) instanceof type.errors).toBe(false);
		expect(schema({ action: "delete", name: "x" }) instanceof type.errors).toBe(false);
	});

	it("refuses to create a managed skill an authored skill of the same name would shadow", async () => {
		const authored: Skill = {
			name: "demo",
			description: "An authored demo skill.",
			filePath: path.join(tempHome, "authored", "demo", "SKILL.md"),
			baseDir: path.join(tempHome, "authored", "demo"),
			source: "native:user",
			_source: {
				provider: "native",
				providerName: "Pi",
				path: path.join(tempHome, "authored", "demo", "SKILL.md"),
				level: "user",
			},
		};
		setActiveSkills([authored]);

		const result = await tool().execute("c", {
			action: "create",
			name: "demo",
			description: "When to demo.",
			body: "# Demo",
		});

		// Reported as an error, not a false "Created".
		expect(result.isError).toBe(true);
		const text = result.content.map(part => (part.type === "text" ? part.text : "")).join("");
		expect(text).toMatch(/authored skill/i);
		expect(text).not.toContain("Created");
		// Nothing was sent to Circle MCP, so a shadowed managed skill can never surface.
		expect(result.details).toEqual({ action: "create", name: "demo", shadowed: true });
	});
});
