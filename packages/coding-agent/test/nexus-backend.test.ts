import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import { nexusBackend } from "@amaze/coding-agent/memory-backend/nexus-backend";
import { getNexusRoot, NexusStore } from "@amaze/coding-agent/nexus/store";
import { Snowflake } from "@amaze/utils";

const createdDirs = new Set<string>();

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${Snowflake.next()}`);
	await fs.mkdir(dir, { recursive: true });
	createdDirs.add(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of createdDirs) {
		await fs.rm(dir, { recursive: true, force: true });
	}
	createdDirs.clear();
});

describe("nexusBackend", () => {
	it("does not break the agent loop when optional AI or remote import paths are unavailable", async () => {
		const agentDir = await makeTempDir("nexus-backend-agent");
		const cwd = await makeTempDir("nexus-backend-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		const sessionFile = path.join(sessionDir, "thr.jsonl");
		await fs.mkdir(sessionDir, { recursive: true });
		await Bun.write(sessionFile, `${JSON.stringify({ type: "session", id: "thr", cwd })}\n`);
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.llm.enabled": true,
			"nexus.llm.provider": "local_openai",
			"nexus.embeddings.enabled": true,
			"nexus.embeddings.provider": "local_openai",
			"nexus.dream.enabled": true,
		});
		const session = {
			sessionManager: {
				getCwd: () => cwd,
				getSessionFile: () => sessionFile,
				getSessionDir: () => sessionDir,
			},
			settings,
			agent: { metadataForProvider: () => undefined },
		} as any;
		await expect(
			nexusBackend.start({ session, settings, modelRegistry: {} as any, agentDir, taskDepth: 0 }),
		).resolves.toBeUndefined();
	});

	it("does not online-consolidate tool-call-only assistant turns", async () => {
		const agentDir = await makeTempDir("nexus-backend-tool-call-agent");
		const cwd = await makeTempDir("nexus-backend-tool-call-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.onlineConsolidation.enabled": true,
			"nexus.llm.enabled": false,
			"nexus.embeddings.enabled": false,
		});
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		const session = {
			settings,
			sessionManager: {
				getCwd: () => cwd,
				getSessionId: () => "sess-tool-call-only",
			},
			agent: {
				state: {
					messages: [{ role: "user", content: "Remember only if the assistant produced natural language." }],
				},
			},
		} as any;

		nexusBackend.onTurnEnd?.(session, {
			type: "turn_end",
			message: { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: {} }] },
		} as any);
		await Bun.sleep(50);

		const store = new NexusStore({ agentDir, cwd });
		try {
			expect(store.list({ scope: "all", limit: 10 })).toHaveLength(0);
		} finally {
			store.close();
		}
	});
});
it("bounds startup knowledge maintenance with the configured interval", async () => {
	const agentDir = await makeTempDir("nexus-backend-maintenance-agent");
	const cwd = await makeTempDir("nexus-backend-maintenance-cwd");
	await fs.mkdir(path.join(cwd, "src"), { recursive: true });
	await Bun.write(path.join(cwd, "src", "one.ts"), "export const one = 1;\n");
	const settings = Settings.isolated({
		"memory.backend": "nexus",
		"nexus.llm.enabled": false,
		"nexus.embeddings.enabled": false,
		"nexus.knowledge.enabled": true,
		"nexus.knowledge.maxIndexedFiles": 10,
		"nexus.knowledge.maintenanceMinIntervalMs": 60_000,
	});
	Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
	const session = {
		sessionManager: {
			getCwd: () => cwd,
			getSessionFile: () => null,
			getSessionDir: () => path.join(agentDir, "sessions"),
		},
		settings,
		agent: { metadataForProvider: () => undefined },
	} as any;
	await nexusBackend.start({ session, settings, modelRegistry: {} as any, agentDir, taskDepth: 0 });
	const maintenanceStatePath = path.join(getNexusRoot(agentDir), "knowledge-maintenance.json");
	const firstStateText = await Bun.file(maintenanceStatePath).text();
	expect(firstStateText).toContain('"indexedFiles": 1');
	const firstMtime = (await fs.stat(maintenanceStatePath)).mtimeMs;
	await Bun.sleep(20);
	await nexusBackend.start({ session, settings, modelRegistry: {} as any, agentDir, taskDepth: 0 });
	const secondMtime = (await fs.stat(maintenanceStatePath)).mtimeMs;
	expect(secondMtime).toBe(firstMtime);
});
it("emits a live memory activity message without adding LLM context text", async () => {
	const agentDir = await makeTempDir("nexus-backend-activity-agent");
	const cwd = await makeTempDir("nexus-backend-activity-cwd");
	await fs.mkdir(path.join(cwd, "src"), { recursive: true });
	await Bun.write(path.join(cwd, "src", "memory.ts"), "export const memory = true;\n");
	const settings = Settings.isolated({
		"memory.backend": "nexus",
		"nexus.llm.enabled": false,
		"nexus.embeddings.enabled": false,
		"nexus.knowledge.enabled": true,
		"nexus.knowledge.maxIndexedFiles": 10,
		"nexus.knowledge.maintenanceMinIntervalMs": 0,
	});
	Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
	const emitted: Array<{ customType: string; content: string; display: boolean }> = [];
	const session = {
		sessionManager: {
			getCwd: () => cwd,
			getSessionFile: () => null,
			getSessionDir: () => path.join(agentDir, "sessions"),
		},
		agent: { metadataForProvider: () => undefined },
		sendCustomMessage: async (message: { customType: string; content: string; display: boolean }) => {
			emitted.push(message);
		},
	} as any;
	await nexusBackend.start({ session, settings, modelRegistry: {} as any, agentDir, taskDepth: 0 });
	expect(emitted.some(message => message.customType === "memory-activity" && message.display)).toBe(true);
	expect(emitted.some(message => /indexed/i.test(message.content))).toBe(true);
});
