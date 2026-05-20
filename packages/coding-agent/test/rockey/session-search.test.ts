import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { reindexRockeySessions, searchRockeySessionAnchors } from "../../src/rockey/session-search";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockey-session-search-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("Rockey session search", () => {
	it("indexes session transcripts and returns bounded anchors", async () => {
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
						message: { role: "user", content: [{ type: "text", text: "Use bun check for Rockey validation." }] },
					}),
				].join("\n"),
			);
			const settings = Settings.isolated({ "rockey.sessionSearchMaxAnchors": 8 });
			await reindexRockeySessions(agentDir);
			const result = searchRockeySessionAnchors(agentDir, cwd, settings, "Rockey validation", {
				scope: "current_project",
			});
			expect(result.anchors).toHaveLength(1);
			expect(result.text).toContain(sessionFile);
			expect(result.text).toContain("Rockey validation");
		});
	});
});
