import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { RuntimeAction } from "../../src/autonomy";
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

describe("agi CLI control plane", () => {
	test("prints timeline, leases, evidence, audit export, and revokes leases", async () => {
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

		let output = "";
		const originalWrite = process.stdout.write;
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		try {
			await runAgiCommand({ action: "timeline", db, mission: mission.id });
			expect(output).toContain("evidence.verified");
			output = "";
			await runAgiCommand({ action: "leases", db, mission: mission.id });
			expect(output).toContain("lease-1");
			output = "";
			await runAgiCommand({ action: "evidence", db, mission: mission.id });
			expect(output).toContain("evidence-1");
			output = "";
			await runAgiCommand({ action: "audit-export", db, mission: mission.id });
			expect(output).toContain("evidence.verified");
			output = "";
			await runAgiCommand({ action: "revoke-lease", db, lease: "lease-1", reason: "test" });
			expect(output).toContain("revoked");
		} finally {
			process.stdout.write = originalWrite;
			fs.rmSync(path.dirname(db), { recursive: true, force: true });
		}
	});
});
