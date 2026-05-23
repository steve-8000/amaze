import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getNexusDbPath, NexusStore, openNexusDb, recentStageStats, recordPipelineStage } from "../src/nexus/store";

async function withStore<T>(fn: (store: NexusStore, agentDir: string, cwd: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-debt-"));
	const cwd = path.join(dir, "repo");
	await fs.mkdir(cwd, { recursive: true });
	const store = new NexusStore({ agentDir: dir, cwd });
	try {
		return await fn(store, dir, cwd);
	} finally {
		store.close();
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("memory_relations CHECK trigger", () => {
	it("rejects invalid relation values", async () => {
		await withStore(async (_store, agentDir) => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				expect(() =>
					db
						.prepare("INSERT INTO memory_relations(from_id,to_id,relation,created_at) VALUES (?,?,?,?)")
						.run("a", "b", "bogus", "now"),
				).toThrow(/invalid memory_relations\.relation/);
			} finally {
				db.close(false);
			}
		});
	});

	it("accepts the six known relation values", async () => {
		await withStore(async (_store, agentDir) => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				for (const rel of ["supports", "contradicts", "supersedes", "duplicate_of", "generalizes", "specializes"]) {
					expect(() =>
						db
							.prepare(
								"INSERT OR REPLACE INTO memory_relations(from_id,to_id,relation,created_at) VALUES (?,?,?,?)",
							)
							.run("a", `b-${rel}`, rel, "now"),
					).not.toThrow();
				}
			} finally {
				db.close(false);
			}
		});
	});
});

describe("pipeline stage stats", () => {
	it("records and aggregates stage durations", async () => {
		await withStore(async (_store, agentDir) => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				recordPipelineStage(db, {
					kind: "pipeline",
					jobKey: "r1:ingest",
					stage: "ingest",
					durationMs: 100,
					llmCalls: 1,
					status: "success",
				});
				recordPipelineStage(db, {
					kind: "pipeline",
					jobKey: "r2:ingest",
					stage: "ingest",
					durationMs: 200,
					llmCalls: 2,
					status: "success",
				});
				recordPipelineStage(db, {
					kind: "pipeline",
					jobKey: "r1:embed",
					stage: "embed",
					durationMs: 50,
					embedCalls: 5,
					status: "success",
				});
				const stats = recentStageStats(db, 50);
				const byName = Object.fromEntries(stats.map(s => [s.stage, s]));
				expect(byName.ingest.count).toBe(2);
				expect(byName.ingest.avgDurationMs).toBe(150);
				expect(byName.ingest.totalLlmCalls).toBe(3);
				expect(byName.embed.totalEmbedCalls).toBe(5);
			} finally {
				db.close(false);
			}
		});
	});
});
