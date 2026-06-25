import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@amaze/pi-agent-core";
import { ModelRegistry } from "@amaze/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@amaze/pi-coding-agent/config/settings";
import { InteractiveMode } from "@amaze/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@amaze/pi-coding-agent/modes/theme/theme";
import { AgentSession } from "@amaze/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@amaze/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@amaze/pi-coding-agent/session/session-manager";
import { __resetAutoQaConsentForTests, resolveAutoQaConsent } from "@amaze/pi-coding-agent/tools/report-tool-issue";
import { TempDir } from "@amaze/pi-utils";

describe("InteractiveMode auto-QA consent popup", () => {
	let authStorage: AuthStorage;
	let mode: InteractiveMode;
	let session: AgentSession;
	let tempDir: TempDir;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
		if (typeof process.stdin.setRawMode === "function") {
			vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
		}

		resetSettingsForTest();
		__resetAutoQaConsentForTests();
		tempDir = TempDir.createSync("@pi-interactive-mode-autoqa-consent-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
		vi.spyOn(mode.statusLine, "watchBranch").mockImplementation(() => {});
	});

	afterEach(async () => {
		mode?.stop();
		__resetAutoQaConsentForTests();
		vi.restoreAllMocks();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	it("shows neutral consent copy with Yes/No choices", async () => {
		await mode.init();
		const showHookSelector = vi.spyOn(mode, "showHookSelector").mockResolvedValue("Yes");

		expect(await resolveAutoQaConsent(session.settings)).toBe(true);
		expect(showHookSelector).toHaveBeenCalledWith(
			"Share anonymous tool-issue reports with the Amaze developers?\nReports include only the tool name and generic breakage details. They never include personal data.",
			["Yes", "No"],
		);
		expect(session.settings.get("dev.autoqa.consent")).toBe("granted");
	});

	it("keeps the popup Yes/No gated when the user declines", async () => {
		await mode.init();
		const showHookSelector = vi.spyOn(mode, "showHookSelector").mockResolvedValue("No");

		expect(await resolveAutoQaConsent(session.settings)).toBe(false);
		expect(showHookSelector).toHaveBeenCalledWith(
			"Share anonymous tool-issue reports with the Amaze developers?\nReports include only the tool name and generic breakage details. They never include personal data.",
			["Yes", "No"],
		);
		expect(session.settings.get("dev.autoqa.consent")).toBe("denied");
	});
});
