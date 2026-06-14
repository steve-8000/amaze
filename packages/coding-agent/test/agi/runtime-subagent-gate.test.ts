import { describe, expect, test } from "bun:test";
import { AgiRuntime, type AgiRuntimeSubagentGate } from "../../src/agi/runtime";
import { MissionSubagentGate } from "../../src/agi/subagent-orchestrator";
import type { Objective } from "../../src/autonomy";
import type { Mission } from "../../src/mission/core/mission";
import { validContract } from "./objective-contract.test";

const objective: Objective = {
	id: "objective-1",
	title: "Gate objective",
	metricTargets: [],
	budget: {},
	guardrails: { requireHumanForApply: false, maxAutoSubgoalsPerDay: 1, forbiddenScopes: [] },
	status: "active",
};

const mission = {
	id: "mission-1",
	title: "Mission",
	objective: "Mutate the scheduler",
	mode: "interactive",
	acceptanceCriteria: [{ id: "criterion-1", description: "Mutates", required: true }],
	constraints: [],
} as unknown as Mission;

function baseDeps(gate: AgiRuntimeSubagentGate) {
	const blocked: Array<{ reason: string }> = [];
	const leaseCalls: string[] = [];
	const deps = {
		scheduler: {
			tick: async () => [{ objectiveId: "objective-1", kind: "schedule-mission", missionId: "mission-1" }],
		},
		objectives: { get: () => objective },
		missionRuntime: {
			tryGet: () => mission,
			block: async (_missionId: string, options: { reason: string }) => {
				blocked.push({ reason: options.reason });
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
			issue: ({ action }: { action: { id: string } }) => {
				leaseCalls.push(action.id);
				return { allowedTools: ["edit"] } as never;
			},
		},
		toolGateway: { decide: async () => ({ allowed: true, riskLevel: "HIGH", timeoutMs: 30_000 }) },
		subagentGate: gate,
	};
	return { deps, blocked, leaseCalls };
}

describe("AgiRuntime subagent gate", () => {
	test("blocks the mission and never issues a lease when subagents do not clear", async () => {
		const { deps, blocked, leaseCalls } = baseDeps({
			enforce: async () => ({
				kind: "blocked",
				reason: "Reviewer rejected the change.",
				conflicts: [],
				evidenceRefs: ["evidence://reviewer"],
			}),
		});
		const runtime = new AgiRuntime(deps as never);
		const result = await runtime.tick();

		expect(result.missionsBlocked).toBe(1);
		expect(result.actionsQueued).toBe(0);
		expect(leaseCalls).toEqual([]); // no execution path was entered
		expect(blocked[0]?.reason).toContain("Mandatory subagents did not clear the plan");
	});

	test("blocks the mission when subagents demand a revision", async () => {
		const { deps, blocked } = baseDeps({
			enforce: async () => ({
				kind: "needs_revision",
				targetRole: "Builder",
				revisionRequest: "Fix the naming.",
			}),
		});
		const runtime = new AgiRuntime(deps as never);
		const result = await runtime.tick();

		expect(result.missionsBlocked).toBe(1);
		expect(blocked[0]?.reason).toContain("require revision by Builder");
	});

	test("proceeds to lease issuance when the gate accepts", async () => {
		const { deps, leaseCalls } = baseDeps({
			enforce: async () => ({ kind: "accept", evidenceRefs: ["evidence://ok"], changedFiles: ["a.ts"] }),
		});
		const runtime = new AgiRuntime(deps as never);
		const result = await runtime.tick();

		// Acceptance lets the plan advance to action routing + lease issuance.
		expect(leaseCalls).toEqual(["mission-1:step-1"]);
		expect(result.actionsQueued).toBe(1);
	});

	test("strict-mutation composition: real gate blocks before lease when the Builder leaves no artifact", async () => {
		// A mutating plan mandates Builder + Reviewer + Verifier. Here the Builder runs but produces
		// no `changed_files.json`, so the orchestrator demotes it to blocked and the synthesizer
		// blocks the plan — proving the mandate is enforced end-to-end, not merely advertised.
		const ran: string[] = [];
		const gate = new MissionSubagentGate({
			runRole: async ({ role }) => {
				ran.push(role);
				return { status: "completed", evidenceRefs: [`evidence://${role}`], artifacts: [] };
			},
		});
		const { deps, blocked, leaseCalls } = baseDeps(gate);
		const runtime = new AgiRuntime(deps as never);
		const result = await runtime.tick();

		expect(ran).toEqual(expect.arrayContaining(["Builder", "Reviewer", "Verifier"]));
		expect(result.missionsBlocked).toBe(1);
		expect(leaseCalls).toEqual([]);
		expect(blocked[0]?.reason).toContain("Mandatory subagents did not clear the plan");
	});
});
