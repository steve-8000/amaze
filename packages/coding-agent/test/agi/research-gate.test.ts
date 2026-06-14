import { describe, expect, test } from "bun:test";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { AgiMemory, MemoryItem, MemorySourceRef } from "../../src/agi/memory";
import { MemoryBackedResearchLoop } from "../../src/agi/research-loop";
import { AgiRuntime } from "../../src/agi/runtime";
import type { Objective, RuntimeAction } from "../../src/autonomy";
import type { Mission } from "../../src/mission/core/mission";
import { validContract } from "./objective-contract.test";

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

const objective: Objective = {
	id: "objective-1",
	title: "Research-gated objective",
	metricTargets: [],
	budget: {},
	guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
	status: "active",
};

const mission = {
	id: "mission-1",
	title: "Mission",
	objective: "Adopt the new API",
	mode: "interactive",
	lifecycle: "active",
	riskLevel: "medium",
	state: "executing",
	confidence: null,
	snapshotRef: null,
	createdAt: 1,
	updatedAt: 1,
	revision: 1,
	acceptanceCriteria: [{ id: "criterion-1", description: "Uses the API", required: true }],
	constraints: [],
} as unknown as Mission;

function emptyMemory(): AgiMemory {
	return {
		query: async () => [],
		record: async () => ({}) as MemoryItem,
		linkClaims: async () => undefined,
	};
}

function freshCitationMemory(): AgiMemory {
	const source: MemorySourceRef = {
		kind: "evidence",
		uri: "https://example.com/doc",
		contentHash: "hash-1",
		observedAt: Date.now(),
	};
	const item: MemoryItem = {
		id: "memory-1",
		level: "L3",
		scope: { missionId: "mission-1" },
		kind: "claim",
		content: "Adopt the new API as documented",
		sourceRefs: [source],
		confidence: "high",
		verified: true,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	return { query: async () => [item], record: async () => item, linkClaims: async () => undefined };
}

describe("MemoryBackedResearchLoop.satisfyFreshnessPolicy", () => {
	test("passes through when the contract does not require research", async () => {
		const loop = new MemoryBackedResearchLoop({ memory: emptyMemory() });
		const result = await loop.satisfyFreshnessPolicy({
			missionId: "mission-1",
			contract: validContract({ freshnessPolicy: { researchRequired: false } }),
		});
		expect(result.satisfied).toBe(true);
		expect(result.blockers).toEqual([]);
	});

	test("blocks when research is required but no fresh citation exists", async () => {
		const loop = new MemoryBackedResearchLoop({ memory: emptyMemory() });
		const result = await loop.satisfyFreshnessPolicy({
			missionId: "mission-1",
			contract: validContract({ freshnessPolicy: { researchRequired: true } }),
		});
		expect(result.satisfied).toBe(false);
		expect(result.blockers.length).toBeGreaterThan(0);
	});

	test("is satisfied when memory already holds a fresh, verifiable citation", async () => {
		const loop = new MemoryBackedResearchLoop({ memory: freshCitationMemory() });
		const result = await loop.satisfyFreshnessPolicy({
			missionId: "mission-1",
			contract: validContract({ freshnessPolicy: { researchRequired: true } }),
		});
		expect(result.satisfied).toBe(true);
		expect(result.citations.length).toBeGreaterThan(0);
	});
});

describe("AgiRuntime research gate", () => {
	test("blocks a mission whose contract requires research when none is available", async () => {
		const blocked: Array<{ missionId: string; reason: string }> = [];
		const researchEvents: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: {
				tryGet: () => mission,
				block: async (missionId: string, options: { reason: string }) => {
					blocked.push({ missionId, reason: options.reason });
					return mission;
				},
			} as never,
			compilerModel: { compile: async () => validContract({ freshnessPolicy: { researchRequired: true } }) },
			planner: {
				planMission: async () => {
					throw new Error("planner must not run when the research gate blocks the mission");
				},
			},
			leaseIssuer: { issue: ({ action }: { action: RuntimeAction }) => ({ actionId: action.id }) as never },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 1000 }) },
			research: new MemoryBackedResearchLoop({ memory: emptyMemory() }),
			store: {
				appendRuntimeEvent: (event: { type: string }) => {
					researchEvents.push(event.type);
				},
			},
		});

		const result = await runtime.tick();
		expect(result.missionsBlocked).toBe(1);
		expect(result.actionsQueued).toBe(0);
		expect(blocked).toHaveLength(1);
		expect(researchEvents).toContain("research.blocked");
	});

	test("recordLearning never crashes the tick when memory.record throws (empty-refs guard)", async () => {
		// Mirrors OkfAgiMemory.record which throws on empty sourceRefs. The blocked
		// settlement path carries no evidence, so recordLearning must skip/guard rather
		// than let the throw escape tick().
		const throwingMemory: AgiMemory = {
			query: async () => [],
			record: async () => {
				throw new Error("OKF memory item requires at least one source ref");
			},
			linkClaims: async () => undefined,
		};
		const events: string[] = [];
		let blockedReason: string | undefined;
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: {
				tryGet: () => mission,
				block: async (_missionId: string, options: { reason: string }) => {
					blockedReason = options.reason;
					return mission;
				},
			} as never,
			compilerModel: { compile: async () => validContract({ freshnessPolicy: { researchRequired: false } }) },
			memory: throwingMemory,
			planner: {
				planMission: async () => ({
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
				}),
			},
			leaseIssuer: { issue: ({ action }: { action: RuntimeAction }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 1000 }) },
			// Executor returns blocked with NO evidence — the empty-refs path.
			executor: {
				execute: async ({ action }: { action: RuntimeAction }) => ({
					actionId: action.id,
					status: "blocked" as const,
					evidenceRefs: [],
				}),
			},
			store: {
				appendRuntimeEvent: (event: { type: string }) => {
					events.push(event.type);
				},
			},
		});

		// Must not throw despite the throwing memory backend.
		const result = await runtime.tick();
		expect(result.missionsBlocked).toBe(1);
		expect(blockedReason).toBeDefined();
		// The empty-refs guard short-circuits before record, so no learning.record_failed.
		expect(events).not.toContain("learning.record_failed");
	});
});
