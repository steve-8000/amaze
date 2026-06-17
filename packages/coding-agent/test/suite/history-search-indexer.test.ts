import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexSessions } from "../../src/core/extensions/builtin/history-search/indexer.ts";
import {
	BASE_TIME,
	createTempRootRegistry,
	sessionLine,
	userLine,
	writeSessionFile,
} from "./history-search-fixtures.ts";

const tempRoots = createTempRootRegistry();

afterEach(async () => {
	await tempRoots.cleanup();
});

describe("indexSessions", () => {
	it("returns empty arrays for missing or empty session dirs", async () => {
		const root = await tempRoots.make();
		expect(await indexSessions(join(root, "missing"))).toEqual([]);
		const empty = join(root, "sessions");
		await mkdir(empty);
		expect(await indexSessions(empty)).toEqual([]);
	});

	it("parses a single jsonl user prompt", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		const file = await writeSessionFile(sessionsDir, "20260520_session-1.jsonl", [
			sessionLine("session-1", "/repo", BASE_TIME),
			userLine(["ship it"], BASE_TIME + 2_000),
		]);

		expect(await indexSessions(sessionsDir)).toEqual([
			{ text: "ship it", sessionId: "session-1", sessionFile: file, cwd: "/repo", timestamp: BASE_TIME + 2_000 },
		]);
	});

	it("skips injected, empty, and malformed prompt lines", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		await writeSessionFile(sessionsDir, "session.jsonl", [
			sessionLine(),
			"{malformed",
			userLine(["[SYSTEM DIRECTIVE: hidden]"], BASE_TIME + 1_000),
			userLine(["[system:agentika:user.input]\nsecret"], BASE_TIME + 2_000),
			userLine(["[SYSTEM hidden]"], BASE_TIME + 3_000),
			userLine(["   \n\t"], BASE_TIME + 4_000),
			userLine(["visible"], BASE_TIME + 5_000),
		]);

		expect((await indexSessions(sessionsDir)).map((item) => item.text)).toEqual(["visible"]);
	});

	it("concatenates text parts, sorts newest first, and deduplicates newest text", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		await writeSessionFile(sessionsDir, "older.jsonl", [
			sessionLine("older"),
			userLine(["multi", "part"], BASE_TIME + 1_000),
			userLine(["duplicate"], BASE_TIME + 2_000),
		]);
		await writeSessionFile(sessionsDir, "newer.jsonl", [
			sessionLine("newer"),
			userLine(["duplicate"], BASE_TIME + 4_000),
			userLine(["latest"], BASE_TIME + 5_000),
		]);

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toEqual(["latest", "duplicate", "multi\npart"]);
		expect(entries.find((item) => item.text === "duplicate")?.sessionId).toBe("newer");
	});

	it("caps indexed entries at 10000 and keeps newest prompts when over cap", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		const lines = [sessionLine("bulk")];
		for (let index = 0; index < 10_005; index++) lines.push(userLine([`prompt ${index}`], BASE_TIME + index));
		await writeSessionFile(sessionsDir, "bulk.jsonl", lines);

		const entries = await indexSessions(sessionsDir);
		expect(entries).toHaveLength(10_000);
		const texts = new Set(entries.map((entry) => entry.text));
		expect(texts.has("prompt 10004")).toBe(true);
		expect(texts.has("prompt 0")).toBe(false);
	});

	it("accepts legacy string content for user messages", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		const stringMessage = JSON.stringify({
			type: "message",
			id: "msg-legacy",
			parentId: "parent",
			timestamp: new Date(BASE_TIME + 2_000).toISOString(),
			message: { role: "user", content: "legacy string prompt" },
		});
		await writeSessionFile(sessionsDir, "legacy.jsonl", [
			sessionLine("legacy", "/repo", BASE_TIME),
			stringMessage,
			userLine(["structured prompt"], BASE_TIME + 3_000),
		]);

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((entry) => entry.text)).toEqual(["structured prompt", "legacy string prompt"]);
	});

	it("indexes .jsonl files at the top level (custom session dir layout)", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "custom");
		await mkdir(sessionsDir);
		const flatFile = join(sessionsDir, "20260520_flat-session.jsonl");
		await writeFile(
			flatFile,
			[sessionLine("flat-session", "/repo", BASE_TIME), userLine(["flat prompt"], BASE_TIME + 1_000)].join("\n"),
			"utf-8",
		);

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toEqual(["flat prompt"]);
		expect(entries[0]?.sessionFile).toBe(flatFile);
	});

	it("prioritizes newest filenames globally across cwd subdirs when capping", async () => {
		const root = await tempRoots.make();
		const sessionsDir = join(root, "sessions");
		const olderDir = join(sessionsDir, "aaaaa-old-cwd");
		const newerDir = join(sessionsDir, "zzzzz-new-cwd");
		await mkdir(olderDir, { recursive: true });
		await mkdir(newerDir, { recursive: true });

		const olderLines = [sessionLine("old-bulk", "/old", BASE_TIME)];
		for (let index = 0; index < 10_000; index++) {
			olderLines.push(userLine([`old prompt ${index}`], BASE_TIME + index));
		}
		await writeFile(join(olderDir, "20260101_old-bulk.jsonl"), olderLines.join("\n"), "utf-8");

		const newerLines = [
			sessionLine("new-recent", "/new", BASE_TIME + 1_000_000),
			userLine(["fresh prompt"], BASE_TIME + 2_000_000),
		];
		await writeFile(join(newerDir, "20260901_new-recent.jsonl"), newerLines.join("\n"), "utf-8");

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toContain("fresh prompt");
	});
});
