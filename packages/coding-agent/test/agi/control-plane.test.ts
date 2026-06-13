import { describe, expect, test } from "bun:test";
import {
	AgiGovernance,
	buildMissionTimeline,
	MemoryBackedResearchLoop,
	objectiveIsRunnable,
	orderObjectivesByPriority,
	retireObjective,
} from "../../src/agi";
import type { MemoryItem } from "../../src/agi/memory";
import type { Objective, RuntimeAction } from "../../src/autonomy";
import { MissionStore } from "../../src/mission/store";
import { validContract } from "./objective-contract.test";

function objective(id: string, priority: number): Objective {
	return {
		id,
		title: id,
		metricTargets: [],
		budget: {},
		guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
		status: "active",
		priority,
	};
}

function action(): RuntimeAction {
	const contract = validContract();
	return {
		id: "action-1",
		missionId: "mission-1",
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

describe("AGI control plane", () => {
	test("timeline renders runtime events in order", () => {
		const store = new MissionStore(":memory:");
		const mission = store.createMission({
			title: "Timeline",
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
		store.appendRuntimeEvent({
			missionId: mission.id,
			streamId: "runtime",
			type: "runtime_action.queued",
			occurredAt: 1,
			payload: { actionId: "action-1", summary: "queued" },
		});
		store.appendRuntimeEvent({
			missionId: mission.id,
			streamId: "runtime",
			type: "evidence.verified",
			occurredAt: 2,
			payload: { summary: "verified" },
			evidenceRefs: ["verification-1"],
		});

		const timeline = buildMissionTimeline({ missionId: mission.id, store });
		expect(timeline.map(event => event.type)).toEqual(["runtime_action.queued", "evidence.verified"]);
		expect(timeline[1]?.evidenceRefs).toEqual(["verification-1"]);
		store.close();
	});

	test("governance blocks high risk leases without approval and supports emergency stop", () => {
		const governance = new AgiGovernance({ now: () => 10 });
		const runtimeAction = action();
		const request = governance.requestApproval(runtimeAction, "high");
		expect(request.status).toBe("pending");
		expect(governance.approve(request.id, "operator").status).toBe("approved");
		governance.stopMission("mission-1");
		expect(() => governance.assertLeaseMayRun({ missionId: "mission-1", allowedRisk: "LOW" } as never)).toThrow(
			/emergency-stopped/,
		);
	});

	test("objective manager orders priority and excludes retired objectives", () => {
		const ordered = orderObjectivesByPriority([objective("low", 1), objective("high", 10)]);
		expect(ordered.map(item => item.id)).toEqual(["high", "low"]);
		const retired = retireObjective(objective("done", 5), "finished", 20);
		expect(objectiveIsRunnable(retired)).toBe(false);
	});

	test("research loop blocks freshness policy without fresh citations", async () => {
		const stale: MemoryItem = {
			id: "stale",
			level: "L4",
			scope: {},
			kind: "claim",
			content: "old",
			sourceRefs: [{ kind: "provider", uri: "https://example.test", observedAt: 1 }],
			confidence: "high",
			verified: true,
			createdAt: 1,
			updatedAt: 1,
		};
		const loop = new MemoryBackedResearchLoop({
			now: () => 10 * 24 * 60 * 60 * 1000,
			memory: { query: async () => [stale], record: async () => stale, linkClaims: async () => undefined },
		});
		const result = await loop.satisfyFreshnessPolicy({
			missionId: "mission-1",
			contract: { ...validContract(), freshnessPolicy: { researchRequired: true, maxSourceAgeDays: 1 } },
		});
		expect(result.satisfied).toBe(false);
		expect(result.blockers).toContain("fresh citation evidence required before mutation");
	});
});
