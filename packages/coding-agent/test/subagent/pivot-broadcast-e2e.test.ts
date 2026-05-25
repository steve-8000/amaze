/**
 * V3 Phase 3 — pivot broadcast E2E.
 *
 * Demonstrates that when the parent invokes `goal({op:"update",...})` to revise the
 * contract surface (designAnswers, acceptanceCriteria, or scopeGuard), the change
 * propagates to in-flight subagents via:
 *
 *   1. Parent's `Goal.contractRevision` bumps monotonically on each contract-surface
 *      update. `objective`-only edits do NOT bump — objective is prose, not contract.
 *   2. `renderGoalBlock` exposes the revision as `contract-revision="N"` attribute, so
 *      subagents reading the parent goal block in their DYNAMIC_TAIL observe it.
 *   3. `isSubagentContractStale(contract, parentRevision)` detects when a subagent's
 *      cached `parentMissionRev` baseline is older than the live parent revision.
 *   4. The next prompt rebuild after the bump renders the new revision into DYNAMIC_TAIL
 *      — proving "next-turn propagation" without a separate back-channel.
 *
 * Acceptance: "pivot applies within one subagent turn boundary" — encoded as the
 * `PHASE 3 ACCEPTANCE` assertion below.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Goal, GoalModeState, GoalTokenUsage } from "@amaze/coding-agent/goals/state";
import {
	type GoalRuntimeHost,
	ObjectiveRuntimeImpl,
	renderGoalBlock,
} from "@amaze/coding-agent/mission/core/objective-runtime";
import {
	isSubagentContractStale,
	renderSubagentContract,
	type SubagentContract,
} from "@amaze/coding-agent/subagent/contract";
import { buildSystemPrompt } from "@amaze/coding-agent/system-prompt";

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...overrides };
}

function cloneGoal(goal: Goal): Goal {
	return {
		...goal,
		designAnswers: goal.designAnswers ? { ...goal.designAnswers } : undefined,
		acceptanceCriteria: goal.acceptanceCriteria ? goal.acceptanceCriteria.map(c => ({ ...c })) : undefined,
		scopeGuard: goal.scopeGuard
			? { include: [...goal.scopeGuard.include], exclude: [...goal.scopeGuard.exclude] }
			: undefined,
	};
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
	return state ? { ...state, goal: cloneGoal(state.goal) } : undefined;
}

function createHarness(initial: GoalModeState) {
	let state: GoalModeState | undefined = cloneState(initial);
	const host: GoalRuntimeHost = {
		getState: () => cloneState(state),
		setState: next => {
			state = cloneState(next);
		},
		getCurrentUsage: () => createUsage(),
		emit: async () => {},
		persist: () => {},
		sendHiddenMessage: async () => {},
		now: () => 0,
	};
	return {
		runtime: new ObjectiveRuntimeImpl(host),
		getState: () => cloneState(state),
	};
}

const baseGoal = (): Goal => ({
	id: "goal-pivot",
	objective: "Build feature X",
	status: "active",
	tokensUsed: 0,
	timeUsedSeconds: 0,
	createdAt: 0,
	updatedAt: 0,
	designAnswers: { scope: "files A, B", acceptance: "tests pass" },
});

describe("V3 Phase 3 — pivot broadcast E2E", () => {
	let workdir: string;

	beforeEach(async () => {
		workdir = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-broadcast-"));
	});

	afterEach(async () => {
		await fs.rm(workdir, { recursive: true, force: true });
	});

	it("contractRevision starts undefined (= 0) and bumps on contract-surface update", async () => {
		const harness = createHarness({ enabled: true, mode: "active", goal: baseGoal() });
		expect(harness.getState()?.goal.contractRevision).toBeUndefined();

		// designAnswers edit → bumps revision.
		await harness.runtime.updateGoal({ designAnswers: { scope: "files A, B, C" } });
		expect(harness.getState()?.goal.contractRevision).toBe(1);

		// acceptanceCriteria edit → bumps again.
		await harness.runtime.updateGoal({
			acceptanceCriteria: [
				{
					id: "tests",
					description: "tests green",
					check: { type: "command-exit", command: "true", expected: 0 },
				},
			],
		});
		expect(harness.getState()?.goal.contractRevision).toBe(2);

		// scopeGuard edit → bumps again.
		await harness.runtime.updateGoal({ scopeGuard: { include: ["src/feature-x/**"], exclude: [] } });
		expect(harness.getState()?.goal.contractRevision).toBe(3);
	});

	it("objective-only update does NOT bump revision (prose, not contract)", async () => {
		const harness = createHarness({
			enabled: true,
			mode: "active",
			goal: { ...baseGoal(), contractRevision: 5 },
		});
		await harness.runtime.updateGoal({ objective: "Rephrased feature X" });
		// objective is prose — revision stays at 5.
		expect(harness.getState()?.goal.contractRevision).toBe(5);
	});

	it("renderGoalBlock exposes contract-revision so subagents observe it via DYNAMIC_TAIL", () => {
		const goal: Goal = { ...baseGoal(), contractRevision: 7 };
		const rendered = renderGoalBlock(goal);
		expect(rendered).toContain(`contract-revision="7"`);

		// Default (no field set) renders as revision 0.
		const goalNoRev: Goal = { ...baseGoal() };
		expect(renderGoalBlock(goalNoRev)).toContain(`contract-revision="0"`);
	});

	it("isSubagentContractStale: fresh when revisions match, stale when parent has advanced", () => {
		const contract: SubagentContract = {
			role: "refactor-applier",
			parentMissionRev: 3,
			scope: { include: [], exclude: [] },
			successCriteria: [],
			escalation: { onUncertainty: "ask-parent", budgetCap: 1000 },
		};
		expect(isSubagentContractStale(contract, 3)).toBe(false);
		expect(isSubagentContractStale(contract, 4)).toBe(true);
		expect(isSubagentContractStale(contract, 2)).toBe(false); // older parent = nothing to communicate
	});

	it("isSubagentContractStale: backward-compat — contracts without baseline are never stale", () => {
		const contract: SubagentContract = {
			role: "old-style",
			scope: { include: [], exclude: [] },
			successCriteria: [],
			escalation: { onUncertainty: "ask-parent", budgetCap: 1000 },
		};
		expect(isSubagentContractStale(contract, 99)).toBe(false);
	});

	it("renderSubagentContract surfaces parent-mission-rev when set (subagent self-check)", () => {
		const contract: SubagentContract = {
			role: "refactor-applier",
			parentMissionRev: 4,
			scope: { include: [], exclude: [] },
			successCriteria: [],
			escalation: { onUncertainty: "ask-parent", budgetCap: 25000 },
		};
		const rendered = renderSubagentContract(contract);
		expect(rendered).toContain(`parent-mission-rev="4"`);
		expect(rendered).toContain(`role="refactor-applier"`);
	});

	it("PHASE 3 ACCEPTANCE: pivot propagates to subagent prompt within one rebuild boundary", async () => {
		// Setup: parent goal at revision 1 (after first designAnswers update).
		const harness = createHarness({ enabled: true, mode: "active", goal: baseGoal() });
		await harness.runtime.updateGoal({ designAnswers: { scope: "files A, B" } });
		const goalRev1 = harness.getState()!.goal;
		expect(goalRev1.contractRevision).toBe(1);

		// Subagent was issued a contract under revision 1.
		const subagentContract: SubagentContract = {
			role: "refactor-applier",
			parentMissionRev: 1,
			scope: { include: ["src/**"], exclude: [] },
			successCriteria: [],
			escalation: { onUncertainty: "ask-parent", budgetCap: 25000 },
		};

		// Subagent's first prompt: contract is fresh against goalRev1.
		const turn1 = await buildSystemPrompt({
			cwd: workdir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: ["read", "edit", "write"],
			subagentContract,
			activeGoal: goalRev1,
		});
		expect(turn1.systemPrompt[1]).toContain(`contract-revision="1"`);
		expect(isSubagentContractStale(subagentContract, goalRev1.contractRevision)).toBe(false);

		// === The pivot event: parent updates the goal ===
		await harness.runtime.updateGoal({
			designAnswers: { acceptance: "all tests + e2e green", scope: "files A, B, C" },
		});
		const goalRev2 = harness.getState()!.goal;
		expect(goalRev2.contractRevision).toBe(2);

		// === Next subagent prompt rebuild (one-turn boundary) ===
		const turn2 = await buildSystemPrompt({
			cwd: workdir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: ["read", "edit", "write"],
			subagentContract,
			activeGoal: goalRev2,
		});

		// Parent goal block now reflects the new revision.
		expect(turn2.systemPrompt[1]).toContain(`contract-revision="2"`);
		// Subagent's contract is now detectably stale.
		expect(isSubagentContractStale(subagentContract, goalRev2.contractRevision)).toBe(true);
		// PHASE 3 ACCEPTANCE: the propagation took exactly one rebuild boundary. The subagent
		// observes the revision shift on its next prompt build and can yield for re-issuance.
		// If this assertion ever fails, the broadcast contract is broken.
	});

	it("tool-layer goal scope guard catches parent drift when no subagent contract is active", async () => {
		// Parent under goal mode with scopeGuard but no SubagentContract. WriteTool MUST
		// still reject out-of-scope writes via the goal-level fallback.
		const { Settings } = await import("@amaze/coding-agent/config/settings");
		const { WriteTool } = await import("@amaze/coding-agent/tools/write");

		const goalState: GoalModeState = {
			enabled: true,
			mode: "active",
			goal: {
				...baseGoal(),
				scopeGuard: { include: ["src/**"], exclude: ["**/secrets/**"] },
			},
		};
		const session = {
			cwd: workdir,
			hasUI: false,
			getSessionFile: () => path.join(workdir, "session.jsonl"),
			getSessionSpawns: () => "*" as const,
			getArtifactsDir: () => path.join(workdir, "artifacts"),
			allocateOutputArtifact: async () => ({ id: "a1", path: path.join(workdir, "a1.log") }),
			settings: Settings.isolated(),
			// No subagent contract — goal fallback is the only guard.
			getGoalModeState: () => goalState,
		};
		const tool = new WriteTool(session as never);

		// Outside goal scope → blocked.
		const outOfScope = await tool.execute("call-1", { path: "docs/external.md", content: "drift" }).then(
			r => ({ ok: true as const, r }),
			err => ({ ok: false as const, err }),
		);
		expect(outOfScope.ok).toBe(false);
		if (!outOfScope.ok) {
			expect(String(outOfScope.err)).toContain("Goal scope violation");
		}

		// Exclude-glob hit → blocked.
		const secret = await tool.execute("call-2", { path: "src/secrets/key.env", content: "OOPS" }).then(
			r => ({ ok: true as const, r }),
			err => ({ ok: false as const, err }),
		);
		expect(secret.ok).toBe(false);
	});
});
