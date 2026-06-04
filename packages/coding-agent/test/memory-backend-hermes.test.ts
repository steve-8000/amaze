import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import { hermesBackend } from "@amaze/coding-agent/memory-backend";
import {
	createHermesMemoryConfig,
	getHermesMemories,
	HermesMemoryRuntime,
} from "@amaze/coding-agent/memory-backend/hermes";
import { setAgentDir } from "@amaze/utils";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}
beforeEach(async () => {
	setAgentDir(await tempDir("amaze-hermes-default-agent-"));
});

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function hermesSettings(overrides: Record<string, unknown> = {}) {
	return Settings.isolated({
		"memory.backend": "hermes",
		"memory.hermes.policyStyle": "compact",
		...overrides,
	} as any);
}

function session(settings: Settings, cwd: string, messages: any[] = []) {
	return {
		settings,
		sessionId: "session-1",
		messages,
		sessionManager: { getCwd: () => cwd },
	};
}

async function runtimeFor(settings: Settings, agentDir: string, cwd: string): Promise<HermesMemoryRuntime> {
	const rt = new HermesMemoryRuntime(createHermesMemoryConfig({ settings, agentDir, cwd }));
	await rt.load();
	return rt;
}

describe("Hermes memory backend", () => {
	it("injects a bounded fenced block from local search before agent start", async () => {
		const agentDir = await tempDir("amaze-hermes-agent-");
		const cwd = await tempDir("amaze-hermes-project-");
		setAgentDir(agentDir);
		const settings = hermesSettings();
		const rt = await runtimeFor(settings, agentDir, cwd);
		try {
			await rt.addLocalEntry("Use Hermes local recall for project-specific lifecycle tests.", {
				category: "checkpoint",
				project: cwd,
			});
		} finally {
			rt.close();
		}

		const prompt = await hermesBackend.beforeAgentStartPrompt?.(
			session(settings, cwd) as any,
			"Hermes local recall lifecycle tests",
		);

		expect(prompt).toContain("# Hermes Memory");
		expect(prompt).toContain("<memory-context>");
		expect(prompt).toContain("Use Hermes local recall");
		expect(prompt!.length).toBeLessThanOrEqual(6300);
	});

	it("stores assistant and tool turn-end content as local turn_sync entries", async () => {
		const agentDir = await tempDir("amaze-hermes-agent-");
		const cwd = await tempDir("amaze-hermes-project-");
		setAgentDir(agentDir);
		const settings = hermesSettings();

		await hermesBackend.onTurnEnd?.(
			session(settings, cwd) as any,
			{
				type: "turn_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hermes should locally sync assistant outcomes." }],
				},
				toolResults: [{ role: "tool", content: [{ type: "text", text: "Tool result persisted locally." }] }],
			} as any,
		);

		const rt = await runtimeFor(settings, agentDir, cwd);
		try {
			const entries = getHermesMemories(rt, { category: "turn_sync", project: cwd });
			expect(entries).toHaveLength(1);
			expect(entries[0].content).toContain("Hermes should locally sync assistant outcomes");
			expect(entries[0].content).toContain("Tool result persisted locally");
		} finally {
			rt.close();
		}
	});

	it("captures pre-compaction checkpoints locally and returns a small confirmation", async () => {
		const agentDir = await tempDir("amaze-hermes-agent-");
		const cwd = await tempDir("amaze-hermes-project-");
		setAgentDir(agentDir);
		const settings = hermesSettings();

		const result = await hermesBackend.preCompactionContext?.(
			[{ role: "user", content: "Compression must preserve Hermes lifecycle facts." } as any],
			settings,
			session(settings, cwd) as any,
		);

		expect(result).toContain("pre-compaction checkpoint");
		const rt = await runtimeFor(settings, agentDir, cwd);
		try {
			const entries = getHermesMemories(rt, { category: "checkpoint", project: cwd });
			expect(entries).toHaveLength(1);
			expect(entries[0].content).toContain("Compression must preserve Hermes lifecycle facts");
		} finally {
			rt.close();
		}
	});

	it("clear wipes local state and enqueue performs sync plus a recent checkpoint", async () => {
		const agentDir = await tempDir("amaze-hermes-agent-");
		const cwd = await tempDir("amaze-hermes-project-");
		setAgentDir(agentDir);
		const settings = hermesSettings();
		const rt = await runtimeFor(settings, agentDir, cwd);
		try {
			await rt.add("memory", "Markdown memory should be mirrored before clear.");
		} finally {
			rt.close();
		}

		await hermesBackend.clear(agentDir, cwd, session(settings, cwd) as any);
		const cleared = await runtimeFor(settings, agentDir, cwd);
		try {
			expect(getHermesMemories(cleared)).toHaveLength(0);
		} finally {
			cleared.close();
		}

		await hermesBackend.enqueue(
			agentDir,
			cwd,
			session(settings, cwd, [
				{ role: "assistant", content: "Manual enqueue should checkpoint recent local conversation." } as any,
			]) as any,
		);

		const enqueued = await runtimeFor(settings, agentDir, cwd);
		try {
			const entries = getHermesMemories(enqueued, { category: "checkpoint", project: cwd });
			expect(entries).toHaveLength(1);
			expect(entries[0].content).toContain("Manual enqueue should checkpoint recent local conversation");
		} finally {
			enqueued.close();
		}
	});
});
