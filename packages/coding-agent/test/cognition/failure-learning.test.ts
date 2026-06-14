import { afterEach, describe, expect, test } from "bun:test";
import { deriveHeuristics, learnFromTerminalMission, type MissionOutcomeSnapshot } from "../../src/cognition";
import { KnowledgeStore } from "../../src/memory/knowledge-store";
import { MissionStore } from "../../src/mission/store";
import { createDurableMissionToolContext } from "../../src/mission/tool-action-log";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function snapshot(over: Partial<MissionOutcomeSnapshot> = {}): MissionOutcomeSnapshot {
	return {
		missionId: "m1",
		objective: "Stabilize the deployment pipeline",
		status: "failure",
		checkpoints: [],
		...over,
	};
}

describe("deriveHeuristics failure rules", () => {
	test("emits an avoidance heuristic for a tool that failed repeatedly", () => {
		const out = deriveHeuristics(snapshot({ toolFailures: [{ tool: "bash", count: 3 }] }));
		const claim = out.find(h => h.claim.includes('Tool "bash"'));
		expect(claim).toBeDefined();
		expect(claim?.claim).toContain("failed 3x");
		expect(claim?.confidence).toBe("medium");
	});

	test("ignores a single tool failure (noise floor)", () => {
		const out = deriveHeuristics(snapshot({ toolFailures: [{ tool: "bash", count: 1 }] }));
		expect(out.some(h => h.claim.includes('Tool "bash"'))).toBe(false);
	});

	test("emits a runtime-hazard heuristic when a non-success mission hit runtime errors", () => {
		const out = deriveHeuristics(snapshot({ status: "blocked", runtimeErrorCount: 2 }));
		const claim = out.find(h => h.claim.includes("runtime error"));
		expect(claim).toBeDefined();
		expect(claim?.claim).toContain("2 runtime error");
	});

	test("does NOT emit a runtime-hazard heuristic for a successful mission", () => {
		const out = deriveHeuristics(snapshot({ status: "success", runtimeErrorCount: 5 }));
		expect(out.some(h => h.claim.includes("runtime error"))).toBe(false);
	});
});

describe("learnFromTerminalMission failure harvest", () => {
	function setup() {
		const missions = new MissionStore(":memory:");
		const knowledge = new KnowledgeStore(":memory:");
		cleanups.push(() => {
			missions.close();
			knowledge.close();
		});
		const mission = missions.createMission({
			title: "Harvest failures",
			objective: "Stabilize the deployment pipeline",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "blocked",
			confidence: null,
			snapshotRef: null,
			mode: "interactive",
			intent: "code_change",
			lifecycle: "blocked",
		});
		return { missions, knowledge, missionId: mission.id };
	}

	test("harvests repeated tool failures from the runtime-action log into a heuristic", () => {
		const { missions, knowledge, missionId } = setup();
		// Two failed bash tool calls recorded via the Step-3 durable tool-action log.
		const ctx = createDurableMissionToolContext({ store: missions, getActiveMissionId: () => missionId });
		ctx.emit({
			type: "mission.tool.completed",
			missionId,
			taskId: null,
			toolCallId: "c1",
			tool: "bash",
			status: "error",
			ts: 1,
		});
		ctx.emit({
			type: "mission.tool.completed",
			missionId,
			taskId: null,
			toolCallId: "c2",
			tool: "bash",
			status: "error",
			ts: 2,
		});

		const result = learnFromTerminalMission(
			{ missions, knowledge },
			{ id: missionId, objective: "Stabilize the deployment pipeline", outcome: { status: "failed" } },
		);

		expect(result).toBeDefined();
		const recorded = knowledge.query({ scope: "global", activeOnly: true }).map(i => i.claim);
		expect(recorded.some(c => c.includes('Tool "bash"') && c.includes("failed 2x"))).toBe(true);
	});

	test("does not invent failures when the runtime log is clean", () => {
		const { missions, knowledge, missionId } = setup();
		const ctx = createDurableMissionToolContext({ store: missions, getActiveMissionId: () => missionId });
		ctx.emit({
			type: "mission.tool.completed",
			missionId,
			taskId: null,
			toolCallId: "ok1",
			tool: "edit",
			status: "ok",
			ts: 1,
		});

		learnFromTerminalMission(
			{ missions, knowledge },
			{ id: missionId, objective: "Stabilize the deployment pipeline", outcome: { status: "failed" } },
		);

		const recorded = knowledge.query({ scope: "global", activeOnly: true }).map(i => i.claim);
		expect(recorded.some(c => c.includes('Tool "edit"'))).toBe(false);
	});

	test("harvests a runtime-hazard heuristic from a persisted blocked runtime event", () => {
		const { missions, knowledge, missionId } = setup();
		// A real durable runtime hazard, as the AGI runtime would persist it.
		missions.appendRuntimeEvent({
			missionId,
			streamId: `runtime-action:${missionId}`,
			type: "runtime.governance.blocked",
			actor: "Builder",
			idempotencyKey: `${missionId}:gov-blocked`,
			payload: { reason: "high-risk lease without approval" },
		});

		learnFromTerminalMission(
			{ missions, knowledge },
			{ id: missionId, objective: "Stabilize the deployment pipeline", outcome: { status: "blocked" } },
		);

		const recorded = knowledge.query({ scope: "global", activeOnly: true }).map(i => i.claim);
		expect(recorded.some(c => c.includes("runtime error") && c.includes("1 runtime error"))).toBe(true);
	});
});
