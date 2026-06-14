import { type Objective, RUNNABLE_OBJECTIVE_STATUSES } from "../autonomy/types";

const RUNNABLE = new Set<Objective["status"]>(RUNNABLE_OBJECTIVE_STATUSES);

export function orderObjectivesByPriority(objectives: Objective[]): Objective[] {
	return [...objectives].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function objectiveIsRunnable(objective: Objective, now = Date.now()): boolean {
	if (!RUNNABLE.has(objective.status)) return false;
	if (objective.retiredAt !== undefined) return false;
	if (objective.mergedIntoObjectiveId) return false;
	if (objective.recurrence?.kind === "interval" && objective.progress?.lastMeasuredAt !== undefined) {
		const interval = objective.recurrence.intervalMs ?? 0;
		return now - objective.progress.lastMeasuredAt >= interval;
	}
	return true;
}

export function retireObjective(objective: Objective, reason: string, now = Date.now()): Objective {
	return { ...objective, status: "completed", retiredAt: now, retirementReason: reason };
}
