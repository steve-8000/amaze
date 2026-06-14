import type { ContinuationAction } from "../mission/continuation/policy";
import type { MissionInput } from "../mission/core/mission-input";
import type { MissionRuntime } from "../mission/core/mission-runtime.iface";
import {
	type GenerateNextMissionsOptions,
	type ObjectiveMissionSummary,
	type ObjectiveSettlement,
	type SettleObjectiveOptions,
	settleObjective,
} from "./objective-runtime";
import type { ObjectiveStore } from "./store";
import { type Objective, type ObjectiveEvent, RUNNABLE_OBJECTIVE_STATUSES } from "./types";

const RUNNABLE_STATUSES = new Set<Objective["status"]>(RUNNABLE_OBJECTIVE_STATUSES);

/**
 * Objective-runtime hooks. When supplied, the scheduler stops treating a finished
 * mission as the end of the objective: it re-evaluates the objective from its
 * missions, persists progress/status, and generates the next mission(s) while work
 * remains. Absent, the scheduler keeps its legacy 1:1 objective→mission behavior.
 */
export interface ObjectiveRuntimeHooks {
	/** Read the parent-visible summaries of every mission bound to the objective. */
	summarizeMissions(objective: Objective): Promise<ObjectiveMissionSummary[]> | ObjectiveMissionSummary[];
	/** Persist the objective's observable progress snapshot. */
	updateProgress(objectiveId: string, progress: ObjectiveSettlement["progress"]): Promise<void> | void;
	/** Persist a new objective status (callers may skip a write when unchanged). */
	updateStatus(objectiveId: string, status: ObjectiveSettlement["status"]): Promise<void> | void;
	/** Optional decomposition strategy override for mission generation. */
	decompose?: GenerateNextMissionsOptions["decompose"];
	/** Optional self-review gate consulted before an objective is declared complete. */
	reviewCompletion?: SettleObjectiveOptions["reviewCompletion"];
}

export interface ObjectiveSchedulerDeps {
	store: Pick<ObjectiveStore, "list" | "recordEvent">;
	missionRuntime: Pick<MissionRuntime, "create" | "block">;
	classifyContinuation(input: { missionId?: string; objectiveId: string }): ContinuationAction;
	findMissionForObjective?(objective: Objective): Promise<string | undefined> | string | undefined;
	resumeMission?(missionId: string, objective: Objective): Promise<void> | void;
	holdObjective?(decision: ObjectiveTickDecision): Promise<void> | void;
	/** Optional objective-runtime loop. When present, drives re-eval + mission generation. */
	objectiveRuntime?: ObjectiveRuntimeHooks;
	now(): number;
}

export type ObjectiveTickDecisionKind =
	| "schedule-mission"
	| "resume-mission"
	| "generate-missions"
	| "complete-objective"
	| "hold"
	| "skip"
	| "block";

export interface ObjectiveTickDecision {
	objectiveId: string;
	kind: ObjectiveTickDecisionKind;
	reason: string;
	missionId?: string;
	/** Ids of missions created this tick by the objective-runtime generator. */
	generatedMissionIds?: string[];
	/** Objective status persisted this tick, when the objective runtime ran. */
	objectiveStatus?: ObjectiveSettlement["status"];
}

export class ObjectiveScheduler {
	readonly #deps: ObjectiveSchedulerDeps;

	constructor(deps: ObjectiveSchedulerDeps) {
		this.#deps = deps;
	}

	async tick(): Promise<ObjectiveTickDecision[]> {
		const decisions: ObjectiveTickDecision[] = [];
		for (const objective of this.#deps.store.list()) {
			const decision = await this.decide(objective);
			this.recordDecision(decision);
			decisions.push(decision);
		}
		return decisions;
	}

	async decide(objective: Objective): Promise<ObjectiveTickDecision> {
		if (!RUNNABLE_STATUSES.has(objective.status)) {
			return { objectiveId: objective.id, kind: "skip", reason: `objective is ${objective.status}` };
		}

		if (objective.guardrails.requireHumanForApply) {
			const decision = {
				objectiveId: objective.id,
				kind: "hold",
				reason: "guardrail requires human approval before apply",
			} satisfies ObjectiveTickDecision;
			await this.#deps.holdObjective?.(decision);
			return decision;
		}

		const missionId = await this.#deps.findMissionForObjective?.(objective);
		const action = this.#deps.classifyContinuation({ objectiveId: objective.id, missionId });
		if (action.kind === "block") {
			if (missionId) await this.#deps.missionRuntime.block(missionId, { reason: action.reason });
			return { objectiveId: objective.id, kind: "block", reason: action.reason, missionId };
		}
		if (action.kind === "hold") {
			const decision = {
				objectiveId: objective.id,
				kind: "hold",
				reason: action.reason,
				missionId,
			} satisfies ObjectiveTickDecision;
			await this.#deps.holdObjective?.(decision);
			return decision;
		}
		if (action.kind === "continue") {
			if (missionId) await this.#deps.resumeMission?.(missionId, objective);
			return { objectiveId: objective.id, kind: "resume-mission", reason: action.reason, missionId };
		}
		// Quiescent point: the bound mission (if any) is terminal or absent. With the
		// objective runtime wired, re-evaluate the objective and generate the next
		// mission(s) instead of treating a finished mission as the end of the objective.
		if (this.#deps.objectiveRuntime) {
			return await this.#settle(objective, missionId);
		}
		if (action.kind === "observe-terminal") {
			return { objectiveId: objective.id, kind: "skip", reason: action.reason, missionId };
		}
		if (action.kind === "none" && missionId) {
			return { objectiveId: objective.id, kind: "skip", reason: action.reason, missionId };
		}

		const mission = await this.#deps.missionRuntime.create(missionInputFromObjective(objective));
		return {
			objectiveId: objective.id,
			missionId: mission.id,
			kind: "schedule-mission",
			reason: "active objective has no resumable mission",
		};
	}

	/**
	 * Objective-runtime settlement: re-evaluate the objective from its missions,
	 * persist progress and any status transition, and either complete it, generate
	 * the next mission(s), or report it stuck (blocked / needs_replan). NEVER yields a
	 * silent "done" while {@link settleObjective} reports remaining work.
	 */
	async #settle(objective: Objective, terminalMissionId: string | undefined): Promise<ObjectiveTickDecision> {
		const hooks = this.#deps.objectiveRuntime;
		if (!hooks) throw new Error("objective runtime hooks required for settlement");
		const missions = await hooks.summarizeMissions(objective);
		const settlement = await settleObjective(objective, missions, {
			...(hooks.decompose ? { decompose: hooks.decompose } : {}),
			...(hooks.reviewCompletion ? { reviewCompletion: hooks.reviewCompletion } : {}),
			now: this.#deps.now,
		});
		await hooks.updateProgress(objective.id, settlement.progress);
		if (settlement.status !== objective.status) {
			await hooks.updateStatus(objective.id, settlement.status);
		}
		if (settlement.complete) {
			return {
				objectiveId: objective.id,
				kind: "complete-objective",
				reason: settlement.reason,
				objectiveStatus: settlement.status,
				...(terminalMissionId ? { missionId: terminalMissionId } : {}),
			};
		}
		if (settlement.nextMissions.length > 0) {
			const generatedMissionIds: string[] = [];
			for (const input of settlement.nextMissions) {
				const mission = await this.#deps.missionRuntime.create(input);
				generatedMissionIds.push(mission.id);
			}
			return {
				objectiveId: objective.id,
				kind: "generate-missions",
				reason: settlement.reason,
				objectiveStatus: settlement.status,
				generatedMissionIds,
			};
		}
		return {
			objectiveId: objective.id,
			kind: "skip",
			reason: settlement.reason,
			objectiveStatus: settlement.status,
			...(terminalMissionId ? { missionId: terminalMissionId } : {}),
		};
	}

	recordDecision(decision: ObjectiveTickDecision): ObjectiveEvent {
		return this.#deps.store.recordEvent(decision.objectiveId, "scheduler.decision", {
			kind: decision.kind,
			reason: decision.reason,
			missionId: decision.missionId,
			...(decision.objectiveStatus ? { objectiveStatus: decision.objectiveStatus } : {}),
			...(decision.generatedMissionIds ? { generatedMissionIds: decision.generatedMissionIds } : {}),
			ts: this.#deps.now(),
		});
	}
}

export function missionInputFromObjective(objective: Objective): MissionInput {
	return {
		title: objective.title,
		objective: objective.title,
		projectId: objective.id,
		mode: "auto",
		constraints: [
			`Objective budget: ${JSON.stringify(objective.budget)}`,
			`Objective guardrails: ${JSON.stringify(objective.guardrails)}`,
		],
		acceptanceCriteria: objective.metricTargets.map(target => ({
			id: `${objective.id}-${target.metric}`,
			description: `${target.metric} moves ${target.direction} to ${target.target}`,
			satisfied: false,
		})),
		budget: objective.budget.tokens
			? {
					tokenBudget: objective.budget.tokens,
					tokensUsed: 0,
					timeBudgetMs: objective.budget.wallClockMs,
				}
			: undefined,
	};
}
