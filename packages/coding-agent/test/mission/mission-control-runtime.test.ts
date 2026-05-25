import { afterEach, describe, expect, test } from "bun:test";
import { MissionControlRuntime } from "../../src/mission/core/mission-control-runtime";
import { MissionStore } from "../../src/mission/store";

const stores: MissionStore[] = [];

function createRuntime() {
	const store = new MissionStore(":memory:");
	stores.push(store);
	let activeMissionId: string | undefined;
	const setCalls: Array<string | undefined> = [];
	const runtime = new MissionControlRuntime({
		store,
		setActiveMissionId: id => {
			activeMissionId = id;
			setCalls.push(id);
		},
		getActiveMissionId: () => activeMissionId,
	});
	return {
		runtime,
		store,
		setCalls,
		get activeMissionId() {
			return activeMissionId;
		},
	};
}

describe("MissionControlRuntime", () => {
	afterEach(() => {
		for (const store of stores.splice(0)) store.close();
	});

	test("does not create a mission for ambient conversation", async () => {
		const { runtime, store, setCalls } = createRuntime();

		const result = await runtime.ensureActiveMission({ content: "안녕" });

		expect(result).toEqual({ missionId: undefined, intent: "conversation", created: false });
		expect(store.listMissions()).toHaveLength(0);
		expect(setCalls).toEqual([]);
	});

	test("does not create a mission for ambient questions", async () => {
		const { runtime, store, setCalls } = createRuntime();

		const result = await runtime.ensureActiveMission({ content: "what does the auth module do?" });

		expect(result).toEqual({ missionId: undefined, intent: "question_answering", created: false });
		expect(store.listMissions()).toHaveLength(0);
		expect(setCalls).toEqual([]);
	});

	test("creates and activates a mission for mutation intent", async () => {
		const { runtime, store, setCalls } = createRuntime();

		const result = await runtime.ensureActiveMission({ content: "fix the bug" });

		expect(result.created).toBe(true);
		expect(result.intent).toBe("code_change");
		expect(result.missionId).toBeDefined();
		expect(runtime.getActiveMission()?.id).toBe(result.missionId);
		expect(store.getMission(result.missionId!)).toBeDefined();
		expect(setCalls).toEqual([result.missionId]);
	});

	test("returns an existing active mission unchanged", async () => {
		const { runtime } = createRuntime();
		const first = await runtime.ensureActiveMission({ content: "fix the bug" });

		const second = await runtime.ensureActiveMission({ content: "implement the feature" });

		expect(second).toEqual({ missionId: first.missionId, intent: "code_change", created: false });
	});

	test("creates a new mission after clearing the active mission", async () => {
		const { runtime } = createRuntime();
		const first = await runtime.ensureActiveMission({ content: "fix the bug" });

		runtime.clearActiveMission();
		const second = await runtime.ensureActiveMission({ content: "fix another bug" });

		expect(second.created).toBe(true);
		expect(second.missionId).toBeDefined();
		expect(second.missionId).not.toBe(first.missionId);
	});

	test("caps mission objective at 240 characters", async () => {
		const { runtime } = createRuntime();
		const input = `fix ${"x".repeat(496)}`;

		const result = await runtime.ensureActiveMission({ content: input });

		expect(runtime.getActiveMission()?.objective).toHaveLength(240);
		expect(result.created).toBe(true);
	});
});
