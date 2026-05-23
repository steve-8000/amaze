import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runMemoryMigrateLegacyCommand } from "../../src/cli/memory";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

async function withTempHome(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-memory-migrate-"));
	tempRoots.push(root);
	process.env.HOME = root;
	return root;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	let stdout = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
	} finally {
		process.stdout.write = originalWrite;
	}
	return stdout;
}

afterEach(async () => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("memory migrate-legacy", () => {
	it("exits successfully when no legacy fixture exists", async () => {
		await withTempHome();

		const stdout = await captureStdout(() => runMemoryMigrateLegacyCommand({ from: "rockey" }));

		expect(stdout).toContain("no legacy data");
	});

	it("counts rockey fixture rows in dry-run mode", async () => {
		const home = await withTempHome();
		const legacyDir = path.join(home, ".rockey");
		await fs.mkdir(legacyDir, { recursive: true });
		const dbPath = path.join(legacyDir, "legacy.db");
		const db = new Database(dbPath);
		try {
			db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL)");
			db.query("INSERT INTO memories (id, content) VALUES (?, ?)").run("m1", "remember this legacy fact");
		} finally {
			db.close(false);
		}

		const stdout = await captureStdout(() => runMemoryMigrateLegacyCommand({ from: "rockey", dryRun: true }));

		expect(stdout).toContain("would import 1 legacy rockey item");
	});

	it("documents that legacy backend data is not imported automatically", async () => {
		const docs = await Bun.file(path.join(import.meta.dir, "../../../../docs/memory.md")).text();

		expect(docs).toContain("Legacy backend data is not imported automatically");
	});
});
