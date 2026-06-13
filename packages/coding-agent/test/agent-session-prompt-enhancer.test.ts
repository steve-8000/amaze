import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentMessage, type AgentTool } from "@amaze/agent-core";
import { type AssistantMessage, getBundledModel, type TextContent } from "@amaze/ai";
import { AssistantMessageEventStream } from "@amaze/ai/utils/event-stream";
import { TempDir } from "@amaze/utils";
import { createAssistantMessage } from "./helpers/agent-session-setup";

// Mock the enhancer module before importing AgentSession so the session picks
// up the mock. The real enhancer is unit-tested in prompt-enhancer.test.ts.
// Keep all real exports — mock.module persists for the whole test process,
// so other test files importing this module must still see them.
let enhancerResult: string | null = null;
let enhancerCalls: { text: string }[] = [];
const realEnhancer = await import("../src/utils/prompt-enhancer");
mock.module("../src/utils/prompt-enhancer", () => ({
	...realEnhancer,
	enhancePrompt: async (options: { text: string }) => {
		enhancerCalls.push({ text: options.text });
		return enhancerResult;
	},
}));

const { ModelRegistry } = await import("@amaze/coding-agent/config/model-registry");
const { Settings } = await import("@amaze/coding-agent/config/settings");
const { AgentSession } = await import("@amaze/coding-agent/session/agent-session");
const { AuthStorage } = await import("@amaze/coding-agent/session/auth-storage");
const { convertToLlm } = await import("@amaze/coding-agent/session/messages");
const { SessionManager } = await import("@amaze/coding-agent/session/session-manager");

function getMessageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const content = message.content as string | unknown[];
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is TextContent => (c as TextContent).type === "text")
		.map(c => c.text)
		.join("\n");
}

describe("AgentSession prompt enhancer wiring", () => {
	let tempDir: TempDir;
	let session: InstanceType<typeof AgentSession>;
	let authStorage: InstanceType<typeof AuthStorage> | undefined;
	let observedUserTexts: string[] = [];

	async function createSession(settingsOverrides: Record<string, unknown>): Promise<void> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"todo.enabled": false,
			"todo.eager": false,
			...settingsOverrides,
		});
		const sessionManager = SessionManager.inMemory(tempDir.path());

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			convertToLlm,
			streamFn: (_model, context) => {
				const lastMessage = context.messages.at(-1);
				if (lastMessage) observedUserTexts.push(getMessageText(lastMessage));
				const response: AssistantMessage = createAssistantMessage("done");
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: response });
					stream.push({ type: "done", reason: "stop", message: response });
				});
				return stream;
			},
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			toolRegistry: new Map<string, AgentTool>(),
		});
	}

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-agent-session-prompt-enhancer-");
		enhancerResult = null;
		enhancerCalls = [];
		observedUserTexts = [];
	});

	afterEach(async () => {
		if (session) await session.dispose();
		authStorage?.close();
		authStorage = undefined;
		tempDir.removeSync();
	});

	it("replaces the user turn with the enhanced prompt when enabled", async () => {
		await createSession({ "promptEnhancer.enabled": true });
		enhancerResult = "Engineered: fix the login bug in auth.ts";

		await session.prompt("login broken pls fix");

		expect(enhancerCalls).toEqual([{ text: "login broken pls fix" }]);
		expect(observedUserTexts).toEqual(["Engineered: fix the login bug in auth.ts"]);
	});

	it("falls back to the original text when the enhancer returns null", async () => {
		await createSession({ "promptEnhancer.enabled": true });
		enhancerResult = null;

		await session.prompt("login broken pls fix");

		expect(enhancerCalls).toHaveLength(1);
		expect(observedUserTexts).toEqual(["login broken pls fix"]);
	});

	it("does not invoke the enhancer when disabled", async () => {
		await createSession({ "promptEnhancer.enabled": false });

		await session.prompt("login broken pls fix");

		expect(enhancerCalls).toHaveLength(0);
		expect(observedUserTexts).toEqual(["login broken pls fix"]);
	});

	it("does not rewrite synthetic (agent-originated) prompts", async () => {
		await createSession({ "promptEnhancer.enabled": true });
		enhancerResult = "should never be used";

		await session.prompt("internal continuation", { synthetic: true });

		expect(enhancerCalls).toHaveLength(0);
		expect(observedUserTexts).toEqual(["internal continuation"]);
	});
});
