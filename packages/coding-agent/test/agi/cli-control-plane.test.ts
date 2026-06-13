import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { RuntimeAction } from "../../src/autonomy";
import { ObjectiveStore } from "../../src/autonomy/store";
import { runAgiCommand } from "../../src/cli/agi";
import { MissionStore } from "../../src/mission/store";
import { validContract } from "./objective-contract.test";

function tempDbPath(): string {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agi-cli-control-")), "autonomy.db");
}

function action(missionId: string): RuntimeAction {
	const contract = validContract();
	return {
		id: "action-1",
		missionId,
		objectiveContractId: contract.id,
		planId: "plan-1",
		stepId: "step-1",
		role: "Builder",
		instruction: "Edit safely",
		dependencies: [],
		scopeGuard: contract.scopeGuard,
		budgetGuard: contract.budgetGuard,
		acceptanceCriteria: contract.acceptanceCriteria,
		requiredEvidence: ["test_output"],
		status: "queued",
	};
}

function lease(runtimeAction: RuntimeAction): CapabilityLease {
	return {
		leaseId: "lease-1",
		missionId: runtimeAction.missionId,
		objectiveContractId: runtimeAction.objectiveContractId,
		planId: runtimeAction.planId,
		planStepId: runtimeAction.stepId,
		actionId: runtimeAction.id,
		mode: "interactive",
		actorRole: runtimeAction.role,
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
		evidenceContract: { requiredEventTypes: ["tool.completed"], requiredEvidenceRefs: [] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
	};
}

function createRuntimeMission(db: string, objectiveId: string, title: string): { missionId: string } {
	const missionStore = new MissionStore(db);
	const objectiveStore = new ObjectiveStore(db);
	try {
		objectiveStore.create({
			id: objectiveId,
			title,
			metricTargets: [{ metric: "queued_actions", target: 1, direction: "up" }],
			budget: {},
			guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
		});
		const mission = missionStore.createMission({
			title,
			objective: title,
			objectiveId,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "executing",
			confidence: null,
			snapshotRef: null,
			mode: "interactive",
			intent: "conversation",
			lifecycle: "active",
		});
		return { missionId: mission.id };
	} finally {
		objectiveStore.close();
		missionStore.close();
	}
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = ((chunk: string | Uint8Array) => {
		output += String(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await run();
		return output;
	} finally {
		process.stdout.write = originalWrite;
	}
}

describe("agi CLI control plane", () => {
	test("prints timeline, leases, evidence, audit export, emergency-stops, and revokes leases", async () => {
		const db = tempDbPath();
		const store = new MissionStore(db);
		const mission = store.createMission({
			title: "CLI",
			objective: "Observe",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "executing",
			confidence: null,
			snapshotRef: null,
			mode: "interactive",
		});
		store.saveObjectiveContract(mission.id, validContract());
		const runtimeAction = action(mission.id);
		store.saveRuntimeAction(runtimeAction, lease(runtimeAction));
		store.appendRuntimeEvent({
			missionId: mission.id,
			streamId: "runtime",
			type: "evidence.verified",
			occurredAt: 1,
			payload: { summary: "verified", actionId: runtimeAction.id, leaseId: "lease-1" },
			evidenceRefs: ["evidence-1"],
		});
		store.close();
		try {
			let output = await captureStdout(() => runAgiCommand({ action: "timeline", db, mission: mission.id }));
			expect(output).toContain("evidence.verified");
			output = await captureStdout(() => runAgiCommand({ action: "leases", db, mission: mission.id }));
			expect(output).toContain("lease-1");
			output = await captureStdout(() => runAgiCommand({ action: "evidence", db, mission: mission.id }));
			expect(output).toContain("evidence-1");
			output = await captureStdout(() => runAgiCommand({ action: "audit-export", db, mission: mission.id }));
			expect(output).toContain("evidence.verified");
			output = await captureStdout(() =>
				runAgiCommand({ action: "emergency-stop", db, mission: mission.id, reason: "panic" }),
			);
			expect(output).toContain("stopped");
			expect(new MissionStore(db).getAgiEmergencyStop(mission.id)?.reason).toBe("panic");
			output = await captureStdout(() =>
				runAgiCommand({ action: "revoke-lease", db, lease: "lease-1", reason: "test" }),
			);
			expect(output).toContain("revoked");
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});

	test("strict runtime profile ticks idempotently and persists verified action evidence", async () => {
		const db = tempDbPath();
		try {
			const { missionId } = createRuntimeMission(db, "objective-runtime", "Observe strict runtime");
			const criteriaStore = new MissionStore(db);
			criteriaStore.saveAcceptanceCriteria(missionId, [
				{ id: "criterion-runtime", description: "Runtime queues one governed action", satisfied: false },
			]);
			criteriaStore.close();

			const output = await captureStdout(async () => {
				await runAgiCommand({ action: "runtime", profile: "strict-supervised", db });
				await runAgiCommand({ action: "runtime", profile: "strict-supervised", db });
			});

			expect(output).toContain("queued=1");
			expect(output).toContain("allowed=1");
			expect(output).toContain("blocked=0");
			expect(output).toContain("completed=1");
			expect(output).toContain("queued=0");

			const reopened = new MissionStore(db);
			try {
				const actions = reopened.listRuntimeActionsForMission(missionId);
				expect(actions).toHaveLength(1);
				expect(actions[0]?.status).toBe("verified");
				expect(reopened.getMission(missionId)?.state).toBe("completed");
				expect(actions[0]?.lease?.allowedTools).toEqual(["read"]);
				expect(reopened.getPlan(missionId)?.steps.map(step => step.id)).toEqual(["strict-supervised-observe"]);
				expect(reopened.listTasks(missionId).map(task => task.planStepId)).toEqual(["strict-supervised-observe"]);
				const events = reopened.listRuntimeEvents(missionId);
				expect(
					events.some(
						event =>
							event.type === "runtime_action.completed" && event.evidenceRefs?.[0]?.startsWith("tool:read:"),
					),
				).toBe(true);
				expect(events.some(event => event.type === "mission.tool.requested")).toBe(true);
				expect(events.some(event => event.type === "mission.tool.completed")).toBe(true);
				expect(events.some(event => event.type === "runtime.metric" && event.payload.passed === true)).toBe(true);
				expect(events.some(event => event.type === "evidence.verified" && event.payload.status === "pass")).toBe(
					true,
				);
			} finally {
				reopened.close();
			}
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});

	test("strict runtime profile honors persisted emergency stop", async () => {
		const db = tempDbPath();
		try {
			const { missionId } = createRuntimeMission(db, "objective-stopped", "Stopped runtime");
			const store = new MissionStore(db);
			store.recordAgiEmergencyStop(missionId, "operator stop");
			store.close();

			const output = await captureStdout(() =>
				runAgiCommand({ action: "runtime", profile: "strict-supervised", db }),
			);

			expect(output).toContain("blocked=1");
			expect(output).toContain("missionBlocked=1");
			const reopened = new MissionStore(db);
			try {
				expect(reopened.listRuntimeActionsForMission(missionId)[0]?.status).toBe("blocked");
				expect(reopened.getMission(missionId)?.state).toBe("blocked");
			} finally {
				reopened.close();
			}
		} finally {
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});
});
