import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSettingEnvNames, Settings } from "@amaze/pi-coding-agent/config/settings";
import { AgentStorage } from "@amaze/pi-coding-agent/session/agent-storage";
import { getProjectAgentDir, TempDir } from "@amaze/pi-utils";
import { YAML } from "bun";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

describe("env-backed settings", () => {
	let settingsState: SettingsTestState | undefined;
	let tempDir: TempDir;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		settingsState = beginSettingsTest();
		tempDir = TempDir.createSync("test-settings-env-");
		agentDir = path.join(tempDir.path(), "agent");
		projectDir = path.join(tempDir.path(), "project");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
	});

	afterEach(async () => {
		AgentStorage.resetInstance();
		restoreSettingsTestState(settingsState);
		settingsState = undefined;
		if (tempDir) {
			try {
				await tempDir.remove();
			} catch {}
			tempDir = undefined as unknown as TempDir;
		}
	});

	it("lets env-backed settings override persisted config", async () => {
		await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify({ task: { maxConcurrency: 3 } }, null, 2));
		await Bun.write(
			path.join(getProjectAgentDir(projectDir), "config.yml"),
			YAML.stringify({ task: { maxConcurrency: 4 } }, null, 2),
		);
		const [taskEnvName] = getSettingEnvNames("task.maxConcurrency");
		setEnv(taskEnvName, "7");

		const settings = await Settings.init({ cwd: projectDir, agentDir });

		expect(settings.get("task.maxConcurrency")).toBe(7);
		expect(settings.isConfigured("task.maxConcurrency")).toBe(true);
	});

	it("parses record settings from env json", async () => {
		const [envName] = getSettingEnvNames("modelRoles");
		setEnv(envName, '{"default":"openai/gpt-5.4:medium","thinker":"openai/gpt-5.4:low"}');

		const settings = await Settings.init({ cwd: projectDir, agentDir });

		expect(settings.get("modelRoles")).toEqual({
			default: "openai/gpt-5.4:medium",
			thinker: "openai/gpt-5.4:low",
		});
	});

	it("keeps explicit config overlays above env-backed settings", async () => {
		const [envName] = getSettingEnvNames("task.maxConcurrency");
		const overlayPath = path.resolve(tempDir.path(), "overlay.yml");
		setEnv(envName, "7");
		await Bun.write(overlayPath, YAML.stringify({ task: { maxConcurrency: 9 } }, null, 2));

		const settings = await Settings.init({ cwd: projectDir, agentDir, configFiles: [overlayPath] });

		expect(settings.get("task.maxConcurrency")).toBe(9);
	});

	it("accepts the legacy OMP setting prefix", async () => {
		const envName = getSettingEnvNames("task.maxConcurrency").find(name => name.startsWith("OMP_SETTING_"));
		if (!envName) throw new Error("Expected legacy env alias");
		setEnv(envName, "11");

		const settings = await Settings.init({ cwd: projectDir, agentDir });

		expect(settings.get("task.maxConcurrency")).toBe(11);
	});
});

function setEnv(key: string, value: string): void {
	process.env[key] = value;
	Bun.env[key] = value;
}
