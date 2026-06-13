import type { ContinuationAction } from "../mission/continuation/policy";
import type { MissionInput } from "../mission/core/mission-input";
import type { MissionRuntime } from "../mission/core/mission-runtime.iface";
import type { ObjectiveStore } from "./store";
import type { Objective, ObjectiveEvent } from "./types";

export interface ObjectiveSchedulerDeps {
	store: Pick<ObjectiveStore, "list" | "recordEvent">;
	missionRuntime: Pick<MissionRuntime, "create" | "block">;
	classifyContinuation(input: { missionId?: string; objectiveId: string }): ContinuationAction;
	findMissionForObjective?(objective: Objective): Promise<string | undefined> | string | undefined;
	resumeMission?(missionId: string, objective: Objective): Promise<void> | void;
	holdObjective?(decision: ObjectiveTickDecision): Promise<void> | void;
	now(): number;
}

export type ObjectiveTickDecisionKind = "schedule-mission" | "resume-mission" | "hold" | "skip" | "block";

export interface ObjectiveTickDecision {
	objectiveId: string;
	kind: ObjectiveTickDecisionKind;
	reason: string;
	missionId?: string;
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
		if (objective.status !== "active") {
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

	recordDecision(decision: ObjectiveTickDecision): ObjectiveEvent {
		return this.#deps.store.recordEvent(decision.objectiveId, "scheduler.decision", {
			kind: decision.kind,
			reason: decision.reason,
			missionId: decision.missionId,
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
