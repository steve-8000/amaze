import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@amaze/agent-core";
import * as compactionModule from "@amaze/agent-core/compaction";
import { getBundledModel } from "@amaze/ai";
import { ModelRegistry } from "@amaze/coding-agent/config/model-registry";
import { Settings } from "@amaze/coding-agent/config/settings";
import { AgentSession } from "@amaze/coding-agent/session/agent-session";
import { AuthStorage } from "@amaze/coding-agent/session/auth-storage";
import { SessionManager } from "@amaze/coding-agent/session/session-manager";
import { TempDir } from "@amaze/utils";
import { assistantMsg, userMsg } from "./utilities";

describe("AgentSession compaction model pinning", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-compaction-model-pin-");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (session) await session.dispose();
		authStorage?.close();
		tempDir.removeSync();
	});

	it("prefers GPT-5.4 for compaction even when the live session model differs", async () => {
		const currentModel = getBundledModel("github-copilot", "gpt-4o");
		const pinnedModel = getBundledModel("openai", "gpt-5.4");
		if (!currentModel || !pinnedModel) {
			throw new Error("Expected bundled compaction models to exist");
		}

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey(currentModel.provider, "copilot-token");
		authStorage.setRuntimeApiKey(pinnedModel.provider, "openai-token");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([currentModel, pinnedModel]);
		vi.spyOn(modelRegistry, "getApiKey").mockImplementation(async model => {
			if (model.provider === pinnedModel.provider && model.id === pinnedModel.id) return "openai-token";
			if (model.provider === currentModel.provider && model.id === currentModel.id) return "copilot-token";
			return undefined;
		});

		const agent = new Agent({
			initialState: {
				model: currentModel,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.keepRecentTokens": 1 }),
			modelRegistry,
		});
		session.subscribe(() => {});

		for (const [u, a] of [
			["first question", "first answer"],
			["second question", "second answer"],
		] as const) {
			const user = userMsg(u);
			const assistant = assistantMsg(a);
			session.agent.appendMessage(user);
			session.sessionManager.appendMessage(user);
			session.agent.appendMessage(assistant);
			session.sessionManager.appendMessage(assistant);
		}

		const compactSpy = vi.spyOn(compactionModule, "compact").mockImplementation(async (preparation, model) => ({
			summary: `summary via ${model.provider}/${model.id}`,
			shortSummary: "short summary",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: 42,
			details: { provider: model.provider, id: model.id },
		}));

		const result = await session.compact();
		expect(result.summary).toContain(`${pinnedModel.provider}/${pinnedModel.id}`);
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(compactSpy.mock.calls[0]?.[1]).toMatchObject({ provider: pinnedModel.provider, id: pinnedModel.id });
	});

	it("resolves compaction_map role aliases for map-reduce while keeping GPT-5.4 as reduce model", async () => {
		const currentModel = getBundledModel("openai-codex", "gpt-5.5");
		const reduceModel = getBundledModel("openai-codex", "gpt-5.4");
		if (!currentModel || !reduceModel) throw new Error("Expected bundled compaction models to exist");
		const mapModel = {
			...reduceModel,
			provider: "local-qwopus",
			id: "qwopus3.5-9b-coder-mtp",
			name: "Qwopus3.5 9B Coder MTP",
			contextWindow: 262144,
			maxTokens: 32768,
		};

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey(currentModel.provider, "current-key");
		authStorage.setRuntimeApiKey(reduceModel.provider, "reduce-key");
		authStorage.setRuntimeApiKey(mapModel.provider, "local-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([currentModel, reduceModel, mapModel]);
		vi.spyOn(modelRegistry, "getApiKey").mockImplementation(async model => {
			if (model.provider === mapModel.provider && model.id === mapModel.id) return "local-key";
			if (model.provider === reduceModel.provider && model.id === reduceModel.id) return "reduce-key";
			if (model.provider === currentModel.provider && model.id === currentModel.id) return "current-key";
			return undefined;
		});

		const settings = Settings.isolated({
			modelRoles: {
				compaction_map: "pi/local_scout",
				compaction_reduce: "openai-codex/gpt-5.4",
				local_scout: "local-qwopus/qwopus3.5-9b-coder-mtp",
			},
			"compaction.keepRecentTokens": 1,
			"compaction.mode": "map-reduce",
			"compaction.remoteEnabled": false,
			"compaction.mapReduceSectionTokenBudget": 1,
			"compaction.mapReduceMaxSections": 4,
		});

		const agent = new Agent({
			initialState: {
				model: currentModel,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		session.subscribe(() => {});

		for (const [u, a] of [
			["first question", "first answer"],
			["second question", "second answer"],
			["third question", "third answer"],
		] as const) {
			const user = userMsg(u);
			const assistant = assistantMsg(a);
			session.agent.appendMessage(user);
			session.sessionManager.appendMessage(user);
			session.agent.appendMessage(assistant);
			session.sessionManager.appendMessage(assistant);
		}

		const compactSpy = vi
			.spyOn(compactionModule, "compact")
			.mockImplementation(async (preparation, model, _apiKey, _instructions, _signal, options) => ({
				summary: `reduce=${model.provider}/${model.id}; map=${options?.mapModel?.provider ?? "none"}/${options?.mapModel?.id ?? "none"}`,
				shortSummary: "short summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: 42,
				details: { mapApiKey: options?.mapApiKey },
			}));

		const result = await session.compact();
		expect(result.summary).toContain(`reduce=${reduceModel.provider}/${reduceModel.id}`);
		expect(result.summary).toContain(`map=${mapModel.provider}/${mapModel.id}`);
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(compactSpy.mock.calls[0]?.[1]).toMatchObject({ provider: reduceModel.provider, id: reduceModel.id });
		expect(compactSpy.mock.calls[0]?.[5]).toMatchObject({
			mapModel: { provider: mapModel.provider, id: mapModel.id },
			mapApiKey: "local-key",
		});
	});
});
