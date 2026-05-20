import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { AgentRegistry } from "../../src/registry/agent-registry";
import { reindexRockeySessions } from "../../src/rockey/session-search";
import { RockeyStore, resolveRockeyScope } from "../../src/rockey/store";
import { createTools, type ToolSession } from "../../src/tools";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-tools-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createTestSession(agentDir: string, cwd: string, overrides: Partial<ToolSession> = {}): ToolSession {
	const settings = Settings.isolated({ "memory.backend": "rockey" });
	settings.getAgentDir = () => agentDir;
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings,
		...overrides,
	};
}

describe("Rockey tools", () => {
	it("are available only through the rockey backend and can write then search memory", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const tools = await createTools(createTestSession(agentDir, cwd), ["memory", "memory_search"]);
			const memory = tools.find(tool => tool.name === "memory");
			const search = tools.find(tool => tool.name === "memory_search");

			expect(memory).toBeDefined();
			expect(search).toBeDefined();

			await memory!.execute("1", {
				action: "add",
				target: "project",
				content: "Use Rockey tests for memory behavior.",
			});
			const result = await search!.execute("2", { query: "Rockey tests" });
			expect(result.content[0]?.type).toBe("text");
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toContain("Use Rockey tests for memory behavior.");
		});
	});
	it("includes anchor-first session_search results", async () => {
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
						message: { role: "user", content: [{ type: "text", text: "Rockey anchor search example" }] },
					}),
				].join("\n"),
			);
			await reindexRockeySessions(agentDir);
			const tools = await createTools(createTestSession(agentDir, cwd), ["session_search"]);
			const sessionSearch = tools.find(tool => tool.name === "session_search");
			expect(sessionSearch).toBeDefined();
			const result = await sessionSearch!.execute("1", { query: "anchor search" });
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toContain("anchors:");
			expect(text).toContain(".jsonl");
		});
	});
	it("routes subagent project memory writes to the parent project scope", async () => {
		await withTempDir(async agentDir => {
			const parentCwd = path.join(agentDir, "repo");
			const subagentCwd = path.join(agentDir, "repo-subagent");
			await fs.mkdir(parentCwd, { recursive: true });
			await fs.mkdir(subagentCwd, { recursive: true });
			const registry = new AgentRegistry();
			registry.register({
				id: "0-Main",
				displayName: "main",
				kind: "main",
				session: {
					sessionManager: { getCwd: () => parentCwd },
				} as never,
			});
			registry.register({
				id: "0-Sub",
				displayName: "sub",
				kind: "sub",
				parentId: "0-Main",
				session: null,
			});
			const tools = await createTools(
				createTestSession(agentDir, subagentCwd, {
					taskDepth: 1,
					agentRegistry: registry,
					getAgentId: () => "0-Sub",
				}),
				["memory"],
			);
			const memory = tools.find(tool => tool.name === "memory");
			expect(memory).toBeDefined();
			await memory!.execute("1", { action: "add", target: "project", content: "Shared parent project convention." });
			const parentStore = new RockeyStore({ agentDir, cwd: parentCwd });
			const subagentStore = new RockeyStore({ agentDir, cwd: subagentCwd });
			try {
				const parentEntries = parentStore.search({
					query: "Shared parent project",
					scope: resolveRockeyScope(parentCwd),
					includeGlobal: false,
					limit: 10,
				});
				const subagentEntries = subagentStore.search({
					query: "Shared parent project",
					scope: resolveRockeyScope(subagentCwd),
					includeGlobal: false,
					limit: 10,
				});
				expect(parentEntries.map(entry => entry.content)).toEqual(["Shared parent project convention."]);
				expect(subagentEntries).toEqual([]);
			} finally {
				parentStore.close();
				subagentStore.close();
			}
		});
	});
});
