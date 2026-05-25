/**
 * Objective consolidation — PARITY CORPUS (migration oracle).
 *
 * Snapshots the canonical observable behavior of the legacy ObjectiveRuntimeImpl so the unified
 * objective runtime (PR2+) can be checked against it. If any of these change, the
 * unification has altered behavior — investigate before proceeding. Covers:
 *   1. renderGoalBlock byte output (prompt-cache stability — the DYNAMIC_TAIL block).
 *   2. goalTokenDelta accounting (budget math: counts input/output/cacheWrite, ignores
 *      cacheRead; clamps at zero).
 *   3. Goal status (6) ↔ Mission lifecycle (12) mapping (compat bridge).
 */
import { describe, expect, it } from "bun:test";
import { goalTokenDelta, renderGoalBlock } from "../../src/goals/runtime";
import type { Goal, GoalStatus, GoalTokenUsage } from "../../src/goals/state";
import { MISSION_LIFECYCLE_STATES, type MissionLifecycleState } from "../../src/mission/core";
import { goalStatusToLifecycle, lifecycleToGoalStatus } from "../../src/mission/core/compat";

function usage(o: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...o };
}

function goal(o: Partial<Goal> = {}): Goal {
	return {
		id: "goal-1",
		objective: "Ship the feature",
		status: "active",
		tokenBudget: undefined,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 0,
		updatedAt: 0,
		...o,
	};
}

describe("objective parity corpus — render bytes (prompt-cache oracle)", () => {
	it("renders a no-goal sentinel that is byte-stable", () => {
		const a = renderGoalBlock(null);
		const b = renderGoalBlock(null);
		expect(a).toBe(b);
		// Lock the exact bytes so a unified runtime must reproduce them verbatim.
		expect(a).toMatchSnapshot();
	});

	it("renders an active goal block byte-for-byte", () => {
		expect(
			renderGoalBlock(goal({ objective: "Ship <fast> & safely", tokenBudget: 1000, tokensUsed: 250 })),
		).toMatchSnapshot();
	});

	it("renders a budget-limited goal block byte-for-byte", () => {
		expect(renderGoalBlock(goal({ status: "budget-limited", tokenBudget: 100, tokensUsed: 120 }))).toMatchSnapshot();
	});

	it("renders completed/dropped goals identically to the no-goal sentinel", () => {
		// Terminal goals collapse to the sentinel so the prompt structure stays stable.
		expect(renderGoalBlock(goal({ status: "complete" }))).toBe(renderGoalBlock(null));
		expect(renderGoalBlock(goal({ status: "dropped" }))).toBe(renderGoalBlock(null));
	});
});

describe("objective parity corpus — budget accounting", () => {
	it("counts input+output+cacheWrite, ignores cacheRead", () => {
		expect(
			goalTokenDelta(
				usage({ input: 13, output: 6, cacheRead: 999, cacheWrite: 8 }),
				usage({ input: 10, output: 4, cacheRead: 1, cacheWrite: 5 }),
			),
		).toBe(8);
	});

	it("clamps at zero across usage resets", () => {
		expect(
			goalTokenDelta(
				usage({ input: 10, output: 5, cacheWrite: 2 }),
				usage({ input: 100, output: 50, cacheWrite: 20 }),
			),
		).toBe(0);
	});
});

describe("objective parity corpus — status ↔ lifecycle mapping", () => {
	const allStatuses: GoalStatus[] = ["active", "paused", "budget-limited", "blocked", "complete", "dropped"];

	it("maps every Goal status to a lifecycle state", () => {
		const mapping = Object.fromEntries(allStatuses.map(s => [s, goalStatusToLifecycle(s)]));
		expect(mapping).toEqual({
			active: "executing",
			paused: "blocked",
			"budget-limited": "blocked",
			blocked: "blocked",
			complete: "completed",
			dropped: "cancelled",
		});
	});

	it("reverse-maps the canonical lifecycle subset and returns undefined for orchestration-only states", () => {
		const reverse = Object.fromEntries(
			MISSION_LIFECYCLE_STATES.map((l: MissionLifecycleState) => [l, lifecycleToGoalStatus(l)]),
		);
		expect(reverse).toEqual({
			created: undefined,
			classified: undefined,
			planning: undefined,
			researching: undefined,
			critiquing: undefined,
			contracting: undefined,
			executing: "active",
			verifying: undefined,
			completed: "complete",
			blocked: "blocked",
			cancelled: "dropped",
			rolled_back: undefined,
		});
	});

	it("round-trips active/blocked/complete/dropped through lifecycle and back", () => {
		for (const status of ["active", "blocked", "complete", "dropped"] as GoalStatus[]) {
			expect(lifecycleToGoalStatus(goalStatusToLifecycle(status))).toBe(status);
		}
	});
});
