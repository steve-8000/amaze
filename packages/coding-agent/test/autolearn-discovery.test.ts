import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getManagedSkillsDir } from "@steve-z8k/pi-coding-agent/autolearn/managed-skills";
import "@steve-z8k/pi-coding-agent/discovery";
import { loadSkills } from "@steve-z8k/pi-coding-agent/extensibility/skills";
import { getAgentDir, setAgentDir } from "@steve-z8k/pi-utils/dirs";

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
	const file = path.join(dir, name, "SKILL.md");
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, ["---", `description: ${description}`, "---", "", `# ${name}`].join("\n"));
}

describe("managed-skills discovery", () => {
	let tempHome: string;
	let tempCwd: string;
	let managedDir: string;
	let authoredDir: string;

	let originalAgentDir: string;
	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-managed-disco-home-"));
		// cwd MUST live under the fake home so loadSkills' ancestor walk is bounded
		// and cannot pick up ambient /tmp/.amaze or /.amaze fixtures (full-suite-safe).
		tempCwd = path.join(tempHome, "work");
		await fs.mkdir(tempCwd, { recursive: true });
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".amaze", "agent"));
		managedDir = getManagedSkillsDir();
		// Authored user skills live in the sibling `skills/` dir under .../agent.
		authoredDir = path.join(path.dirname(managedDir), "skills");
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		await fs.rm(tempHome, { recursive: true, force: true });
	});

	it("does not surface a legacy managed skill in the rendered catalog", async () => {
		await writeSkill(managedDir, "foo", "A legacy managed skill.");
		const { skills } = await loadSkills({ cwd: tempCwd });
		expect(skills.some(s => s.name === "foo")).toBe(false);
		expect(skills.some(s => s.source === "amaze-managed:user")).toBe(false);
	});

	it("continues to load authored user skills from the legacy Amaze skills dir", async () => {
		await writeSkill(authoredDir, "bar", "Authored bar.");
		await writeSkill(managedDir, "bar", "Managed bar.");
		const { skills } = await loadSkills({ cwd: tempCwd });
		const bars = skills.filter(s => s.name === "bar");
		expect(bars).toHaveLength(1);
		expect(bars[0]?.source).toBe("native:user");
		expect(skills.some(s => s.name === "bar" && s.source === "amaze-managed:user")).toBe(false);
	});

	it("continues to load authored skills from non-native and custom providers", async () => {
		const customDir = path.join(tempHome, "custom-skills");
		await writeSkill(path.join(tempHome, ".agents", "skills"), "baz", "Authored baz (.agents).");
		await writeSkill(customDir, "qux", "Authored qux (custom).");
		await writeSkill(managedDir, "baz", "Managed baz.");
		await writeSkill(managedDir, "qux", "Managed qux.");
		const { skills } = await loadSkills({ cwd: tempCwd, customDirectories: [customDir] });
		expect(skills.find(s => s.name === "baz")?.source).toBe("agents:user");
		expect(skills.find(s => s.name === "qux")?.source).toBe("custom:user");
		expect(skills.some(s => s.source === "amaze-managed:user")).toBe(false);
	});

	it("is a no-op when the managed dir is absent", async () => {
		const { skills, warnings } = await loadSkills({ cwd: tempCwd });
		expect(skills.some(s => s.source === "amaze-managed:user")).toBe(false);
		expect(warnings.some(w => w.message.includes("managed-skills"))).toBe(false);
	});
});
