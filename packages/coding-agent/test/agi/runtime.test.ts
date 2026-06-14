import { describe, expect, test } from "bun:test";
import type { CapabilityLease } from "../../src/agi/capability-lease";
import type { MemoryItem } from "../../src/agi/memory";
import { AgiRuntime } from "../../src/agi/runtime";
import type { Objective, ObjectiveContract, RuntimeAction } from "../../src/autonomy";
import type { Mission } from "../../src/mission/core/mission";
import type { MissionCompleteOptions } from "../../src/mission/core/mission-runtime.iface";
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
		let savedPlanSteps: string[] = [];
		const savedTaskIds: string[] = [];
		let verifierRequirement: string | undefined;
		let completedOutcome: unknown;
		const memoryItem: MemoryItem = {
			id: "memory-1",
			level: "L2",
			scope: { missionId: "mission-1", objectiveId: "objective-1" },
			kind: "claim",
			content: "Prior fact",
			sourceRefs: [{ kind: "evidence", uri: "evidence://1", contentHash: "abc", observedAt: 1 }],
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
			missionRuntime: {
				tryGet: () => mission,
				recordVerification: () => mission,
				complete: async (_missionId: string, options: MissionCompleteOptions) => {
					completedOutcome = options.outcome;
					return mission;
				},
			} as never,
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
				savePlan: (_missionId, plan) => {
					savedPlanSteps = plan.steps.map(step => step.id);
				},
				saveTask: task => {
					savedTaskIds.push(task.id);
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
		expect(result.missionsCompleted).toBe(1);
		expect(savedContract?.id).toBe("contract-1");
		expect(savedAction?.stepId).toBe("step-1");
		expect(statuses).toEqual(["running", "succeeded", "verified"]);
		expect(savedPlanSteps).toEqual(["step-1"]);
		expect(savedTaskIds).toEqual(["mission-1:task:step-1"]);
		expect(eventRefs).toEqual([["test-output"]]);
		expect(verifierRequirement).toBe("test_output");
		expect(completedOutcome).toMatchObject({ status: "success", evidenceRefs: ["test-output"] });
	});

	test("reuses the mission's persisted objective contract instead of recompiling", async () => {
		let compilerCalled = false;
		let plannerContract: ObjectiveContract | undefined;
		let savedContract = false;
		const persistedContract = { ...validContract(), id: "persisted-contract" };
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission } as never,
			compilerModel: {
				compile: async () => {
					compilerCalled = true;
					return validContract();
				},
			},
			planner: {
				planMission: async input => {
					plannerContract = input.contract;
					return { id: "plan-1", steps: [] };
				},
			},
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			store: {
				getLatestObjectiveContractForMission: missionId => {
					expect(missionId).toBe("mission-1");
					return { contract: persistedContract };
				},
				saveObjectiveContract: () => {
					savedContract = true;
				},
			},
		});

		const result = await runtime.tick();

		expect(result.missionsObserved).toBe(1);
		expect(compilerCalled).toBe(false);
		expect(savedContract).toBe(false);
		expect(plannerContract?.id).toBe("persisted-contract");
	});

	test("skips already advanced actions on repeated strict ticks", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const savedTaskIds: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission } as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			store: {
				getRuntimeAction: () => ({ status: "verified" }),
				saveTask: task => {
					savedTaskIds.push(task.id);
				},
				saveRuntimeAction: () => {
					throw new Error("must not resave advanced action");
				},
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
			},
		});

		const result = await runtime.tick();
		expect(result.actionsQueued).toBe(0);
		expect(result.actionsAllowed).toBe(0);
		expect(statuses).toEqual([]);
		expect(savedTaskIds).toEqual([]);
	});

	test("blocks actions before gateway dispatch when governance rejects the lease", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const events: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission, block: async () => mission } as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: {
				decide: async () => {
					throw new Error("gateway must not run after governance denial");
				},
			},
			governance: {
				assertLeaseMayRun: () => {
					throw new Error("Mission is emergency-stopped: mission-1");
				},
			},
			store: {
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					events.push(event.type);
				},
			},
		});

		const result = await runtime.tick();

		expect(result.actionsQueued).toBe(0);
		expect(result.actionsBlocked).toBe(1);
		expect(result.missionsBlocked).toBe(1);
		expect(statuses).toEqual(["blocked"]);
		expect(events).toContain("runtime.governance.blocked");
	});

	test("captures sandbox diff and rolls back failed sandbox actions", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const events: string[] = [];
		const rollbacks: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission, block: async () => mission } as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: {
				issue: ({ action }) => ({
					...leaseFor(action),
					sandbox: { mode: "isolated-worktree", baselineRef: "HEAD", rollbackRefs: ["rollback-1"] },
				}),
			},
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			executor: {
				execute: async ({ action }) => ({
					actionId: action.id,
					status: "failed",
					evidenceRefs: ["test-output"],
					error: "failed in sandbox",
				}),
			},
			sandbox: {
				create: async ({ missionId, actionId }) => ({
					id: "sandbox-1",
					missionId,
					actionId,
					mode: "isolated-worktree",
					cwd: "/tmp/sandbox",
					baselineRef: "HEAD",
					createdAt: 1,
				}),
				captureDiff: async () => ({ diffRef: "sandbox-diff://sandbox-1", contentHash: "hash-1" }),
				applyToMain: async () => ({ appliedRef: "applied", rollbackRef: "rollback-1" }),
				rollback: async ({ rollbackRef }) => {
					rollbacks.push(rollbackRef);
				},
				dispose: async () => undefined,
			},
			store: {
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					events.push(event.type);
				},
			},
		});

		const result = await runtime.tick();

		expect(result.actionsAllowed).toBe(1);
		expect(result.missionsBlocked).toBe(1);
		expect(statuses).toEqual(["running", "failed"]);
		expect(events).toContain("sandbox.diff_captured");
		expect(rollbacks).toEqual(["rollback-1"]);
	});

	test("blocks research-required objectives when planning memory lacks provenance", async () => {
		let plannerCalled = false;
		const staleMemory: MemoryItem = {
			id: "memory-stale",
			level: "L2",
			scope: { missionId: "mission-1", objectiveId: "objective-1" },
			kind: "claim",
			content: "Stale fact",
			sourceRefs: [{ kind: "evidence", uri: "evidence://stale" }],
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
			missionRuntime: { tryGet: () => mission, block: async () => mission } as never,
			compilerModel: {
				compile: async () => ({
					...validContract(),
					freshnessPolicy: { researchRequired: true },
				}),
			},
			memory: {
				query: async () => [staleMemory],
				record: async () => staleMemory,
				linkClaims: async () => undefined,
			},
			planner: {
				planMission: async () => {
					plannerCalled = true;
					return { id: "plan-1", steps: [] };
				},
			},
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
		});

		const result = await runtime.tick();

		expect(result.missionsBlocked).toBe(1);
		expect(plannerCalled).toBe(false);
	});

	test("blocks recovered running actions instead of skipping forever", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const events: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission, block: async () => mission } as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: {
				decide: async () => {
					throw new Error("running recovery must not dispatch");
				},
			},
			store: {
				getRuntimeAction: () => ({ status: "running" }),
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					events.push(event.type);
				},
			},
		});

		const result = await runtime.tick();

		expect(result.actionsBlocked).toBe(1);
		expect(result.missionsBlocked).toBe(1);
		expect(statuses).toEqual(["blocked"]);
		expect(events).toContain("runtime_action.recovered_non_terminal");
	});
	test("blocks succeeded actions with insufficient evidence instead of leaving them dangling", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const events: string[] = [];
		const rollbacks: string[] = [];
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
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: {
				issue: ({ action }) => ({
					...leaseFor(action),
					sandbox: { mode: "isolated-worktree", baselineRef: "HEAD", rollbackRefs: ["rollback-1"] },
				}),
			},
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			executor: {
				execute: async ({ action }) => ({
					actionId: action.id,
					status: "succeeded",
					evidenceRefs: ["test-output"],
				}),
			},
			sandbox: {
				create: async ({ missionId, actionId }) => ({
					id: "sandbox-1",
					missionId,
					actionId,
					mode: "isolated-worktree",
					cwd: "/tmp/sandbox",
					baselineRef: "HEAD",
					createdAt: 1,
				}),
				captureDiff: async () => ({ diffRef: "sandbox-diff://sandbox-1", contentHash: "hash-1" }),
				applyToMain: async () => {
					throw new Error("must not apply when evidence is insufficient");
				},
				rollback: async ({ rollbackRef }) => {
					rollbacks.push(rollbackRef);
				},
				dispose: async () => undefined,
			},
			verifier: {
				verifyMission: async input => ({
					missionId: input.missionId,
					objectiveContractId: input.objectiveContractId,
					status: "insufficient_evidence",
					criteria: [],
					checkedAt: 1,
				}),
			},
			store: {
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					events.push(event.type);
				},
			},
		});

		const result = await runtime.tick();

		expect(statuses).toEqual(["running", "succeeded", "blocked"]);
		expect(events).toContain("runtime_action.evidence_insufficient");
		expect(rollbacks).toEqual(["rollback-1"]);
		expect(result.missionsBlocked).toBe(1);
		expect(result.missionsCompleted).toBe(0);
		expect(blockedReason).toContain("blocked");
	});
	test("recovers dangling succeeded actions to blocked instead of skipping forever", async () => {
		const statuses: RuntimeAction["status"][] = [];
		const events: { type: string; previousStatus?: string }[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: { tryGet: () => mission, block: async () => mission } as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: {
				decide: async () => {
					throw new Error("succeeded recovery must not dispatch");
				},
			},
			store: {
				getRuntimeAction: () => ({ status: "succeeded" }),
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: event => {
					events.push({
						type: event.type,
						previousStatus: (event.payload as { previousStatus?: string })?.previousStatus,
					});
				},
			},
		});

		const result = await runtime.tick();

		expect(result.actionsBlocked).toBe(1);
		expect(result.missionsBlocked).toBe(1);
		expect(result.missionsCompleted).toBe(0);
		expect(statuses).toEqual(["blocked"]);
		const recovered = events.find(event => event.type === "runtime_action.recovered_non_terminal");
		expect(recovered?.previousStatus).toBe("succeeded");
	});
	test("blocks a partial plan whose actions never reach a terminal status", async () => {
		const statuses: RuntimeAction["status"][] = [];
		let blockedReason: string | undefined;
		let recordedVerdict: string | undefined;
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: {
				tryGet: () => mission,
				recordVerification: (_missionId: string, verification: { verdict: string }) => {
					recordedVerdict = verification.verdict;
					return mission;
				},
				block: async (_missionId: string, options: { reason: string }) => {
					blockedReason = options.reason;
					return mission;
				},
				complete: async () => {
					throw new Error("partial plan must not complete");
				},
			} as never,
			compilerModel: { compile: async () => validContract() },
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
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			// No executor: the action is marked `running` and then left non-terminal. The plan is
			// neither fully verified nor failed/blocked, so it must block rather than silently no-op.
			store: {
				markRuntimeAction: (_actionId, status) => {
					statuses.push(status);
				},
				appendRuntimeEvent: () => {},
			},
		});

		const result = await runtime.tick();

		expect(statuses).toEqual(["running"]);
		expect(result.missionsCompleted).toBe(0);
		expect(result.missionsBlocked).toBe(1);
		expect(recordedVerdict).toBe("pending");
		expect(blockedReason).toContain("unsettled");
	});

	test("replans a partial runtime plan instead of blocking when a replanner is configured", async () => {
		const savedPlans: string[] = [];
		const events: string[] = [];
		const runtime = new AgiRuntime({
			scheduler: {
				tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
			},
			objectives: { get: () => objective },
			missionRuntime: {
				tryGet: () => mission,
				recordVerification: () => mission,
				block: async () => {
					throw new Error("replanned mission must not block");
				},
			} as never,
			compilerModel: { compile: async () => validContract() },
			planner: {
				planMission: async () => ({
					id: "plan-1",
					steps: [
						{
							id: "step-1",
							kind: "implementation",
							description: "Edit the scheduler.",
							requiresWrite: true,
						},
					],
				}),
			},
			leaseIssuer: { issue: ({ action }) => leaseFor(action) },
			toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
			replanner: {
				replan: async () => ({
					summary: "replanned",
					plan: {
						id: "replan-1",
						steps: [{ id: "recover", kind: "replan", description: "Recover", requiresWrite: false }],
					},
				}),
			},
			store: {
				getLatestObjectiveContractForMission: () => ({ contract: validContract() }),
				markRuntimeAction: () => {},
				savePlan: (_missionId, plan) => {
					savedPlans.push(plan.steps.map(step => step.id).join(","));
				},
				appendRuntimeEvent: event => {
					events.push(event.type);
				},
			},
		});

		const result = await runtime.tick();

		expect(result.missionsBlocked).toBe(0);
		expect(result.actionsQueued).toBe(2);
		expect(savedPlans).toEqual(["step-1", "recover"]);
		expect(events).toContain("replan.generated");
	});
});
