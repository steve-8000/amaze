/**
 * Store-backed {@link ObjectiveRuntimeHooks}: the IO adapter that lets the
 * {@link ObjectiveScheduler} drive the objective runtime against the durable
 * mission and objective stores. The pure decisioning lives in
 * `./objective-runtime`; this module only reads/writes.
 */

import type { MissionStore } from "../mission/store";
import { type ObjectiveMissionSummary, summarizeObjectiveMission } from "./objective-runtime";
import type { ObjectiveRuntimeHooks } from "./scheduler";
import type { ObjectiveStore } from "./store";
import type { Objective } from "./types";

export interface ObjectiveRuntimeStoreDeps {
	objectiveStore: Pick<ObjectiveStore, "updateProgress" | "updateStatus">;
	missionStore: Pick<MissionStore, "listMissions" | "listAcceptanceCriteria">;
	decompose?: ObjectiveRuntimeHooks["decompose"];
	reviewCompletion?: ObjectiveRuntimeHooks["reviewCompletion"];
}

/**
 * Build {@link ObjectiveRuntimeHooks} backed by the real stores. Missions are
 * read by `objectiveId`; each mission's satisfied acceptance criteria are mapped
 * to the objective metrics they addressed (via the `${objectiveId}-${metric}`
 * convention) by {@link summarizeObjectiveMission}.
 */
export function createObjectiveRuntimeHooks(deps: ObjectiveRuntimeStoreDeps): ObjectiveRuntimeHooks {
	return {
		summarizeMissions(objective: Objective): ObjectiveMissionSummary[] {
			const missions = deps.missionStore.listMissions({ objectiveId: objective.id });
			return missions.map(mission =>
				summarizeObjectiveMission(
					objective.id,
					{ id: mission.id, state: mission.state },
					deps.missionStore.listAcceptanceCriteria(mission.id),
				),
			);
		},
		updateProgress(objectiveId, progress) {
			deps.objectiveStore.updateProgress(objectiveId, progress);
		},
		updateStatus(objectiveId, status) {
			deps.objectiveStore.updateStatus(objectiveId, status);
		},
		...(deps.decompose ? { decompose: deps.decompose } : {}),
		...(deps.reviewCompletion ? { reviewCompletion: deps.reviewCompletion } : {}),
	};
}
