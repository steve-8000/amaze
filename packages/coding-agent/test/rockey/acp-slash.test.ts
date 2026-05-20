import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { reindexRockeySessions } from "../../src/rockey/session-search";
import { executeAcpBuiltinSlashCommand } from "../../src/slash-commands/acp-builtins";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-acp-slash-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createRuntime(agentDir: string, cwd: string) {
	const output: string[] = [];
	const settings = Settings.isolated({ "memory.backend": "rockey" });
	settings.getAgentDir = () => agentDir;
	const session = {
		refreshBaseSystemPrompt: async () => {},
		modelRegistry: undefined,
	};
	return {
		output,
		runtime: {
			session,
			sessionManager: {
				getCwd: () => cwd,
			} as never,
			settings,
			cwd,
			output: async (text: string) => {
				output.push(text);
			},
			refreshCommands: () => {},
			reloadPlugins: async () => {},
			notifyTitleChanged: undefined,
			notifyConfigChanged: undefined,
		},
	};
}

describe("Rockey ACP slash commands", () => {
	it("runs /memory doctor for the rockey backend", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const { output, runtime } = createRuntime(agentDir, cwd);
			const result = await executeAcpBuiltinSlashCommand("/memory doctor", runtime as never);
			expect(result).toEqual({ consumed: true });
			expect(output[0]).toContain("Rockey Doctor:");
		});
	});

	it("runs /memory session-search with anchor-first output", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "test-project");
			await fs.mkdir(sessionDir, { recursive: true });
			await Bun.write(
				path.join(sessionDir, "2026-05-20_test.jsonl"),
				[
					JSON.stringify({ type: "session", id: "sess-1", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						id: "m1",
						parentId: null,
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "doctor anchor example" }] },
					}),
				].join("\n"),
			);
			await reindexRockeySessions(agentDir);
			const { output, runtime } = createRuntime(agentDir, cwd);
			const result = await executeAcpBuiltinSlashCommand("/memory session-search anchor example", runtime as never);
			expect(result).toEqual({ consumed: true });
			expect(output[0]).toContain("anchors:");
		});
	});
});
