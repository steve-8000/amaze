import { prompt, Snowflake } from "@amaze/utils";
import goalBudgetLimitPrompt from "../prompts/goals/goal-budget-limit.md" with { type: "text" };
import goalContinuationPrompt from "../prompts/goals/goal-continuation.md" with { type: "text" };
import goalModeActivePrompt from "../prompts/goals/goal-mode-active.md" with { type: "text" };
import type { Goal, GoalBudgetSteering, GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "./state";
import {
	type AcceptanceCriterion,
	AcceptanceVerifier,
	summarize,
	type VerificationContext,
	type VerificationVerdict,
} from "./verifier";

/**
 * Best-effort collection of changed files since the session started, for closing audit
 * verification context. Falls back gracefully when git is not available or the cwd is not
 * a repo — closing audit then runs with an empty changedFiles list (scope-* criteria turn
 * uncertain, file-exists and command-* still work).
 *
 * Strategy:
 *   1. Try `git status --porcelain` — captures all staged/unstaged/untracked. No baseline
 *      assumption (works whether the user committed mid-session or not).
 *   2. Strip the porcelain status prefix and de-duplicate paths.
 *   3. Errors → empty list (don't fail the goal completion just because git isn't there).
 *
 * Returns paths relative to the cwd as-given by `git status` — model-visible form.
 */
async function collectChangedFilesFromGit(cwd: string): Promise<string[]> {
	try {
		const proc = Bun.spawn(["git", "status", "--porcelain=v1", "-z"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) return [];
		const raw = await new Response(proc.stdout).text();
		// porcelain=v1 -z output: NUL-separated entries; renames are "XY old\0new" (two NULs
		// in a row consume the rename pair). We don't need rename pairs here — just collect
		// all paths that appear after a status prefix.
		const paths = new Set<string>();
		for (const entry of raw.split("\0")) {
			if (!entry) continue;
			// Status prefix is exactly 3 chars: "XY " (X=index, Y=worktree, space).
			if (entry.length < 4) continue;
			const path = entry.slice(3);
			if (path) paths.add(path);
		}
		return [...paths];
	} catch {
		return [];
	}
}

/**
 * Thrown by `completeGoalFromTool` when the closing audit's verifier surfaces failed
 * acceptance criteria. Carries the structured verdict so the tool surface can render
 * evidence to the user (each criterion's id, description, status, evidence).
 */
export class GoalAcceptanceFailureError extends Error {
	readonly verdict: VerificationVerdict;
	constructor(verdict: VerificationVerdict) {
		const failed = verdict.results.filter(r => r.status === "fail");
		const summary = failed.map(r => `- [${r.id}] ${r.description}: ${r.evidence}`).join("\n");
		super(
			`Closing audit blocked completion: ${verdict.failedCount} of ${verdict.results.length} acceptance criteria failed.\n${summary}\n\nResolve the failing criteria before marking the goal complete.`,
		);
		this.name = "GoalAcceptanceFailureError";
		this.verdict = verdict;
	}
}

export interface GoalRuntimeHost {
	getState(): GoalModeState | undefined;
	setState(state: GoalModeState | undefined): void;
	getCurrentUsage(): GoalTokenUsage;
	emit(event: GoalRuntimeEvent): void | Promise<void>;
	persist(mode: "goal" | "goal_paused" | "none", state?: GoalModeState): void;
	sendHiddenMessage(message: {
		customType: string;
		content: string;
		deliverAs?: "steer" | "followUp" | "nextTurn";
	}): Promise<void>;
	now?(): number;
}

export interface GoalTurnSnapshot {
	turnId: string;
	baselineUsage: GoalTokenUsage;
	activeGoalId?: string;
}

export interface GoalWallClockSnapshot {
	lastAccountedAt: number;
	activeGoalId?: string;
}

export interface GoalRuntimeSnapshot {
	turnSnapshot?: GoalTurnSnapshot;
	wallClock: GoalWallClockSnapshot;
	budgetReportedFor?: string;
}

export type GoalPromptKind = "active" | "continuation" | "budget-limit";

function cloneGoal(goal: Goal): Goal {
	// designAnswers, acceptanceCriteria, scopeGuard are mutated independently of the goal record
	// (follow-up answer edits, criterion additions, scope adjustments); shallow-spreading
	// the Goal would share the underlying objects/arrays and let mutations leak across clones.
	return {
		...goal,
		designAnswers: goal.designAnswers ? { ...goal.designAnswers } : undefined,
		acceptanceCriteria: goal.acceptanceCriteria
			? goal.acceptanceCriteria.map(c => ({ ...c, check: { ...c.check } as typeof c.check }))
			: undefined,
		scopeGuard: goal.scopeGuard
			? { include: [...goal.scopeGuard.include], exclude: [...goal.scopeGuard.exclude] }
			: undefined,
	};
}

function cloneState(state: GoalModeState): GoalModeState {
	return { ...state, goal: cloneGoal(state.goal) };
}

function budgetValue(goal: Goal): string {
	return goal.tokenBudget === undefined ? "none" : String(goal.tokenBudget);
}

function remainingValue(goal: Goal): string {
	return goal.tokenBudget === undefined ? "unbounded" : String(Math.max(0, goal.tokenBudget - goal.tokensUsed));
}

export function remainingTokens(goal: Goal | null | undefined): number | null {
	if (!goal || goal.tokenBudget === undefined) return null;
	return Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

export function escapeXmlText(input: string): string {
	let firstEscapable = -1;
	for (let index = 0; index < input.length; index++) {
		const char = input.charCodeAt(index);
		if (char === 38 || char === 60 || char === 62) {
			firstEscapable = index;
			break;
		}
	}
	if (firstEscapable === -1) return input;

	let output = input.slice(0, firstEscapable);
	for (let index = firstEscapable; index < input.length; index++) {
		const char = input[index];
		if (char === "&") output += "&amp;";
		else if (char === "<") output += "&lt;";
		else if (char === ">") output += "&gt;";
		else output += char;
	}
	return output;
}

export function renderUntrustedObjective(objective: string): string {
	return `<untrusted_objective>\n${escapeXmlText(objective)}\n</untrusted_objective>`;
}

/**
 * Render the goal block injected into the system prompt's DYNAMIC_TAIL.
 *
 * Output is **byte-stable** for a given Goal state so prompt cache writes are minimized:
 * - When goal is null/undefined: emits a fixed sentinel so the prompt cache doesn't thrash
 *   between "no field" and "empty field".
 * - When goal exists: emits attributes in fixed order (id, status, budget) and walks
 *   designAnswers in insertion order (callers MUST insert keys in canonical interview order
 *   — scope, constraints, approach, acceptance — at write time; this renderer doesn't sort
 *   so the prompt mirrors the interview semantically).
 *
 * Status values `complete` and `dropped` collapse to the empty sentinel — once a goal is
 * out of scope, its anchor should leave the prompt rather than mislead the model into
 * thinking constraints from a closed goal still apply.
 */
export function renderGoalBlock(goal: Goal | null | undefined): string {
	if (!goal || goal.status === "complete" || goal.status === "dropped") {
		return `<goal status="none"/>`;
	}
	const budget = goal.tokenBudget === undefined ? "unbounded" : String(goal.tokenBudget);
	const remaining = remainingValue(goal);
	const revision = goal.contractRevision ?? 0;
	// `contract-revision` is part of the attribute set so subagents reading the parent goal
	// block can compare against the revision baked into their own contract — staleness
	// detection without a back-channel.
	const attrs = `id="${escapeXmlText(goal.id)}" status="${goal.status}" budget="${budget}" remaining="${remaining}" contract-revision="${revision}"`;
	const objectiveLine = `  <objective>${escapeXmlText(goal.objective)}</objective>`;
	const answerLines: string[] = [];
	if (goal.designAnswers) {
		for (const key of Object.keys(goal.designAnswers)) {
			const value = goal.designAnswers[key];
			if (value === undefined || value === "") continue;
			answerLines.push(`  <design key="${escapeXmlText(key)}">${escapeXmlText(value)}</design>`);
		}
	}
	const body = answerLines.length === 0 ? objectiveLine : `${objectiveLine}\n${answerLines.join("\n")}`;
	return `<goal ${attrs}>\n${body}\n</goal>`;
}

export function renderTrustedObjective(objective: string): string {
	return renderUntrustedObjective(objective);
}

export function goalTokenDelta(current: GoalTokenUsage, baseline: GoalTokenUsage): number {
	// Diverges from codex-rs: codex omits cache creation because its target providers
	// do not bill cache writes distinctly through the token-usage stream. Amaze receives
	// cacheWrite separately on Anthropic/Bedrock; rotating a 1h ephemeral cache or
	// re-anchoring a changed system prompt can write 100K+ tokens, which the goal
	// budget must account for. cacheRead is excluded because it is reused prefix,
	// not new work consumed by the goal.
	return (
		Math.max(0, current.input - baseline.input) +
		Math.max(0, current.cacheWrite - baseline.cacheWrite) +
		Math.max(0, current.output - baseline.output)
	);
}

export function renderGoalPrompt(kind: GoalPromptKind, goal: Goal): string {
	const template =
		kind === "active"
			? goalModeActivePrompt
			: kind === "continuation"
				? goalContinuationPrompt
				: goalBudgetLimitPrompt;
	return prompt.render(template, {
		objective: escapeXmlText(goal.objective),
		tokensUsed: String(goal.tokensUsed),
		tokenBudget: budgetValue(goal),
		remainingTokens: remainingValue(goal),
		timeUsedSeconds: String(goal.timeUsedSeconds),
	});
}

export function completionBudgetReport(goal: Goal): string | null {
	const parts: string[] = [];
	if (goal.tokenBudget !== undefined) {
		parts.push(`tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}`);
	}
	if (goal.timeUsedSeconds > 0) {
		parts.push(`time used: ${goal.timeUsedSeconds} seconds`);
	}
	if (parts.length === 0) return null;
	return `Goal achieved. Report final budget usage to the user: ${parts.join("; ")}.`;
}

const MAX_OBJECTIVE_LENGTH = 4_000;
const GOAL_TOO_LONG_FILE_HINT =
	"Put longer instructions in a file and refer to that file in the goal, for example: /goal follow the instructions in docs/goal.md.";

function validateObjective(value: string): string {
	const objective = value.trim();
	if (!objective) throw new Error("objective is required when op=create");

	let objectiveCharacters = 0;
	for (const _ of objective) {
		objectiveCharacters++;
		if (objectiveCharacters > MAX_OBJECTIVE_LENGTH) {
			throw new Error(
				`Goal objective is too long: ${objectiveCharacters.toLocaleString()} characters. Limit: ${MAX_OBJECTIVE_LENGTH.toLocaleString()} characters. ${GOAL_TOO_LONG_FILE_HINT}`,
			);
		}
	}
	return objective;
}

function validateTokenBudget(tokenBudget: number | undefined): void {
	if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
		throw new Error("goal token_budget must be a positive integer when provided");
	}
}

function isBudgetExhausted(goal: Goal): boolean {
	return goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget;
}

function activeStatusForBudget(goal: Goal): "active" | "budget-limited" {
	return isBudgetExhausted(goal) ? "budget-limited" : "active";
}

function isAccountingStatus(goal: Goal): boolean {
	return goal.status === "active" || goal.status === "budget-limited";
}

export class GoalRuntime {
	readonly #host: GoalRuntimeHost;
	#turnSnapshot: GoalTurnSnapshot | undefined;
	#wallClock: GoalWallClockSnapshot;
	#budgetReportedFor: string | undefined;
	#accountingTail: Promise<void> = Promise.resolve();

	constructor(host: GoalRuntimeHost) {
		this.#host = host;
		this.#wallClock = { lastAccountedAt: this.#now() };
	}

	get snapshot(): GoalRuntimeSnapshot {
		return {
			turnSnapshot: this.#turnSnapshot
				? { ...this.#turnSnapshot, baselineUsage: { ...this.#turnSnapshot.baselineUsage } }
				: undefined,
			wallClock: { ...this.#wallClock },
			budgetReportedFor: this.#budgetReportedFor,
		};
	}

	#now(): number {
		return this.#host.now?.() ?? Date.now();
	}

	#hasAccountingState(): boolean {
		const state = this.#host.getState();
		return Boolean(state?.enabled && isAccountingStatus(state.goal));
	}

	async #withAccounting<T>(fn: () => Promise<T> | T): Promise<T> {
		const previous = this.#accountingTail;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#accountingTail = previous.then(
			() => promise,
			() => promise,
		);
		await previous.catch(() => {});
		try {
			return await fn();
		} finally {
			resolve();
		}
	}

	#getStateClone(): GoalModeState | undefined {
		const state = this.#host.getState();
		return state ? cloneState(state) : undefined;
	}

	async #commitState(
		state: GoalModeState | undefined,
		options?: { persist?: "goal" | "goal_paused" | "none"; emit?: boolean },
	): Promise<void> {
		this.#host.setState(state ? cloneState(state) : undefined);
		if (options?.persist) {
			this.#host.persist(options.persist, state);
		}
		if (options?.emit !== false) {
			await this.#host.emit({ type: "goal_updated", goal: state ? cloneGoal(state.goal) : null, state });
		}
	}

	#markActiveAccounting(goal: Goal): void {
		if (this.#wallClock.activeGoalId !== goal.id) {
			this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: goal.id };
		}
		if (this.#turnSnapshot) {
			this.#turnSnapshot.activeGoalId = goal.id;
			this.#turnSnapshot.baselineUsage = { ...this.#host.getCurrentUsage() };
		}
	}

	#clearActiveAccounting(): void {
		this.#wallClock = { lastAccountedAt: this.#now() };
		if (this.#turnSnapshot) {
			this.#turnSnapshot.activeGoalId = undefined;
		}
	}

	onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void {
		this.#turnSnapshot = { turnId, baselineUsage: { ...baselineUsage } };
		const state = this.#host.getState();
		if (state?.enabled && isAccountingStatus(state.goal)) {
			this.#turnSnapshot.activeGoalId = state.goal.id;
			if (this.#wallClock.activeGoalId !== state.goal.id) {
				this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: state.goal.id };
			}
		}
	}

	async onToolCompleted(toolName: string): Promise<void> {
		if (toolName === "goal") return;
		if (!this.#hasAccountingState()) return;
		await this.flushUsage("allowed");
	}

	async onGoalToolCompleted(): Promise<void> {
		if (!this.#hasAccountingState()) return;
		await this.flushUsage("suppressed");
	}

	async onAgentEnd(options?: { turnCompleted?: boolean; currentUsage?: GoalTokenUsage }): Promise<void> {
		if (!this.#hasAccountingState()) {
			this.#turnSnapshot = undefined;
			return;
		}
		await this.flushUsage("suppressed", options?.currentUsage);
		this.#turnSnapshot = undefined;
	}

	async onTaskAborted(options?: { reason?: "interrupted" | "internal" }): Promise<void> {
		const state = this.#host.getState();
		const needsAccounting = state?.enabled && isAccountingStatus(state.goal);
		const needsPause = options?.reason === "interrupted" && state?.enabled && state.goal.status === "active";
		if (!needsAccounting && !needsPause) {
			this.#turnSnapshot = undefined;
			return;
		}
		await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			this.#turnSnapshot = undefined;
			if (options?.reason !== "interrupted") return;
			const cloned = this.#getStateClone();
			if (!cloned?.enabled || cloned.goal.status !== "active") return;
			cloned.enabled = false;
			cloned.goal.status = "paused";
			cloned.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(cloned, { persist: "goal_paused" });
		});
	}

	async onThreadResumed(): Promise<GoalModeState | undefined> {
		const state = this.#getStateClone();
		if (!state) return undefined;
		if (!state.enabled && state.goal.status === "active") {
			// Older/broken session logs can contain an inactive mode wrapper around an
			// active goal. Normalize that inconsistent shape, but do not pause a
			// legitimately active goal just because the thread was restored.
			state.goal.status = "paused";
			state.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal_paused" });
			return state;
		}
		if (state.enabled && isAccountingStatus(state.goal)) {
			this.#markActiveAccounting(state.goal);
		} else {
			this.#clearActiveAccounting();
		}
		await this.#commitState(state, { emit: true });
		return state;
	}

	async onBudgetMutated(newBudget: number | undefined): Promise<GoalModeState | undefined> {
		validateTokenBudget(newBudget);
		return await this.#withAccounting(async () => {
			this.#budgetReportedFor = undefined;
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			state.goal.tokenBudget = newBudget;
			state.goal.updatedAt = this.#now();
			const nextStatus = activeStatusForBudget(state.goal);
			const shouldSteer = state.enabled && state.goal.status === "active" && nextStatus === "budget-limited";
			state.goal.status = nextStatus;
			if (nextStatus === "active") {
				state.enabled = true;
				this.#markActiveAccounting(state.goal);
			}
			await this.#commitState(state, { persist: state.enabled ? "goal" : "goal_paused" });
			if (shouldSteer) {
				await this.#sendBudgetLimitSteer(state.goal);
			}
			return state;
		});
	}

	async #flushUsageLocked(
		steering: GoalBudgetSteering,
		currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
	): Promise<void> {
		const state = this.#getStateClone();
		if (!state?.enabled || !isAccountingStatus(state.goal)) return;
		if (this.#turnSnapshot?.activeGoalId !== state.goal.id && this.#wallClock.activeGoalId !== state.goal.id) return;

		const tokenDelta =
			this.#turnSnapshot?.activeGoalId === state.goal.id
				? goalTokenDelta(currentUsage, this.#turnSnapshot.baselineUsage)
				: 0;
		const wallSeconds =
			this.#wallClock.activeGoalId === state.goal.id
				? Math.max(0, Math.floor((this.#now() - this.#wallClock.lastAccountedAt) / 1000))
				: 0;
		if (tokenDelta <= 0 && wallSeconds <= 0) return;

		state.goal.tokensUsed += tokenDelta;
		state.goal.timeUsedSeconds += wallSeconds;
		state.goal.updatedAt = this.#now();
		const flippedToBudgetLimited =
			state.goal.tokenBudget !== undefined &&
			state.goal.tokensUsed >= state.goal.tokenBudget &&
			state.goal.status === "active";
		if (flippedToBudgetLimited) {
			state.goal.status = "budget-limited";
		}

		if (this.#turnSnapshot?.activeGoalId === state.goal.id) {
			this.#turnSnapshot.baselineUsage = { ...currentUsage };
		}
		if (this.#wallClock.activeGoalId === state.goal.id && wallSeconds > 0) {
			this.#wallClock.lastAccountedAt += wallSeconds * 1000;
		}

		await this.#commitState(state, { persist: "goal" });

		if (state.goal.status !== "budget-limited") {
			this.#budgetReportedFor = undefined;
		}
		if (steering === "allowed" && flippedToBudgetLimited && this.#budgetReportedFor !== state.goal.id) {
			await this.#sendBudgetLimitSteer(state.goal);
		}
	}

	async flushUsage(
		steering: GoalBudgetSteering,
		currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
	): Promise<void> {
		await this.#withAccounting(() => this.#flushUsageLocked(steering, currentUsage));
	}

	async createGoal(input: { objective: string; tokenBudget?: number }): Promise<GoalModeState> {
		const objective = validateObjective(input.objective);
		validateTokenBudget(input.tokenBudget);
		return await this.#withAccounting(async () => {
			const existing = this.#host.getState();
			if (existing?.goal && existing.goal.status !== "dropped") {
				throw new Error("cannot create a new goal because this session already has a goal");
			}
			const now = this.#now();
			const goal: Goal = {
				id: String(Snowflake.next()),
				objective,
				status: "active",
				tokenBudget: input.tokenBudget,
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: now,
				updatedAt: now,
			};
			const state: GoalModeState = { enabled: true, mode: "active", goal };
			this.#budgetReportedFor = undefined;
			this.#markActiveAccounting(goal);
			await this.#commitState(state, { persist: "goal" });
			return state;
		});
	}

	async resumeGoal(): Promise<GoalModeState> {
		return await this.#withAccounting(async () => {
			const state = this.#getStateClone();
			if (!state?.goal) throw new Error("No paused goal.");
			if (state.goal.status === "complete") throw new Error("Goal is already complete.");
			state.enabled = true;
			state.mode = "active";
			state.reason = undefined;
			state.goal.status = activeStatusForBudget(state.goal);
			state.goal.updatedAt = this.#now();
			this.#budgetReportedFor = undefined;
			this.#markActiveAccounting(state.goal);
			await this.#commitState(state, { persist: "goal" });
			return state;
		});
	}

	async pauseGoal(): Promise<GoalModeState | undefined> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			state.enabled = false;
			state.mode = "active";
			state.reason = undefined;
			if (state.goal.status === "active") {
				state.goal.status = "paused";
			}
			state.goal.updatedAt = this.#now();
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal_paused" });
			return state;
		});
	}

	async dropGoal(): Promise<Goal | undefined> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.goal) return undefined;
			const dropped = { ...state.goal, status: "dropped" as const, updatedAt: this.#now() };
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#host.emit({
				type: "goal_updated",
				goal: dropped,
				state: { ...state, enabled: false, goal: dropped },
			});
			await this.#commitState(undefined, { persist: "none", emit: false });
			return dropped;
		});
	}

	/**
	 * Complete the goal, optionally enforcing a closing audit against `acceptanceCriteria`.
	 *
	 * Phase 1 of the v3 coordination layer: when the goal has structured criteria, the
	 * verifier runs BEFORE the status flip to `complete`. Any `fail` verdict throws
	 * `GoalAcceptanceFailureError` carrying per-criterion evidence — closing audit
	 * actually blocks. `uncertain` criteria surface as info but do NOT block (manual /
	 * llm-judged items live there until a deterministic backend is wired).
	 *
	 * Override paths:
	 *   - `force: true` skips verification entirely. Tracked via telemetry so operators
	 *     can monitor "force rate" — high rates indicate criteria are too strict and need
	 *     calibration. Acceptance for Phase 1 ships ships when force rate < 30%.
	 *   - Empty / undefined `acceptanceCriteria` is treated as no-op (verifier returns
	 *     vacuous pass). Goals without criteria preserve pre-v3 behavior.
	 */
	async completeGoalFromTool(options?: {
		expectedGoalId?: string;
		force?: boolean;
		verificationContext?: VerificationContext;
	}): Promise<{ goal: Goal; verdict?: VerificationVerdict }> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.enabled || !state.goal) {
				throw new Error("cannot complete goal because goal mode is not active");
			}
			if (options?.expectedGoalId && state.goal.id !== options.expectedGoalId) {
				throw new Error("stale goal completion rejected because the active goal changed");
			}
			let verdict: VerificationVerdict | undefined;
			const criteria = state.goal.acceptanceCriteria;
			if (criteria && criteria.length > 0 && !options?.force) {
				// When the caller doesn't supply a verification context, gather changedFiles
				// from git automatically. This is the production path: the goal tool's
				// `complete` op fires without explicit context, but scope-* criteria need to
				// know what changed. Empty list is acceptable — scope criteria with empty
				// changedFiles return `uncertain`, not `fail`.
				let ctx: VerificationContext;
				if (options?.verificationContext) {
					ctx = options.verificationContext;
				} else {
					const cwd = process.cwd();
					ctx = { cwd, changedFiles: await collectChangedFilesFromGit(cwd) };
				}
				const results = await new AcceptanceVerifier().verify(criteria, ctx);
				verdict = summarize(results);
				if (verdict.verdict === "fail") {
					throw new GoalAcceptanceFailureError(verdict);
				}
			}
			state.enabled = false;
			state.goal.status = "complete";
			state.goal.updatedAt = this.#now();
			state.goal.completedAt = state.goal.completedAt ?? state.goal.updatedAt;
			state.mode = "exiting";
			state.reason = "completed";
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal" });
			return { goal: state.goal, verdict };
		});
	}

	async blockGoalFromTool(options?: { expectedGoalId?: string }): Promise<Goal> {
		return await this.#withAccounting(async () => {
			await this.#flushUsageLocked("suppressed");
			const state = this.#getStateClone();
			if (!state?.enabled || !state.goal) {
				throw new Error("cannot block goal because goal mode is not active");
			}
			if (options?.expectedGoalId && state.goal.id !== options.expectedGoalId) {
				throw new Error("stale goal block rejected because the active goal changed");
			}
			state.enabled = false;
			state.goal.status = "blocked";
			state.goal.updatedAt = this.#now();
			state.mode = "active";
			state.reason = "blocked";
			this.#clearActiveAccounting();
			this.#budgetReportedFor = undefined;
			await this.#commitState(state, { persist: "goal_paused" });
			return state.goal;
		});
	}

	/**
	 * Roll external token usage into the active goal's budget without going through the
	 * per-turn flush machinery (which is wired to the orchestrator's own API calls).
	 *
	 * Use case: the parent delegates via `task` to subagent(s). Subagents make their own
	 * API calls under their own session, so the parent's flush never sees that work —
	 * yet the parent's goal budget MUST account for it, otherwise budget enforcement is
	 * a fiction. The task tool computes the cost-relevant delta (input + cacheWrite +
	 * output, excluding cacheRead per `goalTokenDelta` convention) and pushes it here.
	 *
	 * Triggers the budget-limit steer at the threshold just like an orchestrator-side
	 * flush would. No-op when no goal is active or delta ≤ 0.
	 */
	async addExternalUsage(delta: number): Promise<void> {
		if (!Number.isFinite(delta) || delta <= 0) return;
		await this.#withAccounting(async () => {
			const state = this.#getStateClone();
			if (!state?.enabled || !state.goal) return;
			state.goal.tokensUsed += Math.round(delta);
			state.goal.updatedAt = this.#now();
			if (state.goal.tokenBudget !== undefined && state.goal.tokensUsed >= state.goal.tokenBudget) {
				state.goal.status = "budget-limited";
			}
			await this.#commitState(state, { persist: "goal" });
			if (state.goal.status === "budget-limited") {
				await this.#sendBudgetLimitSteer(state.goal);
			}
		});
	}

	/**
	 * Pivot: merge partial updates into the active goal mid-flight.
	 *
	 * Supports three independent updates: revise the objective, change the token budget,
	 * and patch design answers (merged into existing, NOT replaced — call with `{scope: "new"}`
	 * to overwrite only scope while keeping constraints/approach/acceptance untouched).
	 *
	 * This is the mid-goal pivot path. Goal status is preserved (active/paused/...); use
	 * `dropGoal`/`completeGoalFromTool` for terminal transitions. The mutation flows through
	 * `#commitState({persist: "goal"})` which emits `goal_updated` and persists, so the next
	 * prompt rebuild sees the new state.
	 *
	 * Returns the new goal, or undefined when no goal is active.
	 */
	async updateGoal(patch: {
		objective?: string;
		tokenBudget?: number | null;
		designAnswers?: Record<string, string>;
		/**
		 * Acceptance criteria patch. Two modes:
		 *   - Pass an array → REPLACES the criteria list wholesale (closing audit checks exactly these).
		 *   - Pass `null` → clears the criteria (closing audit becomes a no-op).
		 *   - Omit → leaves existing criteria untouched.
		 * Replace-rather-than-merge: criteria are identified by `id`, and partial merges
		 * would require a fragile per-id diff. Callers MUST send the full intended list.
		 */
		acceptanceCriteria?: AcceptanceCriterion[] | null;
		/**
		 * Goal-level scope guard. Replace semantics like acceptanceCriteria. `null` clears.
		 * Bumps `contractRevision` because the tool-layer behavior changes — subagents may
		 * need to re-check whether their cached contract still aligns with parent intent.
		 */
		scopeGuard?: { include: string[]; exclude: string[] } | null;
	}): Promise<Goal | undefined> {
		return await this.#withAccounting(async () => {
			const state = this.#getStateClone();
			if (!state?.enabled || !state.goal) return undefined;
			if (patch.objective !== undefined) {
				const objective = patch.objective.trim();
				if (objective) state.goal.objective = objective;
			}
			if (patch.tokenBudget !== undefined) {
				if (patch.tokenBudget === null) {
					state.goal.tokenBudget = undefined;
				} else if (Number.isInteger(patch.tokenBudget) && patch.tokenBudget > 0) {
					state.goal.tokenBudget = patch.tokenBudget;
				}
			}
			if (patch.designAnswers) {
				const merged = { ...(state.goal.designAnswers ?? {}) };
				for (const [key, value] of Object.entries(patch.designAnswers)) {
					if (value === "" || value == null) {
						delete merged[key];
					} else {
						merged[key] = value;
					}
				}
				state.goal.designAnswers = Object.keys(merged).length > 0 ? merged : undefined;
			}
			if (patch.acceptanceCriteria !== undefined) {
				state.goal.acceptanceCriteria =
					patch.acceptanceCriteria === null || patch.acceptanceCriteria.length === 0
						? undefined
						: patch.acceptanceCriteria.map(c => ({ ...c, check: { ...c.check } as typeof c.check }));
			}
			if (patch.scopeGuard !== undefined) {
				state.goal.scopeGuard =
					patch.scopeGuard === null
						? undefined
						: {
								include: [...patch.scopeGuard.include],
								exclude: [...patch.scopeGuard.exclude],
							};
			}
			// Bump contractRevision when any contract-surface field mutated. Subagents detect
			// this via the rendered goal block in DYNAMIC_TAIL and (Phase 3.1/3.3) refuse to
			// trust their cached contract block when its revision lags behind.
			// objective alone does NOT bump revision — it's prose, not contract surface.
			const contractRelevantChanged =
				patch.designAnswers !== undefined ||
				patch.acceptanceCriteria !== undefined ||
				patch.scopeGuard !== undefined;
			if (contractRelevantChanged) {
				state.goal.contractRevision = (state.goal.contractRevision ?? 0) + 1;
			}
			state.goal.updatedAt = this.#now();
			await this.#commitState(state, { persist: "goal" });
			return state.goal;
		});
	}

	/**
	 * Capture Design Interview answers into the active goal, one shot only.
	 *
	 * Called when the `ask` tool completes against an active goal that has not yet
	 * recorded designAnswers. The first such call wins — subsequent calls are no-ops
	 * so the interview cannot accidentally overwrite a captured contract. Lifecycle:
	 *
	 *   1. user creates goal (designAnswers undefined)
	 *   2. agent runs Design Interview via `ask` → results arrive here
	 *   3. captureDesignAnswers writes them onto the goal and persists
	 *   4. next prompt rebuild renders the answers into DYNAMIC_TAIL
	 *
	 * No-ops when: no active goal, goal already has designAnswers, or answers is empty.
	 * Returns true iff answers were captured.
	 */
	async captureDesignAnswers(answers: Record<string, string>): Promise<boolean> {
		if (Object.keys(answers).length === 0) return false;
		return await this.#withAccounting(async () => {
			const state = this.#getStateClone();
			if (!state?.enabled || !state.goal) return false;
			if (state.goal.designAnswers && Object.keys(state.goal.designAnswers).length > 0) return false;
			state.goal.designAnswers = { ...answers };
			state.goal.updatedAt = this.#now();
			await this.#commitState(state, { persist: "goal" });
			return true;
		});
	}

	buildActivePrompt(): string | undefined {
		const state = this.#host.getState();
		return state?.enabled && state.goal && state.goal.status === "active"
			? renderGoalPrompt("active", state.goal)
			: undefined;
	}

	buildContinuationPrompt(): string | undefined {
		const state = this.#host.getState();
		return state?.enabled && state.goal.status === "active"
			? renderGoalPrompt("continuation", state.goal)
			: undefined;
	}

	async #sendBudgetLimitSteer(goal: Goal): Promise<void> {
		if (this.#budgetReportedFor === goal.id) return;
		this.#budgetReportedFor = goal.id;
		await this.#host.sendHiddenMessage({
			customType: "goal-budget-limit",
			content: renderGoalPrompt("budget-limit", goal),
			deliverAs: "steer",
		});
	}
}
