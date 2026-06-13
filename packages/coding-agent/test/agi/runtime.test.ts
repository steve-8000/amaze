import { describe, expect, test } from "bun:test";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { MemoryItem } from "../../src/agi/memory";
import { AgiRuntime } from "../../src/agi/runtime";
import type { Objective, ObjectiveContract, RuntimeAction } from "../../src/autonomy";
import type { Mission } from "../../src/mission/core/mission";
import { validContract } from "./objective-contract.test";

const mission = {
	id: "mission-1",
	title: "Mission",
	objective: "Use durable memory",
	mode: "interactive",
	lifecycle: "active",
	riskLevel: "medium",
	state: "executing",
	confidence: null,
	snapshotRef: null,
	createdAt: 1,
	updatedAt: 1,
	revision: 1,
	acceptanceCriteria: [{ id: "criterion-1", description: "Uses memory", required: true }],
	constraints: [],
} as unknown as Mission;

const objective: Objective = {
	id: "objective-1",
	title: "Memory objective",
	metricTargets: [],
	budget: {},
	guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
	status: "active",
};

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
		evidenceContract: { requiredEventTypes: ["tool.completed"], requiredEvidenceRefs: [] },
		issuedAt: 1,
		expiresAt: Date.now() + 60_000,
	};
}

describe("AgiRuntime", () => {
	test("injects provenance-filtered memory into planning and persists routed action", async () => {
		let plannerMemory: MemoryItem[] | undefined;
		let savedContract: ObjectiveContract | undefined;
		let savedAction: RuntimeAction | undefined;
		const statuses: RuntimeAction["status"][] = [];
		const eventRefs: string[][] = [];
		let verifierRequirement: string | undefined;
		const memoryItem: MemoryItem = {
			id: "memory-1",
			level: "L2",
			scope: { missionId: "mission-1", objectiveId: "objective-1" },
			kind: "claim",
			content: "Prior fact",
			sourceRefs: [{ kind: "evidence", uri: "evidence://1", contentHash: "abc" }],
			confidence: "high",
			verified: true,
			createdAt: 1,
			updatedAt: 1,
		};
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission } as never,
			compilerModel: { compile: async () => validContract() },
			memory: { query: async () => [memoryItem], record: async () => memoryItem, linkClaims: async () => undefined },
			planner: {
				planMission: async input => {
					plannerMemory = input.memory;
					return {
						id: "plan-1",
						steps: [
							{
								id: "step-1",
								kind: "implementation",
								description: "Edit the scheduler.",
								touches: ["packages/coding-agent/src/autonomy/scheduler.ts"],
								requiresWrite: true,
							},
						],
					};
				},
			},
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			executor: {
				execute: async ({ action }) => ({
					actionId: action.id,
					status: "succeeded",
					evidenceRefs: ["test-output"],
				}),
			},
			store: {
				saveObjectiveContract: (_missionId, contract) => {
					savedContract = contract;
				},
				saveRuntimeAction: action => {
					savedAction = action;
				},
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					eventRefs.push(event.evidenceRefs ?? []);
				},
			},
			verifier: {
				verifyMission: async input => {
					verifierRequirement = input.requirements[0]?.evidenceKinds[0];
					return {
						missionId: input.missionId,
						objectiveContractId: input.objectiveContractId,
						status: "pass",
						criteria: [],
						checkedAt: 1,
					};
				},
			},
		});

		const result = await runtime.tick();
		expect(result.actionsQueued).toBe(1);
		expect(result.actionsAllowed).toBe(1);
		expect(plannerMemory?.map(item => item.id)).toEqual(["memory-1"]);
		expect(savedContract?.id).toBe("contract-1");
		expect(savedAction?.stepId).toBe("step-1");
		expect(statuses).toEqual(["running", "succeeded", "verified"]);
		expect(eventRefs).toEqual([["test-output"]]);
		expect(verifierRequirement).toBe("test_output");
	});
});
