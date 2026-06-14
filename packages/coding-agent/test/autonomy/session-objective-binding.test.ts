import { afterEach, describe, expect, test } from "bun:test";
import {
	ensureObjectiveForMission,
	LIVE_BOUND_OBJECTIVE_GUARDRAILS,
	type ObjectiveMissionFactory,
	ObjectiveStore,
	settleObjective,
	settleObjectiveForMission,
	summarizeObjectiveMission,
} from "../../src/autonomy";
import { MissionStore } from "../../src/mission/store";

const closers: Array<() => void> = [];

afterEach(() => {
	for (const close of closers.splice(0)) close();
});

function setup(): { objectives: ObjectiveStore; missions: MissionStore } {
	const objectives = new ObjectiveStore(":memory:");
	const missions = new MissionStore(":memory:");
	closers.push(() => objectives.close());
	closers.push(() => missions.close());
	return { objectives, missions };
}

function createLiveMission(missions: MissionStore, title = "Fix flaky test") {
	return missions.createMission({
		title,
		objective: title,
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "executing",
		confidence: null,
		snapshotRef: null,
		mode: "interactive",
		intent: "code_change",
		lifecycle: "executing",
	});
}

describe("ensureObjectiveForMission", () => {
	test("creates a durable objective and binds it to the mission", () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		expect(mission.objectiveId).toBeNull();

		const result = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });

		expect(result.created).toBe(true);
		const objective = objectives.get(result.objectiveId);
		expect(objective).toBeDefined();
		expect(objective?.title).toBe(mission.title);
		expect(objective?.metricTargets).toEqual([]);
		// The runaway-loop safety floor: a live-bound objective cannot spawn new missions.
		expect(objective?.guardrails.maxAutoSubgoalsPerDay).toBe(0);
		expect(LIVE_BOUND_OBJECTIVE_GUARDRAILS.maxAutoSubgoalsPerDay).toBe(0);

		const rebound = missions.getMission(mission.id);
		expect(rebound?.objectiveId).toBe(result.objectiveId);
	});

	test("is idempotent: reuses the existing objective binding", () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);

		const first = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		const second = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });

		expect(second.created).toBe(false);
		expect(second.objectiveId).toBe(first.objectiveId);
		expect(objectives.list()).toHaveLength(1);
	});

	test("recreates a binding when the referenced objective is gone (dangling id)", () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		// Simulate a dangling objectiveId that no longer resolves in the objective store.
		missions.updateMission(mission.id, { objectiveId: "missing-objective" });

		const result = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });

		expect(result.created).toBe(true);
		expect(result.objectiveId).not.toBe("missing-objective");
		expect(objectives.get(result.objectiveId)).toBeDefined();
	});

	test("throws when the mission does not exist", () => {
		const { objectives, missions } = setup();
		expect(() => ensureObjectiveForMission({ objectives, missions }, { missionId: "nope" })).toThrow(
			/Mission not found/,
		);
	});

	test("bound objective settles completed once its mission completes", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		missions.updateMission(mission.id, { state: "completed" });

		const objective = objectives.get(objectiveId);
		if (!objective) throw new Error("objective missing");
		const summaries = missions
			.listMissions({ objectiveId })
			.map(m =>
				summarizeObjectiveMission(objectiveId, { id: m.id, state: m.state }, missions.listAcceptanceCriteria(m.id)),
			);

		const settlement = await settleObjective(objective, summaries);
		expect(settlement.complete).toBe(true);
		expect(settlement.status).toBe("completed");
		// No new missions: maxAutoSubgoalsPerDay is 0 for a live-bound objective.
		expect(settlement.nextMissions).toEqual([]);
	});

	test("bound objective settles blocked when its mission is blocked", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		missions.updateMission(mission.id, { state: "blocked" });

		const objective = objectives.get(objectiveId);
		if (!objective) throw new Error("objective missing");
		const summaries = missions
			.listMissions({ objectiveId })
			.map(m =>
				summarizeObjectiveMission(objectiveId, { id: m.id, state: m.state }, missions.listAcceptanceCriteria(m.id)),
			);

		const settlement = await settleObjective(objective, summaries);
		expect(settlement.complete).toBe(false);
		expect(settlement.status).toBe("blocked");
		expect(settlement.nextMissions).toEqual([]);
	});
});

describe("settleObjectiveForMission", () => {
	const rejectingFactory: ObjectiveMissionFactory = () => {
		throw new Error("live-bound objective must not generate missions");
	};

	test("persists completed status and progress, generates nothing", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		missions.updateMission(mission.id, { state: "completed" });

		const { settlement, generatedMissionIds } = await settleObjectiveForMission(
			{ objectives, missions, createMission: rejectingFactory },
			{ objectiveId },
		);

		expect(settlement.complete).toBe(true);
		expect(settlement.status).toBe("completed");
		expect(generatedMissionIds).toEqual([]);

		const persisted = objectives.get(objectiveId);
		expect(persisted?.status).toBe("completed");
		expect(persisted?.progress?.score).toBe(1);
		// A settlement event is recorded for the durable audit trail.
		const events = objectives.listEvents(objectiveId);
		expect(events.some(e => e.kind === "session.settlement")).toBe(true);
	});

	test("persists blocked status when the mission is blocked", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		missions.updateMission(mission.id, { state: "blocked" });

		const { settlement, generatedMissionIds } = await settleObjectiveForMission(
			{ objectives, missions, createMission: rejectingFactory },
			{ objectiveId },
		);

		expect(settlement.status).toBe("blocked");
		expect(generatedMissionIds).toEqual([]);
		expect(objectives.get(objectiveId)?.status).toBe("blocked");
	});

	test("reports in_progress while a mission is still active, no status write churn", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		// Mission left in a non-terminal state.
		const { settlement } = await settleObjectiveForMission(
			{ objectives, missions, createMission: rejectingFactory },
			{ objectiveId },
		);
		expect(settlement.complete).toBe(false);
		expect(settlement.status).toBe("in_progress");
	});

	test("never invokes the mission factory for a live-bound objective", async () => {
		const { objectives, missions } = setup();
		const mission = createLiveMission(missions);
		const { objectiveId } = ensureObjectiveForMission({ objectives, missions }, { missionId: mission.id });
		missions.updateMission(mission.id, { state: "completed" });

		let factoryCalls = 0;
		const countingFactory: ObjectiveMissionFactory = input => {
			factoryCalls += 1;
			return missions.createMission({
				title: input.title,
				objective: input.objective,
				objectiveId,
				briefId: null,
				decisionId: null,
				riskLevel: "medium",
				state: "executing",
				confidence: null,
				snapshotRef: null,
				mode: "auto",
				intent: "code_change",
				lifecycle: "executing",
			});
		};

		await settleObjectiveForMission({ objectives, missions, createMission: countingFactory }, { objectiveId });
		expect(factoryCalls).toBe(0);
	});

	test("throws when the objective does not exist", async () => {
		const { objectives, missions } = setup();
		await expect(
			settleObjectiveForMission({ objectives, missions, createMission: rejectingFactory }, { objectiveId: "nope" }),
		).rejects.toThrow(/Objective not found/);
	});
});
