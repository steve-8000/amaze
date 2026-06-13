import { describe, expect, test } from "bun:test";
import { CompositeAgiMemory, GbrainAgiMemory, hasPlanningAuthority, LocalAgiMemory } from "../../src/agi";
import type { MemoryItem } from "../../src/agi/memory";
import { KnowledgeStore } from "../../src/memory/knowledge-store";

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

	test("gbrain memory only returns sourced results with usable provenance", async () => {
		const memory = new GbrainAgiMemory({
			sourceId: "project",
			client: {
				query: async () => [
					{ id: "missing", text: "No source", sourceId: "project" },
					{ id: "good", text: "Fresh", sourceId: "project", uri: "https://example.test", observedAt: 1 },
				],
			},
			now: () => 10,
		});

		const items = await memory.query({ levels: ["L4"], scope: {}, claimLike: "Fresh", limit: 10 });
		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("good");
	});
});
