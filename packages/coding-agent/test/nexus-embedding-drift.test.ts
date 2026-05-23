import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NexusStore } from "../src/nexus/store";

async function withStore<T>(fn: (store: NexusStore, agentDir: string, cwd: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-emb-drift-"));
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

describe("embedding model drift", () => {
	it("flags rows with mismatched embedding_model when active model differs", async () => {
		await withStore(async store => {
			const a = store.add({ target: "project", content: "alpha row", memoryType: "workflow" });
			const b = store.add({ target: "project", content: "beta row", memoryType: "workflow" });
			expect(a.entry && b.entry).toBeTruthy();
			store.addEmbedding(a.entry!.id, new Float32Array([0.1, 0.2, 0.3]), "old-model");
			store.addEmbedding(b.entry!.id, new Float32Array([0.4, 0.5, 0.6]), "old-model");
			const drift = store.listMissingOrStaleEmbeddings(10, "new-model");
			expect(drift.length).toBe(2);
			for (const row of drift) expect(row.reason).toBe("stale_model");
		});
	});

	it("returns missing rows ahead of stale_model rows", async () => {
		await withStore(async store => {
			const a = store.add({ target: "project", content: "with-emb", memoryType: "workflow" });
			expect(a.entry).toBeTruthy();
			store.addEmbedding(a.entry!.id, new Float32Array([0.1]), "old");
			store.add({ target: "project", content: "no-emb", memoryType: "workflow" });
			const rows = store.listMissingOrStaleEmbeddings(10, "new");
			expect(rows[0].reason).toBe("missing");
		});
	});

	it("reports zero drift when active model matches", async () => {
		await withStore(async store => {
			const a = store.add({ target: "project", content: "hello", memoryType: "workflow" });
			expect(a.entry).toBeTruthy();
			store.addEmbedding(a.entry!.id, new Float32Array([0.1]), "current");
			const rows = store.listMissingOrStaleEmbeddings(10, "current");
			expect(rows.length).toBe(0);
		});
	});
});
