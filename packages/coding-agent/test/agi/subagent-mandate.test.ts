import { describe, expect, it } from "bun:test";
import {
	MissionSubagentGate,
	type RoleRunner,
	SubAgentOrchestrator,
	shouldEnforceSubagentGate,
} from "../../src/agi/subagent-orchestrator";
import { expandSubAgentRoles } from "../../src/agi/subagent-policy";
import { type SubAgentResult, synthesizeSubAgentResults } from "../../src/agi/subagent-result-synthesizer";
import type { ContractiblePlanStep, ObjectiveContract, ObjectiveRisk } from "../../src/autonomy/types";

function contract(over: Partial<ObjectiveContract> = {}): ObjectiveContract {
	return {
		id: "contract-1",
		objective: "Do the work",
		nonGoals: [],
		acceptanceCriteria: [],
		requiredEvidence: {},
		scopeGuard: { include: ["**"], exclude: [], allowedCommands: [], forbiddenActions: [] },
		budgetGuard: { maxRuntimeActions: 1, maxRetriesPerAction: 0, maxParallelActions: 1 },
		autonomyMode: "supervised",
		risk: "low",
		rolePolicy: {
			capabilities: [],
			defaultRoleByStepKind: {},
			requireReviewerForRisk: ["high", "critical"],
			requireSecurityFor: [],
			requireSreFor: [],
		},
		...over,
	};
}

function step(over: Partial<ContractiblePlanStep> = {}): ContractiblePlanStep {
	return { id: "s1", kind: "implementation", description: "do it", ...over };
}

function plan(steps: ContractiblePlanStep[]) {
	return { id: "plan-1", steps };
}

describe("expandSubAgentRoles", () => {
	it("always mandates a Planner", () => {
		const { roles } = expandSubAgentRoles({ contract: contract(), plan: plan([step({ requiresWrite: false })]) });
		expect(roles).toContain("Planner");
	});

	it("mandates Builder + Reviewer + Verifier for any workspace mutation", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract(),
			plan: plan([step({ requiresWrite: true })]),
		});
		expect(roles).toEqual(expect.arrayContaining(["Builder", "Reviewer", "Verifier"]));
	});

	it("adds a Critic at high risk", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract({ risk: "high" }),
			plan: plan([step()]),
		});
		expect(roles).toContain("Critic");
	});

	it("does not add a Critic at low/medium risk", () => {
		for (const risk of ["low", "medium"] as ObjectiveRisk[]) {
			const { roles } = expandSubAgentRoles({ contract: contract({ risk }), plan: plan([step()]) });
			expect(roles).not.toContain("Critic");
		}
	});

	it("adds a Researcher when freshness requires research", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract({ freshnessPolicy: { researchRequired: true } }),
			plan: plan([step()]),
		});
		expect(roles).toContain("Researcher");
	});

	it("adds Security when a step matches the security scope policy", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract({
				rolePolicy: {
					capabilities: [],
					defaultRoleByStepKind: {},
					requireReviewerForRisk: [],
					requireSecurityFor: ["packages/coding-agent/src/auth"],
					requireSreFor: [],
				},
			}),
			plan: plan([step({ touches: ["packages/coding-agent/src/auth/login.ts"] })]),
		});
		expect(roles).toContain("Security");
	});

	it("adds SRE when a step operates infrastructure", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract(),
			plan: plan([step({ requiresInfrastructure: true })]),
		});
		expect(roles).toContain("SRE");
	});

	it("mandates the full self-improvement set regardless of plan shape", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract(),
			plan: plan([step({ requiresWrite: false })]),
			selfImprovement: true,
		});
		expect(roles).toEqual(expect.arrayContaining(["Critic", "Security", "Reviewer", "Verifier"]));
	});

	it("emits roles in stable declaration order", () => {
		const { roles } = expandSubAgentRoles({
			contract: contract({ risk: "critical", freshnessPolicy: { researchRequired: true } }),
			plan: plan([step({ requiresWrite: true })]),
		});
		const order = ["Planner", "Researcher", "Builder", "Reviewer", "Verifier", "Critic"];
		const filtered = order.filter(role => roles.includes(role as never));
		expect(roles).toEqual(filtered as never);
	});
});

describe("synthesizeSubAgentResults", () => {
	const ok = (role: SubAgentResult["role"], over: Partial<SubAgentResult> = {}): SubAgentResult => ({
		taskId: `t-${role}`,
		role,
		status: "completed",
		evidenceRefs: [`evidence://${role}`],
		...over,
	});

	it("accepts when Builder + Reviewer(pass) + Verifier(pass) all clear", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { changedFiles: ["a.ts"] }),
			ok("Reviewer", { verdict: "pass" }),
			ok("Verifier", { verdict: "pass" }),
		]);
		expect(decision.kind).toBe("accept");
	});

	it("requests revision from Builder when the Reviewer fails", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { changedFiles: ["a.ts"] }),
			ok("Reviewer", { verdict: "fail", note: "naming is wrong" }),
			ok("Verifier", { verdict: "pass" }),
		]);
		expect(decision).toMatchObject({ kind: "needs_revision", targetRole: "Builder" });
	});

	it("blocks when the Verifier reports insufficient evidence", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { changedFiles: ["a.ts"] }),
			ok("Reviewer", { verdict: "pass" }),
			ok("Verifier", { verdict: "fail", note: "no test output" }),
		]);
		expect(decision.kind).toBe("blocked");
	});

	it("blocks (never soft-revision) on a Security failure", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { changedFiles: ["a.ts"] }),
			ok("Reviewer", { verdict: "pass" }),
			ok("Verifier", { verdict: "pass" }),
			ok("Security", { verdict: "fail", note: "writes outside scope" }),
		]);
		expect(decision.kind).toBe("blocked");
		if (decision.kind === "blocked") expect(decision.reason).toContain("Security");
	});

	it("blocks when a gating role returns no verdict", () => {
		const decision = synthesizeSubAgentResults([ok("Builder", { changedFiles: ["a.ts"] }), ok("Reviewer")]);
		expect(decision.kind).toBe("blocked");
	});

	it("blocks on conflicting changed files across subagents", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { taskId: "b1", changedFiles: ["shared.ts"] }),
			ok("Builder", { taskId: "b2", changedFiles: ["shared.ts"] }),
			ok("Reviewer", { verdict: "pass" }),
			ok("Verifier", { verdict: "pass" }),
		]);
		expect(decision.kind).toBe("blocked");
		if (decision.kind === "blocked") expect(decision.conflicts.map(c => c.path)).toContain("shared.ts");
	});

	it("blocks when files changed but no evidence was produced", () => {
		const decision = synthesizeSubAgentResults([
			ok("Builder", { changedFiles: ["a.ts"], evidenceRefs: [] }),
			ok("Reviewer", { verdict: "pass", evidenceRefs: [] }),
			ok("Verifier", { verdict: "pass", evidenceRefs: [] }),
		]);
		expect(decision.kind).toBe("blocked");
	});

	it("blocks when any subagent failed to complete", () => {
		const decision = synthesizeSubAgentResults([ok("Planner"), { ...ok("Builder"), status: "failed" }]);
		expect(decision.kind).toBe("blocked");
	});
});

describe("SubAgentOrchestrator", () => {
	it("demotes a role to blocked when it omits its mandated artifact", async () => {
		const runRole: RoleRunner = async ({ role }) => ({
			status: "completed",
			evidenceRefs: [`evidence://${role}`],
			artifacts: [], // produced nothing
		});
		const orchestrator = new SubAgentOrchestrator({
			missionId: "m1",
			objectiveContractId: "c1",
			planId: "p1",
			runRole,
		});
		const { results, decision } = await orchestrator.run({ roles: ["Planner"], rationale: {} });
		expect(results[0]?.status).toBe("blocked");
		expect(decision.kind).toBe("blocked");
	});

	it("runs every mandated role and accepts when artifacts + verdicts clear", async () => {
		const ran: string[] = [];
		const runRole: RoleRunner = async ({ role }) => {
			ran.push(role);
			const artifacts =
				{
					Planner: ["plan_steps.json"],
					Builder: ["changed_files.json"],
					Reviewer: ["review_findings.json"],
					Verifier: ["verification_result.json"],
				}[role as string] ?? [];
			return {
				status: "completed",
				evidenceRefs: [`evidence://${role}`],
				artifacts,
				...(role === "Builder" ? { changedFiles: ["a.ts"] } : {}),
				...(role === "Reviewer" || role === "Verifier" ? { verdict: "pass" as const } : {}),
			};
		};
		const gate = new MissionSubagentGate({ runRole });
		const decision = await gate.enforce({
			mission: { id: "m1" } as never,
			contract: contract(),
			plan: plan([step({ requiresWrite: true })]),
		});
		expect(ran).toEqual(expect.arrayContaining(["Planner", "Builder", "Reviewer", "Verifier"]));
		expect(decision.kind).toBe("accept");
	});

	it("dispatches mandated roles concurrently", async () => {
		let running = 0;
		let peak = 0;
		const release: Array<() => void> = [];
		const runRole: RoleRunner = async ({ role }) => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise<void>(resolve => release.push(resolve));
			running -= 1;
			return {
				status: "completed",
				evidenceRefs: [`evidence://${role}`],
				artifacts: role === "Planner" ? ["plan_steps.json"] : ["changed_files.json"],
				...(role === "Builder" ? { changedFiles: [`${role}.ts`] } : {}),
			};
		};
		const orchestrator = new SubAgentOrchestrator({
			missionId: "m1",
			objectiveContractId: "c1",
			planId: "p1",
			runRole,
		});

		const pending = orchestrator.run({ roles: ["Planner", "Builder"], rationale: {} });
		await Promise.resolve();
		expect(peak).toBe(2);
		for (const resolve of release) resolve();
		await pending;
	});
});

describe("shouldEnforceSubagentGate", () => {
	it("requires the gate for every workspace-mutating profile", () => {
		expect(shouldEnforceSubagentGate("strict-mutation")).toBe(true);
		expect(shouldEnforceSubagentGate("strict-self-improve")).toBe(true);
	});

	it("skips the gate only for the read-only observe profile and its legacy alias", () => {
		expect(shouldEnforceSubagentGate("strict-observe")).toBe(false);
		expect(shouldEnforceSubagentGate("strict-supervised")).toBe(false);
	});
});
