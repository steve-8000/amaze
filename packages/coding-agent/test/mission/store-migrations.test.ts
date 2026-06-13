import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MissionPlan } from "../../src/mission/core/mission";
import { MissionStore } from "../../src/mission/store";
import type { NewResearchCampaign } from "../../src/mission/types";

const stores: MissionStore[] = [];
const dbPaths: string[] = [];

function tempDbPath(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-store-migrations-"));
	const dbPath = path.join(dir, "autonomy.db");
	dbPaths.push(dbPath);
	return dbPath;
}

function createStore(dbPath = tempDbPath()): MissionStore {
	const store = new MissionStore(dbPath);
	stores.push(store);
	return store;
}

function userVersion(dbPath: string): number {
	const db = new Database(dbPath, { create: false, strict: true });
	try {
		return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
	} finally {
		db.close();
	}
}

function countPlanRows(dbPath: string, missionId: string): { plans: number; steps: number } {
	const db = new Database(dbPath, { create: false, strict: true });
	try {
		const plans = (
			db.query("SELECT COUNT(*) AS count FROM mission_plans WHERE mission_id = ?").get(missionId) as {
				count: number;
			}
		).count;
		const steps = (
			db.query("SELECT COUNT(*) AS count FROM mission_plan_steps WHERE mission_id = ?").get(missionId) as {
				count: number;
			}
		).count;
		return { plans, steps };
	} finally {
		db.close();
	}
}

function newMission(overrides: Partial<NewResearchCampaign> = {}): NewResearchCampaign {
	return {
		title: "Migration Mission",
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "drafting",
		confidence: null,
		snapshotRef: null,
		...overrides,
	};
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dbPath of dbPaths.splice(0)) {
		fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
	}
});

describe("mission store migrations", () => {
	test("fresh store bumps PRAGMA user_version to 8", () => {
		const dbPath = tempDbPath();
		createStore(dbPath);

		expect(userVersion(dbPath)).toBe(8);
	});

	test("pre-existing user_version 0 database with baseline schema upgrades idempotently", () => {
		const dbPath = tempDbPath();
		createStore(dbPath).close();
		stores.pop();

		const db = new Database(dbPath, { create: false, strict: true });
		try {
			db.exec("PRAGMA user_version = 0");
		} finally {
			db.close();
		}

		createStore(dbPath);

		expect(userVersion(dbPath)).toBe(8);
	});

	test("legacy missions without mode migrate with interactive default", () => {
		const dbPath = tempDbPath();
		const db = new Database(dbPath, { create: true, strict: true });
		try {
			db.exec(`
				CREATE TABLE missions (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					objective TEXT,
					objective_id TEXT,
					brief_id TEXT,
					decision_id TEXT,
					risk_level TEXT NOT NULL,
					state TEXT NOT NULL,
					confidence TEXT,
					snapshot_ref TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					revision INTEGER NOT NULL DEFAULT 0,
					intent TEXT,
					lifecycle TEXT,
					proposal_id TEXT,
					regression_contract_id TEXT
				);
				PRAGMA user_version = 6;
			`);
			db.query(
				`INSERT INTO missions
					(id, title, objective, objective_id, brief_id, decision_id, risk_level, state, confidence, snapshot_ref,
					 created_at, updated_at, revision, intent, lifecycle, proposal_id, regression_contract_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				"legacy-mission",
				"Legacy Mission",
				"Legacy objective",
				null,
				null,
				null,
				"medium",
				"drafting",
				null,
				null,
				1,
				1,
				0,
				null,
				null,
				null,
				null,
			);
		} finally {
			db.close();
		}

		const store = createStore(dbPath);
		expect(store.getMission("legacy-mission")?.mode).toBe("interactive");
		const columns = new Database(dbPath, { create: false, strict: true });
		try {
			const modeColumn = columns
				.query("PRAGMA table_info(missions)")
				.all()
				.some(column => (column as { name: string }).name === "mode");
			expect(modeColumn).toBe(true);
		} finally {
			columns.close();
		}
	});

	test("savePlan rolls back partial writes when step serialization fails", () => {
		const dbPath = tempDbPath();
		const store = createStore(dbPath);
		const mission = store.createMission(newMission());
		const cyclic: unknown[] = [];
		cyclic.push(cyclic);
		const plan = {
			rationale: "bad",
			revision: 1,
			steps: [
				{ id: "s1", description: "first" },
				{ id: "s2", description: "throws", edges: cyclic },
			],
		} as MissionPlan;

		expect(() => store.savePlan(mission.id, plan)).toThrow(/cyclic|circular/i);
		expect(countPlanRows(dbPath, mission.id)).toEqual({ plans: 0, steps: 0 });
	});
});
