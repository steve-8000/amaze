import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { getNexusSessionDbPath, reindexNexusSessions, searchNexusSessionAnchors } from "../../src/nexus/session-search";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-session-index-hash-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function sessionText(cwd: string, content: string): string {
	return [
		JSON.stringify({ type: "session", id: "sess-hash", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
		JSON.stringify({
			type: "message",
			timestamp: "2026-05-20T00:01:00.000Z",
			message: { role: "user", content: [{ type: "text", text: content }] },
		}),
	].join("\n");
}

describe("Nexus session index hashing", () => {
	it("reindexes same-size session files when content hash changes", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "p");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "s.jsonl");
			const firstText = sessionText(cwd, "alpha token");
			const secondText = sessionText(cwd, "bravo token");
			expect(secondText.length).toBe(firstText.length);
			await Bun.write(sessionFile, firstText);

			const first = await reindexNexusSessions(agentDir);
			expect(first).toEqual({ indexed: 1, skipped: 0 });

			await Bun.write(sessionFile, secondText);
			const second = await reindexNexusSessions(agentDir);
			expect(second).toEqual({ indexed: 1, skipped: 0 });

			const settings = Settings.isolated();
			const oldResult = searchNexusSessionAnchors(agentDir, cwd, settings, "alpha");
			const newResult = searchNexusSessionAnchors(agentDir, cwd, settings, "bravo");
			expect(oldResult.anchors).toHaveLength(0);
			expect(newResult.anchors).toHaveLength(1);
		});
	});

	it("backfills missing trigram rows without skipping partially populated indexes", async () => {
		await withTempDir(async agentDir => {
			const cwd = path.join(agentDir, "repo");
			await fs.mkdir(cwd, { recursive: true });
			const sessionDir = path.join(agentDir, "sessions", "p");
			await fs.mkdir(sessionDir, { recursive: true });
			const sessionFile = path.join(sessionDir, "s.jsonl");
			await Bun.write(
				sessionFile,
				[
					JSON.stringify({ type: "session", id: "sess-trigram", timestamp: "2026-05-20T00:00:00.000Z", cwd }),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:01:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "메모리 첫번째" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-05-20T00:02:00.000Z",
						message: { role: "user", content: [{ type: "text", text: "검색 두번째" }] },
					}),
				].join("\n"),
			);
			await reindexNexusSessions(agentDir);
			let messageIds: number[] = [];

			const db = new Database(getNexusSessionDbPath(agentDir));
			try {
				const messages = db.prepare("SELECT id, content FROM nexus_session_messages ORDER BY id").all() as Array<{
					id: number;
					content: string;
				}>;
				messageIds = messages.map(message => message.id);
				db.exec("DROP TABLE nexus_session_fts_trigram");
				db.exec(`
					CREATE VIRTUAL TABLE nexus_session_fts_trigram USING fts5(content, tokenize='trigram');
				`);
				db.prepare("INSERT INTO nexus_session_fts_trigram(rowid, content) VALUES (?, ?)").run(
					messages[0].id,
					messages[0].content,
				);
				const partialIds = (
					db.prepare("SELECT rowid FROM nexus_session_fts_trigram ORDER BY rowid").all() as Array<{
						rowid: number;
					}>
				).map(row => row.rowid);
				expect(partialIds).toEqual([messages[0].id]);
			} finally {
				db.close(false);
			}

			await reindexNexusSessions(agentDir);

			const dbAfter = new Database(getNexusSessionDbPath(agentDir));
			try {
				const restoredIds = (
					dbAfter.prepare("SELECT rowid FROM nexus_session_fts_trigram ORDER BY rowid").all() as Array<{
						rowid: number;
					}>
				).map(row => row.rowid);
				expect(restoredIds).toEqual(messageIds);
			} finally {
				dbAfter.close(false);
			}
		});
	});
});
