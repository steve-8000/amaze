import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hashFileContent, KnowledgeStore } from "../../src/memory/knowledge-store";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function createStore(): KnowledgeStore {
	const store = new KnowledgeStore(":memory:");
	cleanups.push(() => store.close());
	return store;
}

function tempDir(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-knowledge-"));
	cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

describe("KnowledgeStore", () => {
	test("rejects items without provenance", () => {
		const store = createStore();
		expect(() =>
			store.record({
				scope: "repo",
				claim: "unsourced claim",
				sourceRefs: [],
				confidence: "high",
				filePath: null,
				contentHash: null,
				supersedes: null,
			}),
		).toThrow("provenance");
	});

	test("supersession links the revision chain and hides the old item", () => {
		const store = createStore();
		const v1 = store.record({
			scope: "repo",
			claim: "TaskTool runs subagents in-process",
			sourceRefs: ["src/task/executor.ts:2-4"],
			confidence: "high",
			filePath: null,
			contentHash: null,
			supersedes: null,
		});
		const v2 = store.record({
			scope: "repo",
			claim: "TaskTool routes subagents through SubagentWorker",
			sourceRefs: ["src/task/worker.ts"],
			confidence: "high",
			filePath: null,
			contentHash: null,
			supersedes: v1.id,
		});

		expect(store.get(v1.id)?.supersededBy).toBe(v2.id);
		const active = store.query({ scope: "repo" });
		expect(active.map(item => item.id)).toEqual([v2.id]);
		// Inactive retrieval still surfaces the full chain.
		const all = store.query({ scope: "repo", activeOnly: false });
		expect(all).toHaveLength(2);
	});

	test("invalidateStale marks items whose backing file drifted", () => {
		const store = createStore();
		const root = tempDir();
		const filePath = "module.ts";
		const absPath = path.join(root, filePath);
		fs.writeFileSync(absPath, "export const a = 1;\n");

		const fresh = store.record({
			scope: "repo",
			claim: "module exports a = 1",
			sourceRefs: [filePath],
			confidence: "high",
			filePath,
			contentHash: hashFileContent(absPath),
			supersedes: null,
		});

		// Unchanged file: nothing stale.
		expect(store.invalidateStale(root)).toHaveLength(0);

		// Drift the file: the item must become stale and leave active retrieval.
		fs.writeFileSync(absPath, "export const a = 2;\n");
		const stale = store.invalidateStale(root);
		expect(stale.map(item => item.id)).toEqual([fresh.id]);
		expect(store.get(fresh.id)?.staleAt).not.toBeNull();
		expect(store.query({ scope: "repo" })).toHaveLength(0);
	});

	test("query filters by claim substring and file path", () => {
		const store = createStore();
		store.record({
			scope: "mission",
			claim: "budget gate wired at agent_end",
			sourceRefs: ["mission-1"],
			confidence: "medium",
			filePath: null,
			contentHash: null,
			supersedes: null,
		});
		store.record({
			scope: "repo",
			claim: "continuation policy lives in policy.ts",
			sourceRefs: ["src/mission/continuation/policy.ts"],
			confidence: "high",
			filePath: "src/mission/continuation/policy.ts",
			contentHash: null,
			supersedes: null,
		});

		expect(store.query({ claimLike: "budget" })).toHaveLength(1);
		expect(store.query({ filePath: "src/mission/continuation/policy.ts" })).toHaveLength(1);
		expect(store.query({ scope: "global" })).toHaveLength(0);
	});
});
