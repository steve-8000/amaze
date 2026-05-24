import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { recordProposalApplyRollbackAnchor, recordProposalRollbackAnchor } from "../../src/cli/proposals";
import { recordMissionVerificationFromGoalObjective } from "../../src/goals/runtime";
import { ProposalStore } from "../../src/learning";
import { MissionStore } from "../../src/mission/store";
import type { NewMission } from "../../src/mission/types";
import { recordTaskMissionContract } from "../../src/task";

const stores: MissionStore[] = [];
let cleanupRoot: string | undefined;

afterEach(async () => {
	for (const store of stores.splice(0).reverse()) store.close();
	if (cleanupRoot) {
		await fs.rm(cleanupRoot, { recursive: true, force: true });
		cleanupRoot = undefined;
	}
});

function mission(overrides: Partial<NewMission> = {}): NewMission {
	return {
		title: "Producer mission",
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

describe("mission write-side producers", () => {
	test("records task contracts from goal objective", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-task-producer-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const createdMission = store.createMission(mission({ id: "mission-task", title: "Task objective" }));
		recordTaskMissionContract(
			"Task objective",
			{
				role: "producer",
				parentContractRevision: 2,
				scope: { include: ["src/**"], exclude: ["docs/**"] },
				successCriteria: [
					{
						id: "checkts",
						description: "typecheck",
						check: { type: "command-exit", command: "bun run check:ts", expected: 0 },
					},
				],
				escalation: { onUncertainty: "ask-parent", budgetCap: 42 },
				inputArtifact: "local://contract.md",
				outputContract: { mustProduce: ["changed files"] },
			},
			db,
			{ taskId: "producer-task", sessionFile: "/tmp/producer-task.jsonl" },
		);

		expect(store.listContracts(createdMission.id)).toMatchObject([
			{
				missionId: createdMission.id,
				role: "producer",
				parentContractRevision: 2,
				include: ["src/**"],
				exclude: ["docs/**"],
				successCriteria: ["checkts"],
				escalation: { onUncertainty: "ask-parent", budgetCap: 42 },
				inputArtifact: "local://contract.md",
				mustProduce: ["changed files"],
				taskId: "producer-task",
				sessionFile: "/tmp/producer-task.jsonl",
			},
		]);
	});

	test("records goal verification and updates mission state", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-goal-producer-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const createdMission = store.createMission(
			mission({ id: "mission-goal", title: "Goal objective", state: "verifying" }),
		);

		recordMissionVerificationFromGoalObjective({
			objective: "Goal objective",
			dbPath: db,
			verdict: { verdict: "pass", failedCount: 0, uncertainCount: 0, passedCount: 1, results: [] },
			summary: "passed",
		});

		expect(store.getLatestVerification(createdMission.id)).toMatchObject({
			missionId: createdMission.id,
			status: "pass",
			failedCount: 0,
			uncertainCount: 0,
			summary: "pass verification; 0 failed; 0 uncertain",
		});
		expect(store.getMission(createdMission.id)?.state).toBe("completed");
	});

	test("records task contracts by explicit mission id before title lookup", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-task-id-producer-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const byTitle = store.createMission(mission({ id: "mission-title", title: "Shared objective" }));
		const byId = store.createMission(mission({ id: "mission-id", title: "Different objective" }));

		recordTaskMissionContract(
			"Shared objective",
			{
				role: "producer",
				parentContractRevision: 2,
				scope: { include: ["src/**"], exclude: [] },
				successCriteria: [],
				escalation: { onUncertainty: "ask-parent", budgetCap: 42 },
				inputArtifact: undefined,
				outputContract: { mustProduce: [] },
			},
			db,
			{ missionId: byId.id },
		);

		expect(store.listContracts(byTitle.id)).toHaveLength(0);
		expect(store.listContracts(byId.id)).toMatchObject([{ missionId: byId.id, role: "producer" }]);
	});

	test("records goal verification by explicit mission id before title lookup", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-goal-id-producer-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const byTitle = store.createMission(mission({ id: "mission-verify-title", title: "Shared objective" }));
		const byId = store.createMission(
			mission({ id: "mission-verify-id", title: "Different objective", state: "verifying" }),
		);

		recordMissionVerificationFromGoalObjective({
			objective: "Shared objective",
			missionId: byId.id,
			dbPath: db,
			verdict: { verdict: "fail", failedCount: 1, uncertainCount: 0, passedCount: 0, results: [] },
			summary: "",
		});

		expect(store.getLatestVerification(byTitle.id)).toBeUndefined();
		expect(store.getLatestVerification(byId.id)).toMatchObject({
			missionId: byId.id,
			status: "fail",
			summary: "fail verification; 1 failed; 0 uncertain",
		});
		expect(store.getMission(byId.id)?.state).toBe("blocked");
	});

	test("falls back to title when explicit task mission id is missing", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-task-id-fallback-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const byTitle = store.createMission(mission({ id: "mission-task-title-fallback", title: "Fallback objective" }));

		recordTaskMissionContract(
			"Fallback objective",
			{
				role: "producer",
				parentContractRevision: undefined,
				scope: { include: ["src/**"], exclude: [] },
				successCriteria: [],
				escalation: { onUncertainty: "ask-parent", budgetCap: 42 },
				inputArtifact: undefined,
				outputContract: { mustProduce: [] },
			},
			db,
			{ missionId: "missing-mission" },
		);

		expect(store.listContracts(byTitle.id)).toMatchObject([{ missionId: byTitle.id, role: "producer" }]);
	});

	test("falls back to title when explicit verification mission id is missing", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-goal-id-fallback-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const store = new MissionStore(db);
		stores.push(store);
		const byTitle = store.createMission(
			mission({ id: "mission-verify-title-fallback", title: "Fallback verify objective", state: "verifying" }),
		);

		recordMissionVerificationFromGoalObjective({
			objective: "Fallback verify objective",
			missionId: "missing-mission",
			dbPath: db,
			verdict: { verdict: "pass", failedCount: 0, uncertainCount: 0, passedCount: 1, results: [] },
			summary: "",
		});

		expect(store.getLatestVerification(byTitle.id)).toMatchObject({
			missionId: byTitle.id,
			status: "pass",
		});
		expect(store.getMission(byTitle.id)?.state).toBe("completed");
	});

	test("records proposal apply and rollback anchors by objective provenance", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-mission-proposal-producer-"));
		const db = path.join(cleanupRoot, "autonomy.db");
		const missionStore = new MissionStore(db);
		stores.push(missionStore);
		const createdMission = missionStore.createMission(
			mission({ id: "mission-proposal", objectiveId: "objective-proposal", state: "contracted" }),
		);
		const proposalStore = new ProposalStore(db);
		const proposal = proposalStore.create({
			type: "settings",
			gate: "human-required",
			evidence: { sessionIds: ["session-1"], eventRefs: [], sampleN: 1 },
			provenance: { source: "manual", objectiveId: "objective-proposal" } as any,
			patch: { model: "fast" },
			reason: "test",
			rollback: { model: "slow" },
		});
		try {
			recordProposalApplyRollbackAnchor(proposalStore, proposal.id, { snapshotRef: "snapshot-1", version: "v1" });
			recordProposalRollbackAnchor(proposalStore, proposal.id, proposal.provenance);
		} finally {
			proposalStore.close();
		}

		expect(missionStore.getMission(createdMission.id)).toMatchObject({
			state: "rolled_back",
			snapshotRef: "snapshot-1",
		});
		const rollbacks = missionStore.listRollbacks(createdMission.id);
		expect(rollbacks).toHaveLength(2);
		expect(rollbacks).toContainEqual(
			expect.objectContaining({
				missionId: createdMission.id,
				targetType: "proposal",
				targetId: proposal.id,
				snapshotRef: "snapshot-1",
				summary: `Applied proposal ${proposal.id} version v1`,
			}),
		);
		expect(rollbacks).toContainEqual(
			expect.objectContaining({
				missionId: createdMission.id,
				targetType: "proposal",
				targetId: proposal.id,
				snapshotRef: null,
				summary: `Rolled back proposal ${proposal.id}`,
			}),
		);
	});
});
