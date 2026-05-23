import { afterEach, describe, expect, test } from "bun:test";
import { MissionStore } from "../../src/mission/store";
import type { NewMission } from "../../src/mission/types";

const stores: MissionStore[] = [];

afterEach(() => {
	for (const store of stores.splice(0).reverse()) store.close();
});

function createStore(): MissionStore {
	const store = new MissionStore(":memory:");
	stores.push(store);
	return store;
}

function mission(overrides: Partial<NewMission> = {}): NewMission {
	return {
		title: "Mission contracts",
		objectiveId: "objective-1",
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "contracted",
		confidence: null,
		snapshotRef: null,
		...overrides,
	};
}

describe("MissionStore contract persistence", () => {
	test("round-trips contract arrays and JSON fields", () => {
		const store = createStore();
		const createdMission = store.createMission(mission({ id: "mission-contract" }));

		const contract = store.recordContract({
			id: "contract-1",
			missionId: createdMission.id,
			role: "wave5-contracts",
			parentContractRevision: 3,
			include: ["packages/coding-agent/src/mission/types.ts", "packages/coding-agent/src/mission/store.ts"],
			exclude: ["docs/**"],
			successCriteria: ["checkts", "wave5tests"],
			escalation: { onUncertainty: "block", budgetCap: 1200000 },
			inputArtifact: "local://contract.md",
			mustProduce: ["changed files", "verification results"],
			createdAt: 10,
		});

		expect(store.listContracts(createdMission.id)).toEqual([contract]);
	});

	test("selects latest verification by createdAt then id", () => {
		const store = createStore();
		const createdMission = store.createMission(mission({ id: "mission-verification" }));
		store.recordVerification({
			id: "verification-a",
			missionId: createdMission.id,
			status: "fail",
			failedCount: 1,
			uncertainCount: 0,
			summary: "old failure",
			createdAt: 10,
		});
		const latest = store.recordVerification({
			id: "verification-b",
			missionId: createdMission.id,
			status: "pass",
			failedCount: 0,
			uncertainCount: 0,
			summary: "latest pass",
			createdAt: 20,
		});

		expect(store.getLatestVerification(createdMission.id)).toEqual(latest);
	});

	test("round-trips rollback records", () => {
		const store = createStore();
		const createdMission = store.createMission(mission({ id: "mission-rollback" }));

		const first = store.recordRollback({
			id: "rollback-1",
			missionId: createdMission.id,
			targetType: "decision",
			targetId: "decision-1",
			snapshotRef: "snapshot-1",
			summary: "restore decision snapshot",
			createdAt: 10,
		});
		const second = store.recordRollback({
			id: "rollback-2",
			missionId: createdMission.id,
			targetType: "file",
			targetId: "src/file.ts",
			snapshotRef: null,
			summary: "restore file contents",
			createdAt: 20,
		});

		expect(store.listRollbacks(createdMission.id)).toEqual([first, second]);
	});
});
