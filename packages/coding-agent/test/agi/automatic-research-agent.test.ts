import { describe, expect, test } from "bun:test";
import { AutomaticResearchAgent } from "../../src/agi/automatic-research-agent";
import type { MemoryItem } from "../../src/agi/memory";
import { validContract } from "./objective-contract.test";

describe("AutomaticResearchAgent", () => {
	test("records and returns provider citations with durable provenance", async () => {
		let recorded: Omit<MemoryItem, "id" | "createdAt" | "updatedAt"> | undefined;
		const agent = new AutomaticResearchAgent({
			provider: {
				search: async input => {
					expect(input.query).toBe("Achieve goal");
					expect(input.maxAgeDays).toBe(7);
					return [
						{ uri: "https://example.test/a", contentHash: "sha256:a", observedAt: 10 },
						{ uri: "", contentHash: "sha256:bad", observedAt: 10 },
					];
				},
			},
			memory: {
				query: async () => [],
				record: async item => {
					recorded = item;
					return { ...item, id: "memory-1", createdAt: 10, updatedAt: 10 };
				},
				linkClaims: async () => undefined,
			},
		});

		const citations = await agent.research({
			missionId: "mission-1",
			contract: {
				...validContract(),
				objective: "Achieve goal",
				freshnessPolicy: { researchRequired: true, maxSourceAgeDays: 7 },
			},
		});

		expect(citations).toEqual([
			{ kind: "provider", uri: "https://example.test/a", contentHash: "sha256:a", observedAt: 10 },
		]);
		expect(recorded?.scope).toEqual({ missionId: "mission-1" });
		expect(recorded?.verified).toBe(true);
	});
});
