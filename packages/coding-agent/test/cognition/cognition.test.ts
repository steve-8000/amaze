import { afterEach, describe, expect, test } from "bun:test";
import {
	deriveHeuristics,
	heuristicsForPlanning,
	learnFromMissionOutcome,
	type MissionOutcomeSnapshot,
	planMission,
	replanMission,
	worldModelForPlanning,
} from "../../src/cognition";
import type { PlannerLlm } from "../../src/cognition/planner";
import { KnowledgeStore } from "../../src/memory/knowledge-store";
import { MissionStore } from "../../src/mission/store";
import type { MissionTaskAttemptCheckpoint } from "../../src/mission/types";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(): { missions: MissionStore; knowledge: KnowledgeStore; missionId: string } {
	const missions = new MissionStore(":memory:");
	const knowledge = new KnowledgeStore(":memory:");
	cleanups.push(() => {
		missions.close();
		knowledge.close();
	});
	const mission = missions.createMission({
		title: "Test mission",
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "drafting",
		confidence: null,
		snapshotRef: null,
	});
	return { missions, knowledge, missionId: mission.id };
}

function checkpoint(overrides: Partial<MissionTaskAttemptCheckpoint> = {}): MissionTaskAttemptCheckpoint {
	return {
		id: `cp-${Math.random().toString(36).slice(2, 8)}`,
		missionId: "m1",
		taskId: "t1",
		agent: "Builder",
		role: "builder",
		attempt: 1,
		status: "failed",
		failureMode: "contract-fail",
		lastVerdict: "fail",
		failedCount: 1,
		uncertainCount: 0,
		remediationAction: "retry",
		sessionFile: null,
		artifactRefs: [],
		error: null,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

const planOutput = (steps: Array<{ id: string; description: string; dependsOn?: string[] }>) =>
	JSON.stringify({ rationale: "test plan", steps });

describe("planMission", () => {
	test("persists a validated plan and records a world-model action", async () => {
		const { missions, knowledge, missionId } = setup();
		const llm: PlannerLlm = async () =>
			planOutput([
				{ id: "s1", description: "define schema" },
				{ id: "s2", description: "implement", dependsOn: ["s1"] },
			]);

		const result = await planMission({ missions, knowledge, llm }, { missionId, objective: "build the thing" });

		expect(result.plan.steps).toHaveLength(2);
		expect(result.plan.revision).toBe(1);
		// Persisted through the previously-unused plan tables.
		const stored = missions.getPlan(missionId);
		expect(stored?.steps.map(s => s.id)).toEqual(["s1", "s2"]);
		expect(stored?.revision).toBe(1);
		// Decomposition recorded in the world model.
		const world = missions.listWorldModel(missionId);
		expect(world).toHaveLength(1);
		expect(world[0]?.kind).toBe("action");
		expect(world[0]?.claim).toContain("2 steps");
	});

	test("injects learned heuristics into the planning prompt", async () => {
		const { missions, knowledge, missionId } = setup();
		knowledge.record({
			scope: "global",
			claim: "smaller steps verify better",
			sourceRefs: ["mission://prev"],
			confidence: "medium",
			filePath: null,
			contentHash: null,
			supersedes: null,
		});
		let capturedPrompt = "";
		const llm: PlannerLlm = async (_system, user) => {
			capturedPrompt = user;
			return planOutput([{ id: "s1", description: "only step" }]);
		};

		const result = await planMission({ missions, knowledge, llm }, { missionId, objective: "x" });

		expect(result.injectedHeuristics).toBe(1);
		expect(capturedPrompt).toContain("smaller steps verify better");
	});
});

describe("replanMission", () => {
	test("revises the plan with critic feedback and increments revision", async () => {
		const { missions, knowledge, missionId } = setup();
		const first: PlannerLlm = async () => planOutput([{ id: "s1", description: "broad step" }]);
		await planMission({ missions, knowledge, llm: first }, { missionId, objective: "x" });

		let capturedPrompt = "";
		const second: PlannerLlm = async (_system, user) => {
			capturedPrompt = user;
			return planOutput([
				{ id: "s1", description: "narrow step A" },
				{ id: "s2", description: "narrow step B", dependsOn: ["s1"] },
			]);
		};
		const result = await replanMission(
			{ missions, knowledge, llm: second },
			{ missionId, objective: "x", criticFeedback: ["step s1 is not independently verifiable"] },
		);

		expect(result.plan.revision).toBe(2);
		expect(capturedPrompt).toContain("<critic-feedback>");
		expect(capturedPrompt).toContain("not independently verifiable");
		expect(missions.getPlan(missionId)?.steps).toHaveLength(2);
		// Both decompositions visible in the world-model trail.
		expect(missions.listWorldModel(missionId).filter(r => r.kind === "action")).toHaveLength(2);
	});

	test("rejects replanning without feedback or prior plan", async () => {
		const { missions, knowledge, missionId } = setup();
		const llm: PlannerLlm = async () => planOutput([{ id: "s1", description: "a" }]);
		await expect(
			replanMission({ missions, knowledge, llm }, { missionId, objective: "x", criticFeedback: [] }),
		).rejects.toThrow(/non-empty criticFeedback/);
		await expect(
			replanMission({ missions, knowledge, llm }, { missionId, objective: "x", criticFeedback: ["f"] }),
		).rejects.toThrow(/no prior plan/);
	});
});

describe("deriveHeuristics", () => {
	test("derives a scoping heuristic from repeated contract failures", () => {
		const snapshot: MissionOutcomeSnapshot = {
			missionId: "m1",
			objective: "refactor the session layer",
			status: "failure",
			checkpoints: [checkpoint(), checkpoint()],
		};
		const heuristics = deriveHeuristics(snapshot);
		expect(heuristics.some(h => h.claim.includes("narrower file scope"))).toBe(true);
		expect(heuristics[0]?.sourceRefs.length).toBeGreaterThanOrEqual(3);
	});

	test("derives verifiability heuristic from uncertainty escalations", () => {
		const snapshot: MissionOutcomeSnapshot = {
			missionId: "m1",
			objective: "do vague things",
			status: "partial",
			checkpoints: [checkpoint({ status: "escalated", lastVerdict: "uncertain" })],
		};
		const heuristics = deriveHeuristics(snapshot);
		expect(heuristics.some(h => h.claim.includes("independently checkable"))).toBe(true);
	});

	test("reinforces clean verified successes", () => {
		const snapshot: MissionOutcomeSnapshot = {
			missionId: "m1",
			objective: "well planned work",
			status: "success",
			verificationVerdict: "pass",
			checkpoints: [],
		};
		const heuristics = deriveHeuristics(snapshot);
		expect(heuristics).toHaveLength(1);
		expect(heuristics[0]?.claim).toContain("good template");
	});

	test("derives nothing from a single failure without patterns", () => {
		const snapshot: MissionOutcomeSnapshot = {
			missionId: "m1",
			objective: "x",
			status: "failure",
			checkpoints: [checkpoint()],
		};
		expect(deriveHeuristics(snapshot)).toHaveLength(0);
	});
});

describe("learnFromMissionOutcome", () => {
	test("persists heuristics to L5, mirrors world model, and is idempotent", () => {
		const { missions, knowledge, missionId } = setup();
		const snapshot: MissionOutcomeSnapshot = {
			missionId,
			objective: "refactor the session layer",
			status: "failure",
			checkpoints: [checkpoint({ missionId }), checkpoint({ missionId })],
		};

		const first = learnFromMissionOutcome({ missions, knowledge }, snapshot);
		expect(first.recorded).toHaveLength(1);
		expect(first.skippedDuplicates).toBe(0);

		// L5 storage with provenance.
		const stored = knowledge.query({ scope: "global" });
		expect(stored).toHaveLength(1);
		expect(stored[0]?.sourceRefs[0]).toBe(`mission://${missionId}`);

		// World-model mirror.
		const outcomes = missions.listWorldModel(missionId).filter(r => r.kind === "outcome");
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]?.outcomeStatus).toBe("fail");

		// Second pass: duplicate skipped, nothing double-recorded.
		const second = learnFromMissionOutcome({ missions, knowledge }, snapshot);
		expect(second.recorded).toHaveLength(0);
		expect(second.skippedDuplicates).toBe(1);
		expect(knowledge.query({ scope: "global" })).toHaveLength(1);
	});

	test("learned heuristics feed the next planning pass", async () => {
		const { missions, knowledge, missionId } = setup();
		learnFromMissionOutcome(
			{ missions, knowledge },
			{
				missionId,
				objective: "refactor the session layer",
				status: "failure",
				checkpoints: [checkpoint({ missionId }), checkpoint({ missionId })],
			},
		);
		expect(heuristicsForPlanning(knowledge)).toHaveLength(1);

		// New mission's planner sees the lesson from the failed one.
		const next = missions.createMission({
			title: "Next mission",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});
		let capturedPrompt = "";
		const llm: PlannerLlm = async (_system, user) => {
			capturedPrompt = user;
			return planOutput([{ id: "s1", description: "scoped step" }]);
		};
		const result = await planMission({ missions, knowledge, llm }, { missionId: next.id, objective: "similar work" });
		expect(result.injectedHeuristics).toBe(1);
		expect(capturedPrompt).toContain("narrower file scope");
	});
});

describe("worldModelForPlanning", () => {
	test("ranks verified passes first, hazards second, context last", () => {
		const { missions, missionId } = setup();
		missions.recordWorldModel({
			missionId,
			kind: "claim",
			source: "evidence",
			sourceId: "e1",
			claim: "unverified context",
			evidenceRefs: ["x"],
			verified: false,
		});
		missions.recordWorldModel({
			missionId,
			kind: "outcome",
			source: "task-attempt",
			sourceId: "t1",
			claim: "this approach failed",
			evidenceRefs: ["x"],
			outcomeStatus: "fail",
			verified: false,
		});
		missions.recordWorldModel({
			missionId,
			kind: "outcome",
			source: "verification",
			sourceId: "v1",
			claim: "this approach verified",
			evidenceRefs: ["x"],
			outcomeStatus: "pass",
			verified: true,
		});

		const claims = worldModelForPlanning(missions, missionId);
		expect(claims[0]).toContain("this approach verified");
		expect(claims[1]).toContain("this approach failed");
		expect(claims[2]).toContain("unverified context");
	});
});
