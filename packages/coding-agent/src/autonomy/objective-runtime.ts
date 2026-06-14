/**
 * Objective runtime — the layer that turns a one-shot Mission runtime into a
 * goal-driven loop: a Mission finishing does NOT end an Objective. After every
 * terminal mission the objective is re-evaluated, and while work remains the
 * runtime generates the next mission instead of yielding to the user.
 *
 * Everything here is pure and store-free so it is unit-testable in isolation:
 *
 * 1. {@link reevaluateObjective} — read the bound missions' terminal states and
 *    derive observable progress (which metric targets a completed mission has
 *    satisfied, whether anything is still running or blocked).
 * 2. {@link generateNextMissions} — decompose the still-unmet objective into the
 *    next mission inputs. Deterministic by default (one mission per unmet metric
 *    target); an LLM/heuristic `decompose` strategy is injectable.
 * 3. {@link settleObjective} — combine the two into a single terminal verdict:
 *    next objective status, completion flag, and the missions to create.
 *
 * The scheduler performs the IO (reading mission summaries, persisting status /
 * progress, creating missions) around these functions.
 */

import type { AcceptanceCriterion } from "../mission/core/acceptance-criteria";
import type { MissionInput } from "../mission/core/mission-input";
import type { MissionState } from "../mission/types";
import type { Objective, ObjectiveStatus } from "./types";

/** Mission states that count as a successful, acceptance-passing terminal outcome. */
const SUCCESS_MISSION_STATES: ReadonlySet<MissionState> = new Set<MissionState>(["completed"]);

/** Mission states that ended blocked (recoverable work, not silent success). */
const BLOCKED_MISSION_STATES: ReadonlySet<MissionState> = new Set<MissionState>(["blocked"]);

/** Mission states that are terminal — the mission will not make further progress on its own. */
const TERMINAL_MISSION_STATES: ReadonlySet<MissionState> = new Set<MissionState>([
	"completed",
	"blocked",
	"cancelled",
	"rolled_back",
]);

/**
 * Parent-visible projection of one mission bound to an objective. The scheduler
 * builds these from the durable mission store (see {@link summarizeObjectiveMission}).
 */
export interface ObjectiveMissionSummary {
	id: string;
	state: MissionState;
	/**
	 * Objective metric names this mission has satisfied, derived from its satisfied
	 * acceptance criteria via the `${objectiveId}-${metric}` id convention used by
	 * {@link missionInputForTarget}. Empty/absent when the mission addressed no target.
	 */
	addressedMetrics?: string[];
	/** Evidence refs from satisfied objective criteria on this mission. */
	evidenceRefs?: string[];
}

/** Observable progress snapshot persisted onto the objective. */
export interface ObjectiveProgress {
	/** Fraction 0..1 of metric targets met (or mission success ratio when no targets exist). */
	score: number;
	lastMeasuredAt: number;
	evidenceRefs: string[];
}

/** Pure read of the objective's current state derived from its missions. */
export interface ObjectiveReevaluation {
	/** True when at least one bound mission is still non-terminal. */
	hasActiveMission: boolean;
	/** True when at least one bound mission ended blocked. */
	hasBlockedMission: boolean;
	/** True when at least one bound mission completed successfully. */
	hasSuccessfulMission: boolean;
	/** Metric names addressed by a successfully completed mission. */
	addressedMetrics: string[];
	/** Objective metric targets with no completed mission addressing them yet. */
	unmetMetrics: string[];
	/** Observable progress snapshot. */
	progress: ObjectiveProgress;
}

/**
 * Strategy that decomposes an unmet objective into the next mission inputs. May be
 * synchronous (the deterministic default) or async (an LLM-backed planner). The
 * generator awaits the result either way, so an injected LLM decomposer is a drop-in.
 */
export type ObjectiveDecomposer = (input: {
	objective: Objective;
	missions: ObjectiveMissionSummary[];
	reevaluation: ObjectiveReevaluation;
}) => MissionInput[] | Promise<MissionInput[]>;

/** Verdict from the objective completion self-review gate. */
export interface ObjectiveCompletionReview {
	/** `pass` lets the objective complete; `fail` blocks completion. */
	verdict: "pass" | "fail";
	reason: string;
	/**
	 * Missions the reviewer wants run before the objective can complete. When non-empty
	 * on a `fail`, the objective goes back to `in_progress` and these are generated;
	 * when empty on a `fail`, it goes to `needs_replan`.
	 */
	followUpMissions?: MissionInput[];
}

/**
 * Self-review gate run immediately before an objective is declared complete. The
 * deterministic settle path already proves "every metric target met by a completed
 * mission, nothing blocked"; this seam adds the semantic check the proposal asks for
 * — "did we REALLY finish, or did tests pass while design work remains?" — and can
 * veto a premature completion. Optional: absent, metric-completion stands.
 */
export type ObjectiveCompletionReviewer = (input: {
	objective: Objective;
	missions: ObjectiveMissionSummary[];
	reevaluation: ObjectiveReevaluation;
}) => ObjectiveCompletionReview | Promise<ObjectiveCompletionReview>;

export interface GenerateNextMissionsOptions {
	/** Override the default metric-target decomposition (e.g. an LLM planner). */
	decompose?: ObjectiveDecomposer;
	now?: () => number;
}

export interface SettleObjectiveOptions extends GenerateNextMissionsOptions {
	/** Optional self-review gate consulted before an objective is declared complete. */
	reviewCompletion?: ObjectiveCompletionReviewer;
}

/** Combined terminal verdict for one objective-runtime tick. */
export interface ObjectiveSettlement {
	/** The objective status the runtime should persist. */
	status: ObjectiveStatus;
	/** True when the objective is genuinely done — never set while work remains. */
	complete: boolean;
	reason: string;
	progress: ObjectiveProgress;
	/** Missions the runtime must create to make progress. Empty when none are needed. */
	nextMissions: MissionInput[];
}

/** Build the metric names declared by an objective. */
function objectiveMetrics(objective: Objective): string[] {
	return objective.metricTargets.map(target => target.metric);
}

/**
 * Re-evaluate an objective from its missions' terminal states. Pure: no IO, no
 * mutation. The scheduler persists {@link ObjectiveReevaluation.progress} and uses
 * the booleans to decide the next status.
 */
export function reevaluateObjective(
	objective: Objective,
	missions: ObjectiveMissionSummary[],
	now: () => number = Date.now,
): ObjectiveReevaluation {
	const metrics = objectiveMetrics(objective);
	const addressed = new Set<string>();
	let hasActiveMission = false;
	let hasBlockedMission = false;
	let hasSuccessfulMission = false;
	let completedCount = 0;

	const evidenceRefs = new Set<string>();
	for (const mission of missions) {
		if (!TERMINAL_MISSION_STATES.has(mission.state)) hasActiveMission = true;
		if (BLOCKED_MISSION_STATES.has(mission.state)) hasBlockedMission = true;
		if (SUCCESS_MISSION_STATES.has(mission.state)) {
			hasSuccessfulMission = true;
			completedCount += 1;
			for (const metric of mission.addressedMetrics ?? []) addressed.add(metric);
			for (const ref of mission.evidenceRefs ?? []) evidenceRefs.add(ref);
		}
	}

	const addressedMetrics = metrics.filter(metric => addressed.has(metric));
	const unmetMetrics = metrics.filter(metric => !addressed.has(metric));
	const score =
		metrics.length > 0
			? addressedMetrics.length / metrics.length
			: missions.length > 0
				? completedCount / missions.length
				: 0;

	return {
		hasActiveMission,
		hasBlockedMission,
		hasSuccessfulMission,
		addressedMetrics,
		unmetMetrics,
		progress: { score, lastMeasuredAt: now(), evidenceRefs: [...evidenceRefs].sort() },
	};
}

/**
 * Build a mission input that drives a single objective metric target. The
 * acceptance criterion id follows the `${objectiveId}-${metric}` convention so a
 * later {@link reevaluateObjective} can recognise which target the mission closed.
 */
export function missionInputForTarget(objective: Objective, target: Objective["metricTargets"][number]): MissionInput {
	return {
		title: `${objective.title}: ${target.metric}`,
		objective: `Drive ${target.metric} ${target.direction} to ${target.target} for objective "${objective.title}".`,
		projectId: objective.id,
		mode: "auto",
		constraints: [
			`Objective budget: ${JSON.stringify(objective.budget)}`,
			`Objective guardrails: ${JSON.stringify(objective.guardrails)}`,
		],
		acceptanceCriteria: [
			{
				id: `${objective.id}-${target.metric}`,
				description: `${target.metric} moves ${target.direction} to ${target.target}`,
				satisfied: false,
			},
		],
		...(objective.budget.tokens
			? {
					budget: {
						tokenBudget: objective.budget.tokens,
						tokensUsed: 0,
						...(objective.budget.wallClockMs !== undefined ? { timeBudgetMs: objective.budget.wallClockMs } : {}),
					},
				}
			: {}),
	};
}

/** Build a single bootstrap mission for an objective that declares no metric targets. */
function bootstrapMissionInput(objective: Objective): MissionInput {
	return {
		title: objective.title,
		objective: objective.title,
		projectId: objective.id,
		mode: "auto",
		constraints: [
			`Objective budget: ${JSON.stringify(objective.budget)}`,
			`Objective guardrails: ${JSON.stringify(objective.guardrails)}`,
		],
		...(objective.budget.tokens
			? {
					budget: {
						tokenBudget: objective.budget.tokens,
						tokensUsed: 0,
						...(objective.budget.wallClockMs !== undefined ? { timeBudgetMs: objective.budget.wallClockMs } : {}),
					},
				}
			: {}),
	};
}

/**
 * Decompose an objective into the next missions to run. Returns an empty array
 * when no further work is warranted (every metric target already has a completed
 * mission, or a target-less objective already produced a success).
 *
 * Default strategy: one mission per unmet metric target. A metric whose previous
 * mission blocked is still "unmet", so it is regenerated — that is how a blocked
 * mission becomes recoverable replan work rather than a dead end. The number of
 * missions returned per call is capped by `guardrails.maxAutoSubgoalsPerDay`.
 */
export async function generateNextMissions(
	objective: Objective,
	missions: ObjectiveMissionSummary[],
	options: GenerateNextMissionsOptions = {},
): Promise<MissionInput[]> {
	const now = options.now ?? Date.now;
	const reevaluation = reevaluateObjective(objective, missions, now);
	// `maxAutoSubgoalsPerDay` is a hard per-tick cap: 0 means "generate nothing", so the
	// objective settles as blocked/needs_replan rather than as silent success.
	const cap = Math.max(0, objective.guardrails.maxAutoSubgoalsPerDay);

	if (options.decompose) {
		const decomposed = await options.decompose({ objective, missions, reevaluation });
		return decomposed.slice(0, cap);
	}

	if (objective.metricTargets.length === 0) {
		// Target-less objective: a single success closes it; nothing further to generate.
		if (missions.length === 0) return cap === 0 ? [] : [bootstrapMissionInput(objective)];
		return [];
	}

	const unmet = new Set(reevaluation.unmetMetrics);
	const next = objective.metricTargets
		.filter(target => unmet.has(target.metric))
		.map(target => missionInputForTarget(objective, target));
	return next.slice(0, cap);
}

/**
 * Combine {@link reevaluateObjective} and {@link generateNextMissions} into one
 * terminal verdict. This is the function the scheduler calls per tick.
 *
 * Status semantics:
 * - a non-terminal mission still running → `in_progress` (no new missions);
 * - quiescent with missions to generate → `in_progress` (create them);
 * - quiescent, every target met, at least one success, nothing blocked → `completed`;
 * - quiescent, work remains but none could be generated, a mission blocked → `blocked`;
 * - quiescent, work remains but none could be generated, nothing blocked → `needs_replan`.
 */
export async function settleObjective(
	objective: Objective,
	missions: ObjectiveMissionSummary[],
	options: SettleObjectiveOptions = {},
): Promise<ObjectiveSettlement> {
	const now = options.now ?? Date.now;
	const reevaluation = reevaluateObjective(objective, missions, now);
	const { progress } = reevaluation;

	if (reevaluation.hasActiveMission) {
		return {
			status: "in_progress",
			complete: false,
			reason: "objective has a mission still in progress",
			progress,
			nextMissions: [],
		};
	}

	const nextMissions = await generateNextMissions(objective, missions, options);
	if (nextMissions.length > 0) {
		return {
			status: "in_progress",
			complete: false,
			reason: `objective requires ${nextMissions.length} further mission(s)`,
			progress,
			nextMissions,
		};
	}

	if (reevaluation.unmetMetrics.length === 0 && reevaluation.hasSuccessfulMission && !reevaluation.hasBlockedMission) {
		// Metric-completion is proven. Run the self-review gate before declaring done:
		// it can veto a premature "complete" (tests passed but design work remains).
		if (options.reviewCompletion) {
			const review = await options.reviewCompletion({ objective, missions, reevaluation });
			if (review.verdict === "fail") {
				const followUps = (review.followUpMissions ?? []).slice(
					0,
					Math.max(0, objective.guardrails.maxAutoSubgoalsPerDay),
				);
				if (followUps.length > 0) {
					return {
						status: "in_progress",
						complete: false,
						reason: `completion review rejected: ${review.reason}`,
						progress,
						nextMissions: followUps,
					};
				}
				return {
					status: "needs_replan",
					complete: false,
					reason: `completion review rejected: ${review.reason}`,
					progress,
					nextMissions: [],
				};
			}
		}
		return {
			status: "completed",
			complete: true,
			reason: "all objective targets met by completed missions",
			progress,
			nextMissions: [],
		};
	}

	if (reevaluation.hasBlockedMission) {
		return {
			status: "blocked",
			complete: false,
			reason: "objective work remains but a mission is blocked and no follow-up could be generated",
			progress,
			nextMissions: [],
		};
	}

	return {
		status: "needs_replan",
		complete: false,
		reason: "objective work remains but no follow-up mission could be generated",
		progress,
		nextMissions: [],
	};
}

/**
 * Build an {@link ObjectiveMissionSummary} from a mission's durable state and its
 * acceptance criteria. Satisfied criteria whose id follows the
 * `${objectiveId}-${metric}` convention contribute the addressed metric names;
 * their evidence refs become objective progress evidence.
 */
export function summarizeObjectiveMission(
	objectiveId: string,
	mission: { id: string; state: MissionState },
	criteria: AcceptanceCriterion[],
): ObjectiveMissionSummary {
	const prefix = `${objectiveId}-`;
	const addressedMetrics: string[] = [];
	const evidenceRefs = new Set<string>();
	for (const criterion of criteria) {
		if (!criterion.satisfied || !criterion.id.startsWith(prefix)) continue;
		addressedMetrics.push(criterion.id.slice(prefix.length));
		for (const ref of criterion.evidenceRefs ?? []) evidenceRefs.add(ref);
	}
	const summary: ObjectiveMissionSummary = { id: mission.id, state: mission.state };
	if (addressedMetrics.length > 0) summary.addressedMetrics = addressedMetrics;
	if (evidenceRefs.size > 0) summary.evidenceRefs = [...evidenceRefs].sort();
	return summary;
}
