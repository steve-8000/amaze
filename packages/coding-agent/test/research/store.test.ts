import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ResearchStore } from "../../src/research/store";
import type { NewDecisionRecord, NewEvidenceCard, NewResearchBrief } from "../../src/research/types";

const stores: ResearchStore[] = [];

function createStore(dbPath = ":memory:"): ResearchStore {
	const store = new ResearchStore(dbPath);
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});

function brief(overrides: Partial<NewResearchBrief> = {}): NewResearchBrief {
	return {
		objectiveId: "objective-1",
		question: "Which lane is grounded?",
		lanes: ["repo", "source"],
		requiredEvidence: ["primary source"],
		disallowedEvidence: ["uncited claim"],
		riskLevel: "medium",
		stopCriteria: ["two lanes covered"],
		...overrides,
	};
}

function evidence(briefId: string, overrides: Partial<NewEvidenceCard> = {}): NewEvidenceCard {
	return {
		briefId,
		lane: "repo",
		grade: "A",
		sourceRef: "src/file.ts:1",
		excerpt: "const value = true;",
		claims: ["repo says true"],
		directness: 1,
		specificity: 1,
		recency: 1,
		reproducibility: 1,
		...overrides,
	};
}

function decision(briefId: string, overrides: Partial<NewDecisionRecord> = {}): NewDecisionRecord {
	return {
		briefId,
		hypothesis: "Use repo evidence",
		rationale: "It is directly observed",
		confidence: "high",
		evidenceRefs: ["ev-1"],
		rejectedOptions: [{ id: "alt", reason: "unsupported" }],
		nextActions: ["apply"],
		...overrides,
	};
}

describe("ResearchStore", () => {
	test("creates, gets, and lists briefs", () => {
		const store = createStore();
		const created = store.createBrief(brief({ id: "brief-1", lanes: ["repo", "source", "memory"] }));

		expect(created.id).toBe("brief-1");
		expect(created.lanes).toEqual(["repo", "source", "memory"]);
		expect(created.createdAt).toBeNumber();
		expect(created.updatedAt).toBe(created.createdAt);
		expect(store.getBrief("brief-1")).toEqual(created);
		expect(store.listBriefs()).toEqual([created]);
	});

	test("createBrief throws on unknown lane", () => {
		const store = createStore();
		expect(() => store.createBrief(brief({ lanes: ["repo", "bogus" as any] }))).toThrow("Invalid research lane");
	});

	test("listBriefs filters by objectiveId", () => {
		const store = createStore();
		const first = store.createBrief(brief({ id: "brief-1", objectiveId: "objective-1" }));
		store.createBrief(brief({ id: "brief-2", objectiveId: "objective-2" }));

		expect(store.listBriefs({ objectiveId: "objective-1" })).toEqual([first]);
	});

	test("addEvidence requires an existing brief", () => {
		const store = createStore();
		expect(() => store.addEvidence(evidence("missing"))).toThrow("Research brief not found");
	});

	test("addEvidence clamps floats and validates lane and grade", () => {
		const store = createStore();
		const created = store.createBrief(brief({ id: "brief-1" }));

		expect(() => store.addEvidence(evidence(created.id, { lane: "bogus" as any }))).toThrow("Invalid research lane");
		expect(() => store.addEvidence(evidence(created.id, { grade: "Z" as any }))).toThrow("Invalid evidence grade");

		const card = store.addEvidence(
			evidence(created.id, {
				id: "ev-1",
				directness: -1,
				specificity: 2,
				recency: Number.POSITIVE_INFINITY,
				reproducibility: Number.NEGATIVE_INFINITY,
			}),
		);
		expect(card.directness).toBe(0);
		expect(card.specificity).toBe(1);
		expect(card.recency).toBe(1);
		expect(card.reproducibility).toBe(0);
		expect(store.listEvidence(created.id)).toEqual([card]);
	});

	test("listEvidence orders by capturedAt ascending", () => {
		const store = createStore();
		const created = store.createBrief(brief({ id: "brief-1" }));
		const later = store.addEvidence(evidence(created.id, { id: "ev-later", capturedAt: 20 }));
		const earlier = store.addEvidence(evidence(created.id, { id: "ev-earlier", capturedAt: 10 }));

		expect(store.listEvidence(created.id)).toEqual([earlier, later]);
	});

	test("recordDecision validates confidence and returns latest decision", () => {
		const store = createStore();
		const created = store.createBrief(brief({ id: "brief-1" }));
		expect(() => store.recordDecision(decision(created.id, { confidence: "certain" as any }))).toThrow(
			"Invalid decision confidence",
		);

		const first = store.recordDecision(decision(created.id, { id: "dec-first" }));
		const second = store.recordDecision(decision(created.id, { id: "dec-second" }));

		expect(store.getDecision(created.id)).toEqual(second);
		expect(store.listDecisions(created.id)).toEqual([first, second]);
	});

	test("recordDecision requires an existing brief", () => {
		const store = createStore();
		expect(() => store.recordDecision(decision("missing"))).toThrow("Research brief not found");
	});

	test("schema initialization is idempotent for file databases", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-research-store-"));
		const dbPath = path.join(root, "autonomy.db");
		try {
			const first = createStore(dbPath);
			first.createBrief(brief({ id: "brief-1" }));
			first.close();
			stores.splice(stores.indexOf(first), 1);

			const second = createStore(dbPath);
			expect(second.getBrief("brief-1")?.id).toBe("brief-1");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
