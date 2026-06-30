import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@steve-z8k/pi-agent-core";
import { type Api, Effort, type Model } from "@steve-z8k/pi-ai";
import { getBundledModel } from "@steve-z8k/pi-catalog/models";
import { ModelRegistry } from "@steve-z8k/pi-coding-agent/config/model-registry";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import { type CreateAgentSessionResult, createAgentSession } from "@steve-z8k/pi-coding-agent/sdk";
import { AgentSession } from "@steve-z8k/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@steve-z8k/pi-coding-agent/session/auth-storage";
import { getRestorableSessionModels } from "@steve-z8k/pi-coding-agent/session/session-context";
import { EPHEMERAL_MODEL_CHANGE_ROLE } from "@steve-z8k/pi-coding-agent/session/session-entries";
import { SessionManager } from "@steve-z8k/pi-coding-agent/session/session-manager";
import { TempDir } from "@steve-z8k/pi-utils";

describe("AgentSession model persistence", () => {
	let tempDir: TempDir;
	let session: AgentSession | undefined;
	let sessionSettings: Settings;
	// Auth storage (SQLite DB) and the model registry are immutable across these tests:
	// every test sets the same anthropic runtime key and only ever reads the bundled model
	// list. Building them once avoids ~12 SQLite opens + registry constructions.
	let sharedDir: TempDir;
	let sharedAuthStorage: AuthStorage;
	let sharedModelRegistry: ModelRegistry;

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-model-persistence-shared-");
		sharedAuthStorage = await AuthStorage.create(path.join(sharedDir.path(), "auth.db"));
		sharedAuthStorage.setRuntimeApiKey("anthropic", "test-key");
		sharedModelRegistry = new ModelRegistry(sharedAuthStorage, path.join(sharedDir.path(), "models.yml"));
	});

	afterAll(() => {
		sharedAuthStorage.close();
		sharedDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-model-persistence-");
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
		tempDir.removeSync();
	});

	function getAnthropicModelOrThrow(id: string): Model<Api> {
		const model = getBundledModel("anthropic", id);
		if (!model) throw new Error(`Expected anthropic model ${id} to exist`);
		return model;
	}

	function modelValue(model: Model<Api>): string {
		return `${model.provider}/${model.id}`;
	}

	async function writeRoleModelSession(
		flashRoleValue: string,
		deepRoleValue: string,
		lastRole = "deep",
	): Promise<string> {
		const targetSessionFile = path.join(tempDir.path(), `target-${Bun.nanoseconds()}.jsonl`);
		const timestamp = "2026-06-01T00:00:00.000Z";
		await Bun.write(
			targetSessionFile,
			`${[
				{ type: "session", version: 3, id: "target-session", timestamp, cwd: tempDir.path() },
				{
					type: "model_change",
					id: "flash-model",
					parentId: null,
					timestamp,
					model: flashRoleValue,
					role: "flash",
				},
				{
					type: "model_change",
					id: "deep-model",
					parentId: "flash-model",
					timestamp,
					model: deepRoleValue,
					role: lastRole,
				},
			]
				.map(entry => JSON.stringify(entry))
				.join("\n")}\n`,
		);
		return targetSessionFile;
	}
	async function createSession(options?: {
		initialModel?: Model<Api>;
		selectInitialModel?: (availableModels: Model<Api>[]) => Model<Api>;
		modelRoles?: Record<string, string>;
		persist?: boolean;
	}): Promise<{ modelRegistry: ModelRegistry; settings: Settings; session: AgentSession }> {
		const modelRegistry = sharedModelRegistry;
		const model =
			options?.initialModel ??
			options?.selectInitialModel?.(modelRegistry.getAvailable()) ??
			getAnthropicModelOrThrow("claude-sonnet-4-6");
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
				thinkingLevel: Effort.Medium,
			},
		});

		sessionSettings = Settings.isolated();
		const modelRoles = options?.modelRoles;
		if (modelRoles) {
			for (const role in modelRoles) {
				const modelRoleValue = modelRoles[role];
				if (modelRoleValue !== undefined) {
					sessionSettings.setModelRole(role, modelRoleValue);
				}
			}
		}
		session = new AgentSession({
			agent,
			sessionManager: options?.persist
				? SessionManager.create(tempDir.path(), path.join(tempDir.path(), "active"))
				: SessionManager.inMemory(),
			settings: sessionSettings,
			modelRegistry,
		});

		return { modelRegistry, settings: sessionSettings, session };
	}

	async function createStartupResumeSession(
		targetSessionFile: string,
		settings: Settings = Settings.isolated(),
	): Promise<CreateAgentSessionResult> {
		const sessionManager = await SessionManager.open(targetSessionFile, path.join(tempDir.path(), "startup"));
		const result = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			authStorage: sharedAuthStorage,
			modelRegistry: sharedModelRegistry,
			sessionManager,
			settings,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			skipPythonPreflight: true,
		});
		session = result.session;
		return result;
	}
	it("switches the active model without persisting by default", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: { flash: flashRoleValue },
		});

		await created.session.setModel(nextModel);

		expect(created.session.model?.id).toBe(nextModel.id);
		expect(created.settings.getModelRole("flash")).toBe(flashRoleValue);
	});

	it("persists the flash role when explicitly requested", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: { flash: modelValue(flashModel) },
		});

		await created.session.setModel(nextModel, "flash", { persist: true });

		expect(created.session.model?.id).toBe(nextModel.id);
		expect(created.settings.getModelRole("flash")).toBe(modelValue(nextModel));
	});

	it("cycles role models without rewriting configured roles", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const deepModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const deepRoleValue = `${modelValue(deepModel)}:high`;

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: {
				flash: flashRoleValue,
				deep: deepRoleValue,
			},
		});

		const result = await created.session.cycleRoleModels(["flash", "deep"]);

		expect(result?.role).toBe("deep");
		expect(result?.model.id).toBe(deepModel.id);
		expect(created.session.model?.id).toBe(deepModel.id);
		expect(created.settings.getModelRole("flash")).toBe(flashRoleValue);
		expect(created.settings.getModelRole("deep")).toBe(deepRoleValue);
	});

	it("cycles role models backward from the current role", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const deepModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const deepRoleValue = modelValue(deepModel);

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: {
				flash: flashRoleValue,
				deep: deepRoleValue,
			},
		});

		const forward = await created.session.cycleRoleModels(["flash", "deep"], "forward");
		const backward = await created.session.cycleRoleModels(["flash", "deep"], "backward");

		expect(forward?.role).toBe("deep");
		expect(backward?.role).toBe("flash");
		expect(created.session.model?.id).toBe(flashModel.id);
		expect(created.settings.getModelRole("flash")).toBe(flashRoleValue);
		expect(created.settings.getModelRole("deep")).toBe(deepRoleValue);
	});

	it("cycles available models without persisting the flash role", async () => {
		const created = await createSession({
			selectInitialModel: availableModels => {
				if (availableModels.length <= 1 || !availableModels[0]) {
					throw new Error("Expected at least two available models");
				}
				return availableModels[0];
			},
		});
		const initialModel = created.session.model;
		if (!initialModel) throw new Error("Expected initial model to be set");
		const flashRoleValue = modelValue(initialModel);
		created.settings.setModelRole("flash", flashRoleValue);

		const result = await created.session.cycleModel();

		if (!result) throw new Error("Expected cycleModel to return a new model");
		expect(modelValue(result.model)).not.toBe(flashRoleValue);
		const activeModel = created.session.model;
		if (!activeModel) throw new Error("Expected active model after cycleModel");
		expect(modelValue(activeModel)).toBe(modelValue(result.model));
		expect(created.settings.getModelRole("flash")).toBe(flashRoleValue);
	});

	it("restores the last active role model when switching sessions", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const deepModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const deepRoleValue = modelValue(deepModel);

		const targetSessionFile = await writeRoleModelSession(flashRoleValue, deepRoleValue);

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: { flash: flashRoleValue, deep: deepRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(deepModel.id);
	});

	it("restores the last active role model during startup resume", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const deepModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const deepRoleValue = modelValue(deepModel);
		const targetSessionFile = await writeRoleModelSession(flashRoleValue, deepRoleValue);

		const result = await createStartupResumeSession(targetSessionFile);

		expect(result.session.model?.id).toBe(deepModel.id);
	});

	it("falls back to the saved flash model when switch-session role restore is unavailable", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const previousModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(flashRoleValue, "anthropic/not-loaded-anymore");

		const created = await createSession({
			initialModel: previousModel,
			modelRoles: { flash: flashRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(flashModel.id);
	});

	it("restores the saved flash model when switch-session last role is fallback", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const fallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(
			flashRoleValue,
			modelValue(fallbackModel),
			EPHEMERAL_MODEL_CHANGE_ROLE,
		);

		const created = await createSession({
			initialModel: fallbackModel,
			modelRoles: { flash: flashRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(flashModel.id);
	});

	it("falls back to the saved flash model when startup role restore is unavailable", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const settingsFallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(flashRoleValue, "anthropic/not-loaded-anymore");
		const settings = Settings.isolated();
		settings.setModelRole("flash", modelValue(settingsFallbackModel));

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(flashModel.id);
	});

	it("restores the saved flash model when startup last role is fallback", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const fallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(
			flashRoleValue,
			modelValue(fallbackModel),
			EPHEMERAL_MODEL_CHANGE_ROLE,
		);
		const settings = Settings.isolated();
		settings.setModelRole("flash", modelValue(fallbackModel));

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(flashModel.id);
	});

	it("restores a temporary model when switching sessions", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const temporaryModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(flashRoleValue, modelValue(temporaryModel), "temporary");

		const created = await createSession({
			initialModel: flashModel,
			modelRoles: { flash: flashRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(temporaryModel.id);
	});

	it("restores a temporary model during startup resume", async () => {
		const flashModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const temporaryModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const flashRoleValue = modelValue(flashModel);
		const targetSessionFile = await writeRoleModelSession(flashRoleValue, modelValue(temporaryModel), "temporary");
		const settings = Settings.isolated();
		settings.setModelRole("flash", flashRoleValue);

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(temporaryModel.id);
	});

	it("deduplicates a temporary model when it matches the flash fallback", () => {
		expect(
			getRestorableSessionModels(
				{
					flash: "anthropic/claude-sonnet-4-6",
					temporary: "anthropic/claude-sonnet-4-6",
				},
				"temporary",
			),
		).toEqual(["anthropic/claude-sonnet-4-6"]);
	});

	it("lists only the flash model for ephemeral fallback restores", () => {
		expect(
			getRestorableSessionModels(
				{
					flash: "anthropic/claude-sonnet-4-6",
					[EPHEMERAL_MODEL_CHANGE_ROLE]: "anthropic/claude-sonnet-4-6",
				},
				EPHEMERAL_MODEL_CHANGE_ROLE,
			),
		).toEqual(["anthropic/claude-sonnet-4-6"]);
	});

	it("deduplicates a named role model when it matches the flash fallback", () => {
		expect(
			getRestorableSessionModels(
				{
					flash: "anthropic/claude-sonnet-4-6",
					deep: "anthropic/claude-sonnet-4-6",
				},
				"deep",
			),
		).toEqual(["anthropic/claude-sonnet-4-6"]);
	});
});
