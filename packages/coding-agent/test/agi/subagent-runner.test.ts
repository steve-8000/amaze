import { describe, expect, it } from "bun:test";
import { buildAssignment, createBundledRoleRunner, parseRoleVerdict } from "../../src/agi/subagent-runner";
import type { RuntimeRole } from "../../src/autonomy/types";
import type { MissionTask } from "../../src/mission/core/mission-task";
import type { ExecutorOptions } from "../../src/task/executor";
import type { SingleResult } from "../../src/task/types";

function fakeResult(over: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id: "run-1",
		agent: "Builder",
		agentSource: "bundled",
		task: "do it",
		exitCode: 0,
		output: "",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		...over,
	};
}

function task(role: RuntimeRole): MissionTask {
	return { id: `m1:role:${role}`, missionId: "m1", title: `${role}`, status: "pending" };
}

describe("parseRoleVerdict", () => {
	it("reads the last verdict marker", () => {
		expect(parseRoleVerdict("blah\nROLE_VERDICT: pass")).toBe("pass");
		expect(parseRoleVerdict("ROLE_VERDICT: pass\nlater\nROLE_VERDICT: fail")).toBe("fail");
	});
	it("returns undefined without a marker", () => {
		expect(parseRoleVerdict("no marker here")).toBeUndefined();
	});
});

describe("createBundledRoleRunner", () => {
	it("threads the role assignment and surfaces evidence + completed status", async () => {
		let seenAssignment = "";
		const runner = createBundledRoleRunner({
			cwd: "/tmp/repo",
			missionId: "m1",
			runSubprocess: async (opts: ExecutorOptions) => {
				seenAssignment = opts.task;
				return fakeResult({ output: "produced changed_files.json", outputPath: "/tmp/out.md" });
			},
		});
		const outcome = await runner({ role: "Builder", task: task("Builder") });
		expect(seenAssignment).toContain("Builder");
		expect(seenAssignment).toContain("changed_files.json");
		expect(outcome.status).toBe("completed");
		expect(outcome.artifacts).toContain("changed_files.json");
		expect(outcome.evidenceRefs.some(ref => ref.startsWith("task-output://"))).toBe(true);
	});

	it("captures a gating role's verdict from its output marker", async () => {
		const runner = createBundledRoleRunner({
			cwd: "/tmp/repo",
			missionId: "m1",
			runSubprocess: async () =>
				fakeResult({ agent: "Reviewer", output: "review_findings.json written\nROLE_VERDICT: fail" }),
		});
		const outcome = await runner({ role: "Reviewer", task: task("Reviewer") });
		expect(outcome.verdict).toBe("fail");
		expect(outcome.artifacts).toContain("review_findings.json");
	});

	it("maps a non-zero exit to a failed status with the error note", async () => {
		const runner = createBundledRoleRunner({
			cwd: "/tmp/repo",
			missionId: "m1",
			runSubprocess: async () => fakeResult({ exitCode: 1, error: "boom" }),
		});
		const outcome = await runner({ role: "Builder", task: task("Builder") });
		expect(outcome.status).toBe("failed");
		expect(outcome.note).toBe("boom");
	});

	it("falls back to the Builder agent for roles without a dedicated bundled agent", async () => {
		const seenAgents: string[] = [];
		const runner = createBundledRoleRunner({
			cwd: "/tmp/repo",
			missionId: "m1",
			runSubprocess: async (opts: ExecutorOptions) => {
				seenAgents.push(opts.agent.name);
				return fakeResult({ output: "failure_modes.json" });
			},
		});
		await runner({ role: "Critic", task: task("Critic") });
		expect(seenAgents).toEqual(["Builder"]);
	});
});

describe("buildAssignment role briefs", () => {
	const ROLES: RuntimeRole[] = [
		"Planner",
		"Researcher",
		"Builder",
		"Reviewer",
		"Verifier",
		"Critic",
		"Security",
		"SRE",
		"MemoryCurator",
	];

	it("gives every routable role a distinct, non-generic brief", () => {
		const briefLines = ROLES.map(role => {
			const assignment = buildAssignment(role);
			// Second line is the role brief.
			return assignment.split("\n")[1] ?? "";
		});
		// No role falls back to the generic deliverable line.
		for (const line of briefLines) {
			expect(line).not.toBe("Produce your role's deliverable before yielding.");
		}
		// Briefs are mutually distinct (a real role society, not 9 clones).
		expect(new Set(briefLines).size).toBe(ROLES.length);
	});

	it("names the role and its mandated artifact in the assignment", () => {
		const planner = buildAssignment("Planner");
		expect(planner).toContain("Planner");
		expect(planner).toContain("plan_steps.json");
		expect(planner.toLowerCase()).toContain("decompose");

		const critic = buildAssignment("Critic");
		expect(critic).toContain("failure_modes.json");
		expect(critic.toLowerCase()).toContain("failure mode");
	});

	it("appends the verdict marker only for gating roles", () => {
		for (const role of ["Reviewer", "Verifier", "Security"] as RuntimeRole[]) {
			expect(buildAssignment(role)).toContain("ROLE_VERDICT:");
		}
		for (const role of ["Planner", "Builder", "Critic", "MemoryCurator"] as RuntimeRole[]) {
			expect(buildAssignment(role)).not.toContain("ROLE_VERDICT:");
		}
	});
});
