import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Goal, GoalModeState, GoalTokenUsage } from "@amaze/coding-agent/goals/state";
import {
	type GoalRuntimeHost,
	ObjectiveRuntimeImpl,
	renderGoalBlock,
	renderMissionBlock,
} from "@amaze/coding-agent/mission/core/objective-runtime";
import type { MissionEvent } from "../../src/mission/events";
import { MissionReadModel } from "../../src/mission/read-model";
import { closeMissionRuntime, getMissionEventBus, initializeMissionRuntime } from "../../src/mission/runtime";

const cleanup: Array<() => void> = [];

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...overrides };
}

function cloneGoal(goal: Goal): Goal {
	return { ...goal };
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
	return state ? { ...state, goal: cloneGoal(state.goal) } : undefined;
}

function tempDb(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-goal-mission-dualwrite-"));
	cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
	return path.join(root, "autonomy.db");
}

function createHarness(dbPath: string) {
	let state = cloneState(undefined);
	const host: GoalRuntimeHost = {
		getState: () => cloneState(state),
		setState: next => {
			state = cloneState(next);
		},
		getCurrentUsage: () => createUsage(),
		emit: async () => {},
		persist: () => {},
		sendHiddenMessage: async () => {},
		now: () => 0,
	};
	return { runtime: new ObjectiveRuntimeImpl(host, { missionDbPath: dbPath }), getState: () => cloneState(state) };
}

describe("goal -> mission dual-write", () => {
	beforeEach(() => {
		// Reset the singleton so each test gets a fresh bus that the MissionStore wires into.
		void closeMissionRuntime();
	});

	afterEach(async () => {
		await closeMissionRuntime();
		for (const item of cleanup.splice(0).reverse()) item();
	});

	it("creates a goal-originated mission visible via the read-model", async () => {
		const dbPath = tempDb();
		initializeMissionRuntime();
		const { runtime, getState } = createHarness(dbPath);

		await runtime.createGoal({ objective: "Wire goal to mission" });

		const missionId = getState()?.goal.missionId;
		expect(typeof missionId).toBe("string");

		const readModel = new MissionReadModel({ dbPath });
		cleanup.push(() => readModel.close());
		const view = readModel.getMissionView(missionId!);
		expect(view?.mission.title).toBe("Wire goal to mission");
		expect(view?.mission.state).toBe("executing");
	});

	it("complete emits verification.completed and marks the mission completed", async () => {
		const dbPath = tempDb();
		const { bus } = initializeMissionRuntime();
		const events: MissionEvent[] = [];
		const unsubscribe = (getMissionEventBus() ?? bus).subscribe(event => events.push(event));
		cleanup.push(unsubscribe);

		const { runtime, getState } = createHarness(dbPath);
		await runtime.createGoal({ objective: "Complete me" });
		const missionId = getState()?.goal.missionId;
		expect(typeof missionId).toBe("string");

		await runtime.completeGoalFromTool();

		// Bus dispatch is queued via microtask — let it drain.
		await new Promise(resolve => queueMicrotask(() => resolve(undefined)));

		const verificationEvents = events.filter(
			event => event.type === "verification.completed" && event.missionId === missionId,
		);
		expect(verificationEvents.length).toBeGreaterThanOrEqual(1);

		const readModel = new MissionReadModel({ dbPath });
		cleanup.push(() => readModel.close());
		const view = readModel.getMissionView(missionId!);
		expect(view?.mission.state).toBe("completed");
		expect(view?.latestVerification?.status).toBe("pass");
	});

	it("block marks the linked mission blocked", async () => {
		const dbPath = tempDb();
		initializeMissionRuntime();
		const { runtime, getState } = createHarness(dbPath);
		await runtime.createGoal({ objective: "Block me" });
		const missionId = getState()?.goal.missionId;

		await runtime.blockGoalFromTool();

		const readModel = new MissionReadModel({ dbPath });
		cleanup.push(() => readModel.close());
		expect(readModel.getMissionView(missionId!)?.mission.state).toBe("blocked");
	});

	it("drop marks the linked mission cancelled", async () => {
		const dbPath = tempDb();
		initializeMissionRuntime();
		const { runtime, getState } = createHarness(dbPath);
		await runtime.createGoal({ objective: "Drop me" });
		const missionId = getState()?.goal.missionId;

		await runtime.dropGoal();

		const readModel = new MissionReadModel({ dbPath });
		cleanup.push(() => readModel.close());
		expect(readModel.getMissionView(missionId!)?.mission.state).toBe("cancelled");
	});

	it("renderGoalBlock is unchanged and renderMissionBlock is an additive parallel", () => {
		const goal: Goal = {
			id: "goal-x",
			objective: "Ship <fast> & safely",
			missionId: "mission-x",
			status: "active",
			tokensUsed: 0,
			timeUsedSeconds: 0,
			createdAt: 0,
			updatedAt: 0,
		};

		// Frozen contract: renderGoalBlock output is byte-stable and uses the <goal> element.
		expect(renderGoalBlock(goal)).toContain("<goal ");
		expect(renderGoalBlock(goal)).not.toContain("<mission");

		// Parallel mission framing carries the linked mission id and mirrors goal status.
		const block = renderMissionBlock(goal);
		expect(block).toContain('mission-id="mission-x"');
		expect(block).toContain('status="active"');
		expect(block).toContain("Ship &lt;fast&gt; &amp; safely");

		// Terminal/empty goal collapses to the sentinel, like renderGoalBlock.
		expect(renderMissionBlock(undefined)).toBe('<mission status="none"/>');
		expect(renderMissionBlock({ ...goal, status: "complete" })).toBe('<mission status="none"/>');
	});
});
