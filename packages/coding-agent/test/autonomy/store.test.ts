import { afterEach, describe, expect, test } from "bun:test";
import { type NewObjective, ObjectiveStore } from "../../src/autonomy";

const stores: ObjectiveStore[] = [];

function createStore(): ObjectiveStore {
	const store = new ObjectiveStore(":memory:");
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});

function objective(overrides: Partial<NewObjective> = {}): NewObjective {
	return {
		title: "Reduce force-complete rate",
		metricTargets: [{ metric: "forceCompleteRate", target: 0.01, direction: "down", deadline: 1_800_000_000_000 }],
		budget: { tokens: 100_000, usd: 25, wallClockMs: 86_400_000 },
		guardrails: {
			requireHumanForApply: true,
			maxAutoSubgoalsPerDay: 1,
			forbiddenScopes: ["packages/coding-agent/src/learning/**"],
		},
		...overrides,
	};
}

describe("ObjectiveStore", () => {
	test("creates, lists, and updates objective status", () => {
		const store = createStore();
		const created = store.create(objective({ id: "objective-1" }));

		expect(created).toEqual({ ...objective({ id: "objective-1" }), id: "objective-1", status: "active" });
		expect(store.get("objective-1")).toEqual(created);
		expect(store.list()).toEqual([created]);

		const paused = store.updateStatus("objective-1", "paused");
		expect(paused.status).toBe("paused");
		expect(store.get("objective-1")?.status).toBe("paused");
		expect(store.list().map(item => item.id)).toEqual(["objective-1"]);
	});

	test("records objective events", () => {
		const store = createStore();
		const created = store.create(objective({ id: "objective-events" }));
		const event = store.recordEvent(created.id, "note", { ok: true });

		expect(event.objectiveId).toBe(created.id);
		expect(event.kind).toBe("note");
		expect(event.payload).toEqual({ ok: true });
		expect(store.listEvents(created.id).map(item => item.kind)).toEqual(["created", "note"]);
	});
});
