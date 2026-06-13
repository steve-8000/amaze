import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgiGatewayStore, buildAgiCompletionState, createMissionAgiGoalSpec } from "../../src/agi/store";

function makeStore(dbPath = ":memory:"): AgiGatewayStore {
	const store = new AgiGatewayStore(dbPath);
	stores.push(store);
	return store;
}

const stores: AgiGatewayStore[] = [];
const dbPaths: string[] = [];

function tempDbPath(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-gateway-store-"));
	const dbPath = path.join(dir, "gateway.db");
	dbPaths.push(dbPath);
	return dbPath;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		try {
			store.close();
		} catch {
			// Some tests close stores explicitly to preserve the existing control flow.
		}
	}
	for (const dbPath of dbPaths.splice(0)) {
		fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
	}
});

describe("AGI gateway store", () => {
	it("adds monitored sessions with a structured completion contract", () => {
		const store = makeStore();
		try {
			const created = store.addSession({
				sessionId: "s1",
				sessionPath: "/tmp/s1.jsonl",
				cwd: "/tmp/project",
				title: "Initial task",
			});
			expect(created).toMatchObject({
				sessionId: "s1",
				sessionPath: "/tmp/s1.jsonl",
				cwd: "/tmp/project",
				title: "Initial task",
				state: "watching",
				score: 20,
			});
			expect(created.goalSpec.markerPrefix).toBe("AGI_GATEWAY_RESULT");
			expect(created.completionState.supervisorSatisfiedCriteria).toEqual(["monitored_by_gateway"]);
			expect(created.completionState.missingCriteria).toContain("initial_build_goal_complete");
		} finally {
			store.close();
		}
	});

	it("persists mission bridge fields and derives mission goal criteria", () => {
		const store = makeStore();
		try {
			const created = store.addSession({
				sessionId: "s-mission",
				sessionPath: "/tmp/mission.jsonl",
				cwd: "/tmp/project",
				missionId: "mission-1",
				objective: "Ship mission-bound AGI runtime",
				objectiveContractId: "contract-1",
				criteria: ["Persist mission fields", "Reject unverified completion"],
				evidenceRefs: ["criterion:mission_criterion_1"],
			});

			expect(created).toMatchObject({
				missionId: "mission-1",
				objective: "Ship mission-bound AGI runtime",
				objectiveContractId: "contract-1",
				criteria: ["Persist mission fields", "Reject unverified completion"],
				evidenceRefs: ["criterion:mission_criterion_1"],
			});
			expect(created.goalSpec.criteria.map(criterion => criterion.id)).toContain("mission_criterion_1");
			expect(created.goalSpec.criteria.find(criterion => criterion.id === "mission_criterion_2")?.description).toBe(
				"Reject unverified completion",
			);

			const reopened = store.getSession("s-mission");
			expect(reopened?.missionId).toBe("mission-1");
			expect(reopened?.criteria).toEqual(["Persist mission fields", "Reject unverified completion"]);
		} finally {
			store.close();
		}
	});

	it("refreshes goal state when rebinding an existing session to mission criteria", () => {
		const store = makeStore();
		store.addSession({ sessionId: "s-rebind", sessionPath: "/tmp/rebind.jsonl", cwd: "/tmp/project" });

		const rebound = store.addSession({
			sessionId: "s-rebind",
			sessionPath: "/tmp/rebind.jsonl",
			cwd: "/tmp/project",
			missionId: "mission-1",
			objective: "Mission objective",
			criteria: ["Mission criterion"],
		});

		expect(rebound.goalSpec.criteria.map(criterion => criterion.id)).toContain("mission_criterion_1");
		expect(rebound.goalSpec.criteria.map(criterion => criterion.id)).not.toContain("initial_build_goal_complete");
		expect(rebound.completionState.missingCriteria).toContain("mission_criterion_1");
		expect(rebound.completionState.missingCriteria).not.toContain("initial_build_goal_complete");
		expect(rebound.score).toBe(20);
	});

	it("upgrades legacy AGI databases before creating the mission index", () => {
		const dbPath = tempDbPath();
		const db = new Database(dbPath, { create: true, strict: true });
		try {
			db.exec(`
				CREATE TABLE agi_sessions (
					session_id TEXT PRIMARY KEY,
					session_path TEXT NOT NULL,
					cwd TEXT NOT NULL,
					title TEXT,
					state TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
			`);
			db.query(
				"INSERT INTO agi_sessions (session_id, session_path, cwd, title, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			).run("legacy", "/tmp/legacy.jsonl", "/tmp/project", "Legacy", "watching", 1, 1);
		} finally {
			db.close();
		}

		const store = makeStore(dbPath);

		expect(store.getSession("legacy")?.missionId).toBeUndefined();
		expect(
			store.addSession({
				sessionId: "mission",
				sessionPath: "/tmp/mission.jsonl",
				cwd: "/tmp/project",
				missionId: "m1",
			}).missionId,
		).toBe("m1");
	});

	it("keeps the hard-coded default goal only for unbound legacy sessions", () => {
		const legacy = createMissionAgiGoalSpec({});
		const missionBound = createMissionAgiGoalSpec({
			objective: "Complete the operator objective",
			criteria: ["First acceptance criterion"],
		});

		expect(legacy.criteria.map(criterion => criterion.id)).toContain("initial_build_goal_complete");
		expect(missionBound.criteria.map(criterion => criterion.id)).not.toContain("initial_build_goal_complete");
		expect(missionBound.criteria.find(criterion => criterion.id === "mission_criterion_1")?.description).toBe(
			"First acceptance criterion",
		);
	});

	it("records durable gateway events for monitored sessions", () => {
		const store = makeStore();
		try {
			store.addSession({ sessionId: "s1", sessionPath: "/tmp/s1.jsonl", cwd: "/tmp/project" });
			const event = store.recordEvent("s1", "session.completed", { summary: "done" });
			expect(event).toMatchObject({ sessionId: "s1", type: "session.completed", payload: { summary: "done" } });
			expect(store.listEvents("s1")).toHaveLength(1);
			expect(store.getSession("s1")?.lastEventAt).toBe(event.createdAt);
		} finally {
			store.close();
		}
	});

	it("tracks actions and keeps completion state aligned with score updates", () => {
		const store = makeStore();
		try {
			const session = store.addSession({ sessionId: "s1", sessionPath: "/tmp/s1.jsonl", cwd: "/tmp/project" });
			const completionState = buildAgiCompletionState(session.goalSpec, {
				score: 80,
				complete: false,
				structuredResultSeen: true,
				summary: "Agent reported bounded context and initial build completion.",
				agentSatisfiedCriteria: ["context_boundaries_preserved", "initial_build_goal_complete"],
				supervisorSatisfiedCriteria: [
					"monitored_by_gateway",
					"completion_alarm_detected",
					"follow_up_turn_executed",
				],
			});
			const updated = store.updateSession("s1", { score: 80, completionState });
			expect(updated.score).toBe(80);
			expect(updated.completionState.score).toBe(80);
			expect(updated.completionState.structuredResultSeen).toBe(true);
			const event = store.recordEvent("s1", "session.turn_completed", { summary: "ready" });
			const action = store.createAction({
				sessionId: "s1",
				eventId: event.id,
				actionType: "follow_up_turn",
				instruction: "continue",
			});
			expect(store.overallScore()).toBe(80);
			expect(store.listPendingActions()).toHaveLength(1);
			store.markActionRunning(action.id, 10);
			store.markActionCompleted(action.id, { ok: true }, 20);
			expect(store.getAction(action.id)).toMatchObject({
				status: "completed",
				startedAt: 10,
				finishedAt: 20,
				result: { ok: true },
			});
		} finally {
			store.close();
		}
	});
});
