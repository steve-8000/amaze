import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@steve-z8k/pi-agent-core";
import { ModelRegistry } from "@steve-z8k/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { CustomEditor } from "@steve-z8k/pi-coding-agent/modes/components/custom-editor";
import { InteractiveMode } from "@steve-z8k/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@steve-z8k/pi-coding-agent/modes/theme/theme";
import { AgentSession } from "@steve-z8k/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@steve-z8k/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@steve-z8k/pi-coding-agent/session/session-manager";
import { TempDir } from "@steve-z8k/pi-utils";

class TestModalEditor extends CustomEditor {}

describe("InteractiveMode.setEditorComponent", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-editor-component-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-6");
		if (!model) {
			throw new Error("Expected claude-sonnet-4-6 to exist in registry");
		}

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
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	it("replaces the editor and rebinds interactive handlers", () => {
		mode.editor.setText("draft prompt");
		const previousEditor = mode.editor;
		const refreshSpy = vi.spyOn(mode, "refreshSlashCommandState").mockResolvedValue();

		mode.setEditorComponent((_tui, editorTheme) => new TestModalEditor(editorTheme));

		expect(mode.editor).toBeInstanceOf(TestModalEditor);
		expect(mode.editor).not.toBe(previousEditor);
		expect(mode.editor.getText()).toBe("draft prompt");
		expect(mode.editor.onSubmit).toBeDefined();
		expect(mode.editor.onEscape).toBeDefined();
		expect(refreshSpy).toHaveBeenCalled();
	});
});
