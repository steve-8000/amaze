import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CompositeAgiMemory, hasPlanningAuthority, LocalAgiMemory, OkfAgiMemory } from "../../src/agi";
import type { MemoryItem } from "../../src/agi/memory";
import { openRuntimeKnowledge } from "../../src/cognition";
import { Settings } from "../../src/config/settings";
import { KnowledgeStore } from "../../src/memory/knowledge-store";
import { OkfStore } from "../../src/okf/store";

function sourceRef(overrides = {}) {
	return { kind: "evidence" as const, uri: "evidence://1", contentHash: "abc", observedAt: 1, ...overrides };
}

describe("AGI memory backends", () => {
	test("local memory rejects records without provenance", async () => {
		const memory = new LocalAgiMemory({ store: new KnowledgeStore(":memory:"), now: () => 10 });
		await expect(
			memory.record({
				level: "L2",
				scope: { missionId: "m1" },
				kind: "claim",
				content: "Unproven claim",
				sourceRefs: [],
				confidence: "high",
				verified: true,
			}),
		).rejects.toThrow(/source ref|provenance/i);
	});

	test("composite memory excludes stale, provider, and unproven planning context", async () => {
		const stale: MemoryItem = {
			id: "stale",
			level: "L3",
			scope: {},
			kind: "claim",
			content: "Old",
			sourceRefs: [sourceRef()],
			confidence: "high",
			verified: true,
			createdAt: 1,
			updatedAt: 1,
			expiresAt: 5,
		};
		const provider: MemoryItem = { ...stale, id: "provider", kind: "provider-context", expiresAt: undefined };
		const good: MemoryItem = { ...stale, id: "good", content: "Good", expiresAt: undefined };
		const backend = {
			query: async () => [stale, provider, good],
			record: async () => good,
			linkClaims: async () => undefined,
		};
		const composite = new CompositeAgiMemory([backend]);

		const items = await composite.query({ levels: ["L3", "L6"], scope: {}, limit: 10 });
		expect(items.map(item => item.id)).toEqual(["good"]);
		expect(hasPlanningAuthority(provider)).toBe(false);
	});

	test("sourced-provider query results require usable provenance", async () => {
		const sourcedProviderMemory = {
			query: async () => [
				{
					id: "missing",
					level: "L4" as const,
					scope: { providerSourceId: "project" },
					kind: "claim" as const,
					content: "No source",
					sourceRefs: [{ kind: "provider" as const, uri: "https://example.test/missing" }],
					confidence: "medium" as const,
					verified: true,
					createdAt: 10,
					updatedAt: 10,
				},
				{
					id: "good",
					level: "L4" as const,
					scope: { providerSourceId: "project" },
					kind: "claim" as const,
					content: "Fresh",
					sourceRefs: [{ kind: "provider" as const, uri: "https://example.test/good", observedAt: 1 }],
					confidence: "medium" as const,
					verified: true,
					createdAt: 1,
					updatedAt: 1,
				},
			],
			record: async () => {
				throw new Error("read-only");
			},
			linkClaims: async () => undefined,
		};
		const memory = new CompositeAgiMemory([sourcedProviderMemory]);

		const items = await memory.query({ levels: ["L4"], scope: {}, claimLike: "Fresh", limit: 10 });
		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("good");
	});

	test("okf memory records markdown documents and queries global heuristics", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-okf-memory-"));
		try {
			const store = new OkfStore(root);
			const memory = new OkfAgiMemory({ store, now: () => 10 });

			const recorded = await memory.record({
				level: "L5",
				scope: {},
				kind: "claim",
				content: "Prefer narrower file scope",
				sourceRefs: [sourceRef()],
				confidence: "high",
				verified: true,
			});

			expect(fs.existsSync(path.join(root, `${recorded.id}.md`))).toBe(true);
			expect(fs.existsSync(path.join(root, "documents.json"))).toBe(false);

			const items = await memory.query({ levels: ["L5"], scope: {}, claimLike: "narrower", limit: 10 });
			expect(items).toHaveLength(1);
			expect(items[0]?.content).toBe("Prefer narrower file scope");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("runtime knowledge selects okf markdown-directory provider and disabled no-op", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-okf-runtime-"));
		const okf = openRuntimeKnowledge(
			Settings.isolated({
				"knowledge.enabled": true,
				"knowledge.provider": "okf",
				"knowledge.okfPath": root,
			}),
		);
		try {
			const knowledge = okf.knowledge;
			if (!(knowledge instanceof OkfStore)) {
				expect(knowledge).toBeInstanceOf(OkfStore);
				return;
			}
			expect(knowledge.filePath).toBe(path.resolve(root));
			expect(okf.persistLearnedHeuristics).toBe(true);
		} finally {
			okf.close();
			fs.rmSync(root, { recursive: true, force: true });
		}

		const disabled = openRuntimeKnowledge(
			Settings.isolated({
				"knowledge.enabled": false,
				"knowledge.provider": "okf",
			}),
		);
		expect(disabled.knowledge.query({ scope: "global" })).toEqual([]);
		expect(disabled.persistLearnedHeuristics).toBe(false);
		disabled.close();
	});
});
