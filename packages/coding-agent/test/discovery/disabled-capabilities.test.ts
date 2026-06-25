import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type ContextFile, contextFileCapability } from "@amaze/pi-coding-agent/capability/context-file";
import { resetSettingsForTest, Settings } from "@amaze/pi-coding-agent/config/settings";
import { initializeWithSettings, loadCapability } from "@amaze/pi-coding-agent/discovery";
import { buildSystemPrompt } from "@amaze/pi-coding-agent/system-prompt";

describe("disabledCapabilities runtime filtering", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	async function setup(overrides: Record<string, unknown>): Promise<void> {
		const settings = await Settings.init({ inMemory: true, cwd: tempDir, overrides });
		initializeWithSettings(settings);
	}

	beforeEach(async () => {
		resetSettingsForTest();
		originalHome = process.env.HOME;
		tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-disabled-cap-home-"));
		process.env.HOME = tempHomeDir;
		vi.spyOn(os, "homedir").mockReturnValue(tempHomeDir);
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-disabled-cap-"));
		await fs.mkdir(path.join(tempDir, ".amaze"), { recursive: true });
		await fs.writeFile(path.join(tempDir, ".amaze", "AGENTS.md"), "# project instructions\n");
		await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# standalone instructions\n");
	});

	afterEach(async () => {
		resetSettingsForTest();
		vi.restoreAllMocks();
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await fs.rm(tempHomeDir, { recursive: true, force: true });
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("loads context files normally when capability is not disabled", async () => {
		await setup({ disabledCapabilities: [] });

		const result = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });

		expect(result.items.length).toBeGreaterThan(0);
	});

	test("disabling the capability suppresses all context files across providers", async () => {
		await setup({ disabledCapabilities: ["context-files"] });

		const result = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });

		expect(result.items).toHaveLength(0);
		expect(result.all).toHaveLength(0);
		expect(result.providers).toHaveLength(0);
	});

	test("includeDisabled bypasses the capability guard for dashboard loads", async () => {
		await setup({ disabledCapabilities: ["context-files"] });

		const result = await loadCapability<ContextFile>(contextFileCapability.id, {
			cwd: tempDir,
			includeDisabled: true,
		});

		expect(result.items.length).toBeGreaterThan(0);
	});

	test("disabling one capability leaves others loadable", async () => {
		await setup({ disabledCapabilities: ["context-files"] });

		const contextResult = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });
		const skillsResult = await loadCapability("skills", { cwd: tempDir });

		expect(contextResult.items).toHaveLength(0);
		// skills capability is untouched by disabling context-files
		expect(skillsResult.warnings).toBeDefined();
	});
});

describe("disabledCapabilities suppresses dir-context AGENTS.md pointers", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	async function renderPrompt(disabledCapabilities: string[]): Promise<string> {
		const settings = await Settings.init({ inMemory: true, cwd: tempDir, overrides: { disabledCapabilities } });
		initializeWithSettings(settings);
		const { systemPrompt } = await buildSystemPrompt({
			cwd: tempDir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: ["read"],
			workspaceTree: {
				rootPath: tempDir,
				rendered: "",
				truncated: false,
				totalLines: 0,
				agentsMdFiles: [path.join(tempDir, "sub", "AGENTS.md")],
			},
			nativeTools: true,
			inlineToolDescriptors: false,
		});
		return systemPrompt.join("\n\n");
	}

	beforeEach(async () => {
		resetSettingsForTest();
		originalHome = process.env.HOME;
		tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-disabled-cap-sp-home-"));
		process.env.HOME = tempHomeDir;
		vi.spyOn(os, "homedir").mockReturnValue(tempHomeDir);
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-disabled-cap-sp-"));
	});

	afterEach(async () => {
		resetSettingsForTest();
		vi.restoreAllMocks();
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await fs.rm(tempHomeDir, { recursive: true, force: true });
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("keeps the dir-context block when context-files is enabled", async () => {
		const text = await renderPrompt([]);
		expect(text).toContain("<dir-context>");
		expect(text).toContain("sub/AGENTS.md");
	});

	test("drops the dir-context block when context-files is disabled", async () => {
		const text = await renderPrompt(["context-files"]);
		expect(text).not.toContain("<dir-context>");
		expect(text).not.toContain("sub/AGENTS.md");
	});
});
