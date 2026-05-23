import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateKnowledgeIntoSeparateDb } from "../src/nexus/knowledge/migration";
import { NexusKnowledgeStore } from "../src/nexus/knowledge/store";
import { getNexusDbPath, getNexusKnowledgeDbPath, getNexusRoot, openNexusDb } from "../src/nexus/store";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-kn-mig-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("knowledge db migration", () => {
	it("is a no-op when no operational db exists", async () => {
		await withDir(async dir => {
			const result = migrateKnowledgeIntoSeparateDb(dir);
			expect(result.skipped).toBe(true);
			expect(result.reason).toBe("no_operational_db");
		});
	});

	it("is a no-op when operational db has no knowledge_* tables", async () => {
		await withDir(async dir => {
			const db = openNexusDb(getNexusDbPath(dir));
			db.close(false);

			const result = migrateKnowledgeIntoSeparateDb(dir);
			expect(result.skipped).toBe(true);
			expect(result.reason).toBe("no_knowledge_in_operational");

			const markerPath = path.join(getNexusRoot(dir), "knowledge-db.migrated.json");
			expect(fsSync.existsSync(markerPath)).toBe(true);
		});
	});

	it("moves knowledge rows from legacy nexus.db to nexus-knowledge.db", async () => {
		await withDir(async dir => {
			const legacy = openNexusDb(getNexusDbPath(dir));
			try {
				const tempStore = new NexusKnowledgeStore({ agentDir: dir, cwd: dir, dbPath: getNexusDbPath(dir) });
				try {
					tempStore.upsertDocument({
						repoRoot: dir,
						path: "file.ts",
						absolutePath: path.join(dir, "file.ts"),
						kind: "code",
						language: "typescript",
						contentHash: "hash-1",
						sizeBytes: 10,
						chunks: [{ chunkIndex: 0, startLine: 1, endLine: 1, content: "console.log(1);", contentHash: "chunk-hash-1" }],
						symbols: [],
					});
				} finally {
					tempStore.close();
				}
			} finally {
				legacy.close(false);
			}

			const markerPath = path.join(getNexusRoot(dir), "knowledge-db.migrated.json");
			if (fsSync.existsSync(markerPath)) fsSync.unlinkSync(markerPath);

			const result = migrateKnowledgeIntoSeparateDb(dir);
			expect(result.skipped).toBe(false);
			expect(result.migrated).toBeGreaterThan(0);

			const knDb = openNexusDb(getNexusKnowledgeDbPath(dir));
			try {
				const rows = knDb.prepare("SELECT COUNT(*) AS c FROM knowledge_documents").get() as { c: number };
				expect(rows.c).toBeGreaterThan(0);
			} finally {
				knDb.close(false);
			}

			const opDb = openNexusDb(getNexusDbPath(dir));
			try {
				const remaining = opDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'knowledge_%'").all();
				expect(remaining.length).toBe(0);
			} finally {
				opDb.close(false);
			}

			expect(fsSync.existsSync(markerPath)).toBe(true);
		});
	});

	it("is idempotent: second migration is a no-op", async () => {
		await withDir(async dir => {
			const db = openNexusDb(getNexusDbPath(dir));
			db.close(false);

			migrateKnowledgeIntoSeparateDb(dir);
			const second = migrateKnowledgeIntoSeparateDb(dir);
			expect(second.skipped).toBe(true);
			expect(second.reason).toBe("marker_present");
		});
	});
});
