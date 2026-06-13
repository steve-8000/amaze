import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { RuntimeAction } from "../../src/autonomy";
import { MissionStore } from "../../src/mission/store";
import { validContract } from "./objective-contract.test";

const stores: MissionStore[] = [];
const dbPaths: string[] = [];

function tempDbPath(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-runtime-store-"));
	const dbPath = path.join(dir, "autonomy.db");
	dbPaths.push(dbPath);
	return dbPath;
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dbPath of dbPaths.splice(0)) fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

function createStore(dbPath = tempDbPath()): MissionStore {
	const store = new MissionStore(dbPath);
	stores.push(store);
	return store;
}

function createMission(store: MissionStore) {
	return store.createMission({
		title: "Runtime Store Mission",
		objective: "Persist runtime substrate",
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "executing",
		confidence: null,
		snapshotRef: null,
		mode: "interactive",
	});
}

function runtimeAction(missionId: string): RuntimeAction {
	return {
		id: "action-1",
		missionId,
		objectiveContractId: "contract-1",
		planId: "plan-1",
		stepId: "step-1",
		role: "Builder",
		instruction: "Edit the scheduler.",
		dependencies: [],
		scopeGuard: validContract().scopeGuard,
		budgetGuard: validContract().budgetGuard,
		acceptanceCriteria: validContract().acceptanceCriteria,
		requiredEvidence: ["test_output"],
		status: "queued",
	};
}

function leaseFor(action: RuntimeAction): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: action.missionId,
		objectiveContractId: action.objectiveContractId,
		planId: action.planId,
		planStepId: action.stepId,
		actionId: action.id,
		mode: "interactive",
		actorRole: action.role,
		allowedTools: ["edit"],
		allowedRisk: "HIGH",
		mutationScope: {
			allowedPaths: ["packages/coding-agent/src/autonomy/**"],
			deniedPaths: [],
			allowedServices: [],
			allowedDataClasses: [],
		},
		budget: { maxToolCalls: 1, maxRetries: 0, timeoutMs: 30_000 },
		sandbox: { mode: "none", rollbackRefs: [] },
		evidenceContract: { requiredEventTypes: ["tool.completed"], requiredEvidenceRefs: ["test-output"] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
	};
}

describe("AGI runtime durable store", () => {
	test("persists objective contracts, runtime actions, and leases across restart", () => {
		const dbPath = tempDbPath();
		const store = createStore(dbPath);
		const mission = createMission(store);
		const contract = validContract();
		const savedContract = store.saveObjectiveContract(mission.id, contract);
		const action = runtimeAction(mission.id);
		const lease = leaseFor(action);
		const savedAction = store.saveRuntimeAction(action, lease);

		expect(savedContract.contractHash).toMatch(/^[a-f0-9]{64}$/);
		expect(savedAction.lease?.leaseId).toBe("lease-1");
		store.close();
		stores.pop();

		const reopened = createStore(dbPath);
		expect(reopened.getObjectiveContract("contract-1")?.id).toBe("contract-1");
		expect(reopened.getLatestObjectiveContractForMission(mission.id)?.id).toBe("contract-1");
		expect(reopened.getRuntimeAction("action-1")?.planStepId).toBe("step-1");
		expect(reopened.listRuntimeActionsForMission(mission.id).map(record => record.id)).toEqual(["action-1"]);
		expect(reopened.getCapabilityLease("lease-1")?.runtimeActionId).toBe("action-1");
	});

	test("rejects invalid runtime action status transitions", () => {
		const store = createStore();
		const mission = createMission(store);
		store.saveObjectiveContract(mission.id, validContract());
		const action = runtimeAction(mission.id);
		store.saveRuntimeAction(action, leaseFor(action));
		store.markRuntimeAction(action.id, "running");
		store.markRuntimeAction(action.id, "succeeded");

		expect(() => store.markRuntimeAction(action.id, "running")).toThrow(/Invalid runtime action status transition/);
	});

	test("rejects invalid runtime action status transitions through saveRuntimeAction upsert", () => {
		const store = createStore();
		const mission = createMission(store);
		store.saveObjectiveContract(mission.id, validContract());
		const action = runtimeAction(mission.id);
		store.saveRuntimeAction(action, leaseFor(action));
		store.markRuntimeAction(action.id, "running");
		store.markRuntimeAction(action.id, "succeeded");

		expect(() => store.saveRuntimeAction({ ...action, status: "running" }, leaseFor(action))).toThrow(
			/Invalid runtime action status transition/,
		);
		expect(store.getRuntimeAction(action.id)?.status).toBe("succeeded");
	});

	test("migration creates capability lease table for old runtime schema", () => {
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
					mode TEXT NOT NULL DEFAULT 'interactive',
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					revision INTEGER NOT NULL DEFAULT 0
				);
				CREATE TABLE objective_contracts (
					id TEXT PRIMARY KEY,
					mission_id TEXT NOT NULL,
					contract_json TEXT NOT NULL CHECK (json_valid(contract_json)),
					created_at INTEGER NOT NULL
				);
				CREATE TABLE runtime_actions (
					id TEXT PRIMARY KEY,
					mission_id TEXT NOT NULL,
					objective_contract_id TEXT NOT NULL,
					plan_id TEXT NOT NULL,
					step_id TEXT NOT NULL,
					action_json TEXT NOT NULL CHECK (json_valid(action_json)),
					lease_json TEXT NOT NULL CHECK (json_valid(lease_json)),
					status TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
				PRAGMA user_version = 7;
			`);
		} finally {
			db.close();
		}

		createStore(dbPath);
		const migrated = new Database(dbPath, { create: false, strict: true });
		try {
			const leaseTable = migrated
				.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_leases'")
				.get();
			const actionColumns = migrated.query("PRAGMA table_info(runtime_actions)").all() as Array<{ name: string }>;
			expect(leaseTable).toBeTruthy();
			expect(actionColumns.some(column => column.name === "plan_step_id")).toBe(true);
		} finally {
			migrated.close();
		}
	});
});
