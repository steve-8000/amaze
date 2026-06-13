import { afterEach, describe, expect, test } from "bun:test";
import { type NewObjective, ObjectiveScheduler, ObjectiveStore } from "../../src/autonomy";
import type { MissionRuntime } from "../../src/mission/core";

const stores: ObjectiveStore[] = [];

function createStore(): ObjectiveStore {
	const store = new ObjectiveStore(":memory:");
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});

function objective(overrides: Partial<NewObjective> = {}): NewObjective {
	return {
		id: "objective-1",
		title: "Reduce flaky tests",
		metricTargets: [{ metric: "flakeRate", target: 0.01, direction: "down" }],
		budget: { tokens: 1000, wallClockMs: 60_000 },
		guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
		...overrides,
	};
}

function missionRuntime() {
	const created: unknown[] = [];
	const blocked: unknown[] = [];
	return {
		created,
		blocked,
		runtime: {
			async create(input) {
				created.push(input);
				return { id: "mission-1" };
			},
			async block(missionId, options) {
				blocked.push({ missionId, options });
				return { id: missionId };
			},
		} as Pick<MissionRuntime, "create" | "block">,
	};
}

describe("ObjectiveScheduler", () => {
	test("schedules active objectives and records the decision", async () => {
		const store = createStore();
		store.create(objective());
		const runtime = missionRuntime();
		const scheduler = new ObjectiveScheduler({
			store,
			missionRuntime: runtime.runtime,
			classifyContinuation: () => ({ kind: "none", reason: "no mission" }),
			now: () => 123,
		});

		const decisions = await scheduler.tick();

		expect(decisions).toEqual([
			{
				objectiveId: "objective-1",
				missionId: "mission-1",
				kind: "schedule-mission",
				reason: "active objective has no resumable mission",
			},
		]);
		expect(runtime.created).toHaveLength(1);
		expect(store.listEvents("objective-1").at(-1)).toMatchObject({
			kind: "scheduler.decision",
			payload: { kind: "schedule-mission", missionId: "mission-1", ts: 123 },
		});
	});

	test("does not duplicate an existing auto mission when continuation is none", async () => {
		const store = createStore();
		store.create(objective());
		const runtime = missionRuntime();
		const scheduler = new ObjectiveScheduler({
			store,
			missionRuntime: runtime.runtime,
			findMissionForObjective: () => "mission-1",
			classifyContinuation: () => ({ kind: "none", reason: "auto_mission_not_continuable" }),
			now: () => 123,
		});

		expect(await scheduler.tick()).toEqual([
			{
				objectiveId: "objective-1",
				missionId: "mission-1",
				kind: "skip",
				reason: "auto_mission_not_continuable",
			},
		]);
		expect(runtime.created).toHaveLength(0);
	});

	test("links scheduled mission inputs back to the objective id", async () => {
		const store = createStore();
		store.create(objective());
		const runtime = missionRuntime();
		const scheduler = new ObjectiveScheduler({
			store,
			missionRuntime: runtime.runtime,
			classifyContinuation: () => ({ kind: "none", reason: "no mission" }),
			now: () => 123,
		});

		await scheduler.tick();

		expect(runtime.created).toEqual([expect.objectContaining({ projectId: "objective-1" })]);
	});

	test("skips non-active objectives and does not create missions", async () => {
		const store = createStore();
		store.create(objective({ status: "paused" }));
		const runtime = missionRuntime();
		const scheduler = new ObjectiveScheduler({
			store,
			missionRuntime: runtime.runtime,
			classifyContinuation: () => ({ kind: "none", reason: "no mission" }),
			now: () => 123,
		});

		expect(await scheduler.tick()).toEqual([
			{ objectiveId: "objective-1", kind: "skip", reason: "objective is paused" },
		]);
		expect(runtime.created).toHaveLength(0);
		expect(store.listEvents("objective-1").at(-1)?.payload).toMatchObject({ kind: "skip" });
	});

	test("holds active objectives when guardrails require human approval", async () => {
		const store = createStore();
		store.create(objective({ guardrails: { requireHumanForApply: true } }));
		const runtime = missionRuntime();
		const scheduler = new ObjectiveScheduler({
			store,
			missionRuntime: runtime.runtime,
			classifyContinuation: () => ({ kind: "none", reason: "no mission" }),
			now: () => 123,
		});

		expect(await scheduler.tick()).toEqual([
			{
				objectiveId: "objective-1",
				kind: "hold",
				reason: "guardrail requires human approval before apply",
			},
		]);
		expect(runtime.created).toHaveLength(0);
		expect(store.listEvents("objective-1").at(-1)?.payload).toMatchObject({ kind: "hold" });
	});
});
