import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@steve-z8k/pi-agent-core";
import type { Model } from "@steve-z8k/pi-ai";
import { getBundledModel } from "@steve-z8k/pi-catalog/models";
import { ModelRegistry } from "@steve-z8k/pi-coding-agent/config/model-registry";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { AgentSession } from "@steve-z8k/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@steve-z8k/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@steve-z8k/pi-coding-agent/session/session-manager";
import { TempDir } from "@steve-z8k/pi-utils";

describe("AgentSession advisor toggle", () => {
	let sharedDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-advisor-toggle-shared-");
		authStorage = await AuthStorage.create(path.join(sharedDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-6");
		if (!bundled) throw new Error("Expected built-in anthropic model to exist");
		model = bundled;
	});

	afterAll(async () => {
		authStorage.close();
		try {
			await sharedDir.remove();
		} catch {}
	});

	let tempDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-advisor-toggle-");
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false });
		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
	});

	afterEach(async () => {
		await session.dispose();
		try {
			await tempDir.remove();
		} catch {}
	});

	it("starts with advisor disabled", () => {
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
		expect(session.formatAdvisorStatus()).toBe("Advisor is disabled.");
	});

	it("toggle enables the advisor and runtime", () => {
		session.settings.setModelRole("deep", "anthropic/claude-sonnet-4-6");
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(true);
		expect(session.isAdvisorActive()).toBe(true);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toContain("Advisor is enabled (anthropic/claude-sonnet-4-6)");
	});

	it("explicit enable overrides default-off setting for the session only", () => {
		session.settings.setModelRole("deep", "anthropic/claude-sonnet-4-6");
		session.settings.override("advisor.enabled", false);
		const customSession = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: session.settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		expect(customSession.isAdvisorEnabled()).toBe(false);

		const active = customSession.setAdvisorEnabled(true);

		expect(active).toBe(true);
		expect(customSession.isAdvisorActive()).toBe(true);
		expect(customSession.isAdvisorEnabled()).toBe(true);
		expect(customSession.settings.get("advisor.enabled")).toBe(false);
	});

	it("toggle disables the advisor and runtime", () => {
		session.settings.setModelRole("deep", "anthropic/claude-sonnet-4-6");
		session.toggleAdvisorEnabled();
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
	});

	it("setAdvisorEnabled reports inactive when no advisor model is assigned", () => {
		const active = session.setAdvisorEnabled(true);
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toBe(
			"Advisor setting is enabled, but no model is assigned to the 'deep' lane.",
		);
	});

	it("keeps sessions isolated when sharing a Settings instance", async () => {
		const sharedSettings = Settings.isolated({ "compaction.enabled": false });
		sharedSettings.setModelRole("deep", "anthropic/claude-sonnet-4-6");
		expect(sharedSettings.get("advisor.enabled")).toBe(false);

		const sessionA = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		const sessionB = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});

		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorEnabled()).toBe(false);

		const activeA = sessionA.setAdvisorEnabled(true);
		expect(activeA).toBe(true);
		expect(sessionA.isAdvisorEnabled()).toBe(true);
		expect(sessionA.isAdvisorActive()).toBe(true);

		expect(sessionB.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorActive()).toBe(false);
		expect(sessionB.formatAdvisorStatus()).toBe("Advisor is disabled.");

		const activeB = sessionB.toggleAdvisorEnabled();
		expect(activeB).toBe(true);
		expect(sessionB.isAdvisorEnabled()).toBe(true);

		sessionA.setAdvisorEnabled(false);
		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionA.isAdvisorActive()).toBe(false);

		expect(sessionB.isAdvisorEnabled()).toBe(true);
		expect(sessionB.isAdvisorActive()).toBe(true);
	});
});
