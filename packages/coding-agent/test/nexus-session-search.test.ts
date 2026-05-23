import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { reindexNexusSessions, searchNexusSessionAnchors } from "../src/nexus/session-search";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-session-search-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("Nexus session search", () => {
	it("indexes session transcripts and returns bounded anchors scoped to project", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "test-project");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "2026-05-20_test.jsonl");
			await Bun.write(
				sessionFile,
				[
					JSON.stringify({ type: "session", id: "sess-1", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						id: "m1",
						parentId: null,
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "Use bun check for Nexus validation." }] },
					}),
				].join("\n"),
			);
			const settings = Settings.isolated({ "nexus.sessionSearchMaxAnchors": 8 });
			await reindexNexusSessions(agentDir);
			const result = searchNexusSessionAnchors(agentDir, cwd, settings, "Nexus validation", {
				scope: "current_project",
			});
			expect(result.anchors).toHaveLength(1);
			expect(result.text).toContain(sessionFile);
			expect(result.text).toContain("Nexus validation");
		});
	});

	it("reindex is idempotent: skips unchanged files on rerun", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "p");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "s.jsonl");
			await Bun.write(
				sessionFile,
				[
					JSON.stringify({ type: "session", id: "sess-x", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "first turn" }] },
					}),
				].join("\n"),
			);
			const first = await reindexNexusSessions(agentDir);
			expect(first.indexed).toBe(1);
			expect(first.skipped).toBe(0);
			const second = await reindexNexusSessions(agentDir);
			expect(second.indexed).toBe(0);
			expect(second.skipped).toBe(1);
		});
	});

	it("returns empty result for missing or whitespace query", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const settings = Settings.isolated();
			const result = searchNexusSessionAnchors(agentDir, cwd, settings, "   ");
			expect(result.anchors).toEqual([]);
			expect(result.text).toBe("count: 0");
		});
	});

	it("returns prev/next line context around hit", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "p");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "s.jsonl");
			await Bun.write(
				sessionFile,
				[
					JSON.stringify({ type: "session", id: "sess-ctx", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "first line" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:02:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "midmarker uniquetoken" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:03:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "third line" }] },
					}),
				].join("\n"),
			);
			const settings = Settings.isolated();
			await reindexNexusSessions(agentDir);
			const result = searchNexusSessionAnchors(agentDir, cwd, settings, "uniquetoken");
			expect(result.anchors.length).toBeGreaterThan(0);
			const hit = result.anchors[0];
			expect(hit.prevLine).toBeDefined();
			expect(hit.nextLine).toBeDefined();
			expect(hit.prevLine!).toBeLessThan(hit.startLine);
			expect(hit.nextLine!).toBeGreaterThan(hit.endLine);
		});
	});

	it("finds Korean content via trigram", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "p");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "s.jsonl");
			await Bun.write(
				sessionFile,
				[
					JSON.stringify({ type: "session", id: "sess-kr", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "메모리 검색 테스트입니다" }] },
					}),
				].join("\n"),
			);
			const settings = Settings.isolated();
			await reindexNexusSessions(agentDir);
			const result = searchNexusSessionAnchors(agentDir, cwd, settings, "메모리");
			expect(result.anchors.length).toBeGreaterThan(0);
			expect(result.text).toContain("메모리");
		});
	});
});
