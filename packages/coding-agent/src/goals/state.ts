import type { UsageStatistics } from "../session/session-manager";
import type { AcceptanceCriterion } from "./verifier";

export type GoalStatus = "active" | "paused" | "budget-limited" | "complete" | "dropped";

/**
 * Captured answers from the Design Interview that locks the contract at goal entry.
 * Stored as ordered key→answer pairs so the rendered prompt block is byte-stable across
 * turns (required for prompt cache stability when this goal is the active goal).
 *
 * Conventional keys: `scope`, `constraints`, `approach`, `acceptance`. Renderers MUST
 * serialize entries in insertion order — not sorted — since the question semantics are
 * positional in the interview prompt. Use an empty object literal (or omit the field)
 * when no interview has run yet; consumers MUST treat missing answers as "not yet captured"
 * rather than "user declined".
 */
export type GoalDesignAnswers = Record<string, string>;

export interface Goal {
	id: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	/**
	 * Design Interview answers captured when the goal entered scope. Persisted into the
	 * system prompt's DYNAMIC_TAIL via `renderGoalBlock` so the contract stays in attention
	 * across the entire goal lifetime — survives message compaction.
	 *
	 * Older sessions persisted before this field landed will read back as undefined; treat
	 * that as "no interview yet" rather than failing.
	 */
	designAnswers?: GoalDesignAnswers;
	/**
	 * Structured acceptance criteria evaluated by the closing audit verifier. Optional and
	 * additive: a goal can ship without criteria (closing audit becomes a no-op) or with
	 * a subset (only those are checked). Distinct from `designAnswers.acceptance`, which
	 * is the natural-language description visible to the model — `acceptanceCriteria` is
	 * the machine-checkable contract.
	 *
	 * Older sessions read back as undefined; closing audit then trivially passes.
	 */
	acceptanceCriteria?: AcceptanceCriterion[];
	/**
	 * Goal-level scope guard. When set, the tool layer (edit/write) checks every mutation
	 * against these globs IF no `SubagentContract` is active for the calling session.
	 *
	 * This is the "parent drift" gate: subagent contracts already protect delegated work,
	 * but the parent itself (and any session running directly under the goal without an
	 * explicit subagent contract) needs a structural guard too. Without this field a model
	 * could "while-i'm-here" edit unrelated files inside the parent session and the v2/v3
	 * scope mechanisms wouldn't notice.
	 *
	 * Empty `include` means "no positive restriction"; `exclude` always applies. SubagentContract
	 * takes precedence when both are present — the contract is the more specific declaration.
	 */
	scopeGuard?: {
		include: string[];
		exclude: string[];
	};
	/**
	 * Monotonic version counter for the goal's contract surface (designAnswers, acceptanceCriteria,
	 * scopeGuard). Bumped by `updateGoal` whenever any of those mutate. Subagents observe this via
	 * the rendered goal block in DYNAMIC_TAIL and can detect that their cached contract is stale —
	 * see `SubagentContract.parentContractRevision` and `isSubagentContractStale`.
	 *
	 * Starts undefined (= revision 0 implicit); first relevant update bumps to 1.
	 */
	contractRevision?: number;
}

export interface GoalModeState {
	enabled: boolean;
	mode: "active" | "exiting";
	reason?: "completed";
	goal: Goal;
}

export interface GoalToolDetails {
	op: "create" | "get" | "update" | "complete";
	goal?: Goal | null;
	remainingTokens?: number | null;
	completionBudgetReport?: string | null;
}

export type GoalRuntimeEvent =
	| { type: "goal_updated"; goal: Goal | null; state?: GoalModeState }
	| { type: "goal_continuation_requested"; prompt: string };

export type GoalTokenUsage = Pick<UsageStatistics, "input" | "output" | "cacheRead" | "cacheWrite">;

export type GoalBudgetSteering = "allowed" | "suppressed";
export type GoalTerminalMetricEmission = "emit" | "suppress";
