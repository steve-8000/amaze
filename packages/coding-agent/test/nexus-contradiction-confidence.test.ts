import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NexusStore } from "../src/nexus/store";

async function withStore<T>(threshold: number, fn: (store: NexusStore) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-contradict-"));
	const cwd = path.join(dir, "repo");
	await fs.mkdir(cwd, { recursive: true });
	const store = new NexusStore({ agentDir: dir, cwd, contradictionThreshold: threshold });
	try {
		return await fn(store);
	} finally {
		store.close();
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function addedId(result: ReturnType<NexusStore["add"]>): string {
	expect(result.success).toBe(true);
	expect(result.entry).toBeDefined();
	return result.entry!.id;
}

describe("contradiction confidence scoring", () => {
	it("marks contradiction when lexical-similar content with embedding agreement", async () => {
		await withStore(0.7, async store => {
			const a = addedId(store.add({ target: "project", content: "build: is fast", memoryType: "note" }));
			const b = addedId(store.add({ target: "project", content: "build: is slow", memoryType: "note" }));
			store.addEmbedding(a, new Float32Array([0.5, 0.5, 0.5]), "m");
			store.addEmbedding(b, new Float32Array([0.5, 0.5, 0.5]), "m");
			const result = store.runSelfHealing({});
			expect(result.contradictions).toBeGreaterThan(0);
		});
	});

	it("does NOT mark contradiction when embeddings disagree strongly", async () => {
		await withStore(0.7, async store => {
			const a = addedId(store.add({ target: "project", content: "build: is fast", memoryType: "note" }));
			const b = addedId(store.add({ target: "project", content: "build: is slow", memoryType: "note" }));
			store.addEmbedding(a, new Float32Array([1, 0, 0]), "m");
			store.addEmbedding(b, new Float32Array([-1, 0, 0]), "m");
			const result = store.runSelfHealing({});
			expect(result.contradictions).toBe(0);
		});
	});

	it("respects threshold (high threshold suppresses all)", async () => {
		await withStore(0.99, async store => {
			store.add({ target: "project", content: "build: is fast", memoryType: "note" });
			store.add({ target: "project", content: "build: is slow", memoryType: "note" });
			const result = store.runSelfHealing({});
			expect(result.contradictions).toBe(0);
		});
	});
});
