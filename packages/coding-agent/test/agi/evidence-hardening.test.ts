import { describe, expect, test } from "bun:test";
import { EvidenceVerifier } from "../../src/agi/evidence-verifier";
import { AgiGatewayStore } from "../../src/agi/store";
import { MissionStore } from "../../src/mission/store";

function createMission(store: MissionStore) {
	return store.createMission({
		title: "Evidence hardening",
		objective: "Prove mutation completion",
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

describe("EvidenceVerifier mutation-success hardening", () => {
	test("accepts a completion claim backed by a machine-derived tool-completed event", () => {
		const store = new AgiGatewayStore(":memory:");
		try {
			store.addSession({
				sessionId: "s1",
				sessionPath: "/tmp/s1.jsonl",
				cwd: "/tmp",
				missionId: "mission-1",
				objective: "Apply sandboxed mutation",
				criteria: ["Mutation lands in the workspace"],
				evidenceRefs: ["criterion:mission_criterion_1"],
			});
			// A machine-derived tool-completed event is the durable execution signal.
			store.recordEvent("s1", "mission.tool.completed", { tool: "write", status: "ok" });
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			const verifier = new EvidenceVerifier({ gatewayStore: store });
			expect(verifier.collectSources(session)).toContainEqual(expect.objectContaining({ type: "tool-completed" }));
			return expect(verifier.verify(session, { score: 100, complete: true, satisfiedCriteria: [] })).resolves.toBe(
				true,
			);
		} finally {
			store.close();
		}
	});

	test("rejects a self-reported completion with no durable execution source", () => {
		const store = new AgiGatewayStore(":memory:");
		try {
			store.addSession({
				sessionId: "s1",
				sessionPath: "/tmp/s1.jsonl",
				cwd: "/tmp",
				missionId: "mission-1",
				objective: "Apply sandboxed mutation",
				criteria: ["Mutation lands in the workspace"],
				// Only a criterion ref; no tool-completed event, test output, or artifact hash exists.
				evidenceRefs: ["criterion:mission_criterion_1"],
			});
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			const verifier = new EvidenceVerifier({ gatewayStore: store });
			expect(verifier.collectSources(session)).toHaveLength(0);
			return expect(verifier.verify(session, { score: 100, complete: true, satisfiedCriteria: [] })).resolves.toBe(
				false,
			);
		} finally {
			store.close();
		}
	});

	test("rejects completion when a criterion has a durable source but no criterion-bound evidence", () => {
		const store = new AgiGatewayStore(":memory:");
		try {
			store.addSession({
				sessionId: "s1",
				sessionPath: "/tmp/s1.jsonl",
				cwd: "/tmp",
				missionId: "mission-1",
				objective: "Apply sandboxed mutation",
				criteria: ["Mutation lands in the workspace"],
				// Durable source present (test-output ref), but the criterion is not referenced.
				evidenceRefs: ["test-output:sandbox-run"],
			});
			store.recordEvent("s1", "mission.tool.completed", { tool: "write", status: "ok" });
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			const verifier = new EvidenceVerifier({ gatewayStore: store });
			expect(verifier.collectSources(session).length).toBeGreaterThan(0);
			return expect(verifier.verify(session, { score: 100, complete: true, satisfiedCriteria: [] })).resolves.toBe(
				false,
			);
		} finally {
			store.close();
		}
	});

	test("contradictory mission verification fails a test_output requirement", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			// A failing mission verification contradicts any self-asserted success.
			store.recordVerification({
				missionId: mission.id,
				status: "fail",
				failedCount: 1,
				uncertainCount: 0,
				summary: "sandbox verification failed",
			});
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 20 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				objectiveContractId: "contract-1",
				requirements: [
					{ criterionId: "c1", description: "tests pass", required: true, evidenceKinds: ["test_output"] },
				],
			});

			expect(result.status).toBe("fail");
			expect(result.criteria[0]?.status).toBe("fail");
		} finally {
			store.close();
		}
	});

	test("missing evidence yields insufficient_evidence rather than a pass", async () => {
		const store = new MissionStore(":memory:");
		try {
			const mission = createMission(store);
			const verifier = new EvidenceVerifier({ missionStore: store, now: () => 21 });
			const result = await verifier.verifyMission({
				missionId: mission.id,
				objectiveContractId: "contract-1",
				requirements: [
					{ criterionId: "c1", description: "diff applied", required: true, evidenceKinds: ["source_diff"] },
				],
			});

			expect(result.status).toBe("insufficient_evidence");
		} finally {
			store.close();
		}
	});
});
