import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NexusStore } from "@amaze/coding-agent/nexus/store";

async function withStore<T>(fn: (store: NexusStore) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-lexical-"));
	const cwd = path.join(dir, "repo");
	await fs.mkdir(cwd, { recursive: true });
	const store = new NexusStore({ agentDir: dir, cwd });
	try {
		return await fn(store);
	} finally {
		store.close();
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function addText(store: NexusStore, content: string): void {
	const result = store.add({ target: "project", content, memoryType: "workflow" });
	expect(result.success).toBe(true);
}

describe("lexical contradiction scoring without embeddings", () => {
	it("does not create contradictions for complementary same-subject text", async () => {
		await withStore(async store => {
			addText(store, "Editor: use hashline for precise edits");
			addText(store, "Editor: run LSP diagnostics after writes");

			const result = store.runSelfHealing({});

			expect(result.contradictions).toBe(0);
		});
	});

	it("creates contradictions for hard lexical opposition", async () => {
		await withStore(async store => {
			addText(store, "Rule: Always close the file");
			addText(store, "Rule: Never close the file");

			const result = store.runSelfHealing({});

			expect(result.contradictions).toBe(1);
		});
	});
});
