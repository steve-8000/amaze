import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getBundledModel } from "@amaze/pi-catalog/models";
import { SessionManager } from "@amaze/pi-coding-agent/session/session-manager";
import { createPersistedSubagentReviverFactory } from "@amaze/pi-coding-agent/task/persisted-revive";
import { TempDir } from "@amaze/pi-utils";

const tempDirs: TempDir[] = [];

function makeTempDir(prefix: string): string {
	const dir = TempDir.createSync(prefix);
	tempDirs.push(dir);
	return dir.path();
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => dir.remove()));
});

function assistantMessage(text: string) {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected built-in anthropic model to exist");
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

describe("persisted subagent revive", () => {
	it("leaves completed contract subagents transcript-only when session_init is non-revivable", async () => {
		const cwd = makeTempDir("@pi-persisted-nonrevivable-");
		const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendSessionInit({
			systemPrompt: "SUBAGENT RUNTIME",
			task: "contract",
			tools: ["read", "yield"],
			spawns: "",
			revivable: false,
		});
		manager.appendMessage(assistantMessage("done"));

		const factory = createPersistedSubagentReviverFactory({
			session: {} as never,
			authStorage: {} as never,
			modelRegistry: {} as never,
			settings: {} as never,
		});

		const revive = await factory({
			id: "DoneSubagent",
			displayName: "coder",
			kind: "sub",
			parentId: "Main",
			status: "parked",
			session: null,
			sessionFile,
			createdAt: Date.now(),
			lastActivity: Date.now(),
		});

		expect(revive).toBeUndefined();
	});
});
