import { afterEach, describe, expect, test } from "bun:test";
import { type NewLearningProposal, ProposalStore } from "../../src/learning";

const stores: ProposalStore[] = [];

function createStore(): ProposalStore {
	const store = new ProposalStore(":memory:");
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});

function memoryProposal(overrides: Partial<NewLearningProposal> = {}): NewLearningProposal {
	return {
		type: "memory",
		gate: "review",
		evidence: { sessionIds: ["session-1"], eventRefs: ["events.jsonl:12"], sampleN: 1 },
		provenance: { source: "manual" },
		content: "Prefer narrow tests for changed behavior.",
		memoryType: "project",
		confidence: "tool_verified",
		...overrides,
	} as NewLearningProposal;
}

describe("ProposalStore", () => {
	test("creates a memory proposal and retrieves the same proposal", () => {
		const store = createStore();
		const created = store.create(memoryProposal());

		expect(created.id).toBeString();
		expect(created.status).toBe("pending");
		expect(store.get(created.id)).toEqual(created);
	});

	test("transitions pending to approved, applied, then rolled-back", () => {
		const store = createStore();
		const created = store.create(memoryProposal());

		const approved = store.approve(created.id, "reviewer");
		expect(approved.status).toBe("approved");

		const applied = store.markApplied(created.id, "1");
		expect(applied.status).toBe("applied");

		const rolledBack = store.markRolledBack(created.id, "regression");
		expect(rolledBack.status).toBe("rolled-back");
		expect(store.get(created.id)?.status).toBe("rolled-back");
	});

	test("throws on an invalid applied to pending-like transition", () => {
		const store = createStore();
		const created = store.create(memoryProposal());
		store.approve(created.id);
		store.markApplied(created.id, "1");

		expect(() => store.markExpired(created.id)).toThrow(/Invalid learning proposal transition: applied -> expired/);
	});

	test("preserves expiresAt and marks pending proposals expired", () => {
		const store = createStore();
		const expiresAt = Date.now() + 60_000;
		const created = store.create(memoryProposal({ expiresAt }));

		expect(store.get(created.id)?.expiresAt).toBe(expiresAt);
		expect(store.markExpired(created.id).status).toBe("expired");
		expect(store.get(created.id)?.expiresAt).toBe(expiresAt);
	});

	test("filters proposals by status and type", () => {
		const store = createStore();
		const pendingMemory = store.create(memoryProposal({ content: "pending memory" }));
		const rejectedMemory = store.create(memoryProposal({ content: "rejected memory" }));
		const skill = store.create({
			type: "skill",
			gate: "review",
			evidence: { sessionIds: ["session-2"], eventRefs: ["events.jsonl:40"], sampleN: 1 },
			provenance: { source: "reflection" },
			name: "debugging-checklist",
			sourceMemoryIds: ["mem-1"],
			bodyMarkdown: "# Debugging Checklist\n",
		});
		store.reject(rejectedMemory.id, "duplicate");

		expect(new Set(store.listByStatus("pending").map(proposal => proposal.id))).toEqual(
			new Set([pendingMemory.id, skill.id]),
		);
		expect(store.listByStatus("rejected").map(proposal => proposal.id)).toEqual([rejectedMemory.id]);
		expect(new Set(store.listByType("memory").map(proposal => proposal.id))).toEqual(
			new Set([pendingMemory.id, rejectedMemory.id]),
		);
		expect(store.listByType("skill").map(proposal => proposal.id)).toEqual([skill.id]);
	});
});
