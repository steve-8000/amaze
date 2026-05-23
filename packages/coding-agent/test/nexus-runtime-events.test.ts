import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getNexusDbPath, openNexusDb, recentRuntimeEvents, recordRuntimeEvent } from "../src/nexus/store";

async function withDb<T>(fn: (agentDir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-rt-"));
	try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

describe("runtime events", () => {
	it("persists and lists events newest first", async () => {
		await withDb(async agentDir => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				recordRuntimeEvent(db, { kind: "a", severity: "info", message: "first" });
				recordRuntimeEvent(db, { kind: "b", severity: "warn", message: "second", context: { x: 1 } });
				recordRuntimeEvent(db, { kind: "c", severity: "error", message: "third" });
				const rows = recentRuntimeEvents(db, 10);
				expect(rows.length).toBe(3);
				expect(rows[0].kind).toBe("c");
				expect(rows[1].context).toEqual({ x: 1 });
			} finally { db.close(false); }
		});
	});

	it("truncates over-long messages without throwing", async () => {
		await withDb(async agentDir => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				recordRuntimeEvent(db, { kind: "long", severity: "warn", message: "x".repeat(10000) });
				const rows = recentRuntimeEvents(db, 1);
				expect(rows[0].message.length).toBeLessThanOrEqual(4000);
			} finally { db.close(false); }
		});
	});

	it("rejects invalid severity via CHECK constraint", async () => {
		await withDb(async agentDir => {
			const db = openNexusDb(getNexusDbPath(agentDir));
			try {
				expect(() => db.prepare("INSERT INTO memory_runtime_events(kind,severity,message,created_at) VALUES (?,?,?,?)").run("bad", "critical", "x", "now")).toThrow();
			} finally { db.close(false); }
		});
	});
});
