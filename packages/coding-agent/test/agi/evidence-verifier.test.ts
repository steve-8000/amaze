import { describe, expect, test } from "bun:test";
import { EvidenceVerifier } from "../../src/agi/evidence-verifier";
import { MissionStore } from "../../src/mission/store";

function createMission(store: MissionStore) {
	return store.createMission({
		title: "Evidence mission",
		objective: "Prove completion",
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "drafting",
		confidence: null,
		snapshotRef: null,
		mode: "interactive",
	});
}

describe("EvidenceVerifier", () => {
	test("required evidence without durable source is insufficient", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 10 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				requirements: [
					{ criterionId: "c1", description: "tests pass", required: true, evidenceKinds: ["test_output"] },
				],
			});
			expect(result.status).toBe("insufficient_evidence");
			expect(store.listRuntimeEventsByType(mission.id, "evidence.verified")).toHaveLength(1);
		} finally {
			store.close();
		}
	});

	test("mission verification pass satisfies test output requirement", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			store.recordVerification({
				missionId: mission.id,
				status: "pass",
				failedCount: 0,
				uncertainCount: 0,
				summary: "ok",
			});
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 11 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				requirements: [
					{ criterionId: "c1", description: "tests pass", required: true, evidenceKinds: ["test_output"] },
				],
			});
			expect(result.status).toBe("pass");
		} finally {
			store.close();
		}
	});

	test("latest failing review fails review evidence", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			store.recordReview({
				missionId: mission.id,
				status: "fail",
				verdict: "fail",
				failedCount: 1,
				uncertainCount: 0,
				summary: "blocker",
				sourceFiles: [],
				excludedMarkdownFiles: [],
				reviewedAt: 1,
			});
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 12 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				requirements: [
					{ criterionId: "c1", description: "review clean", required: true, evidenceKinds: ["review_finding"] },
				],
			});
			expect(result.status).toBe("fail");
		} finally {
			store.close();
		}
	});

	test("unknown evidence kinds never pass", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 13 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				requirements: [
					{ criterionId: "c1", description: "unknown", required: true, evidenceKinds: ["unknown_kind"] },
				],
			});
			expect(result.status).toBe("insufficient_evidence");
		} finally {
			store.close();
		}
	});
});
