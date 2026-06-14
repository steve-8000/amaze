/**
 * Session ↔ objective binding — the durable link that lets a LIVE interactive
 * mission participate in the objective runtime.
 *
 * Live missions are created by `MissionControlRuntime` (ensureActiveMission /
 * promoteFromAmbient / createMission) WITHOUT an owning objective, so
 * `mission.objectiveId` is null and the objective runtime has nothing to settle
 * after the mission terminalizes. This adapter creates (or reuses) a durable
 * {@link Objective} for a mission and patches the mission's `objectiveId`, so the
 * Step-2 settlement loop ({@link settleObjective}) can re-evaluate the objective
 * from its mission(s) instead of treating a finished mission as the end of all
 * work.
 *
 * The bound objective is intentionally target-less and conservative: a single
 * completed mission settles it `completed`; a blocked mission settles it
 * `blocked`. It NEVER auto-generates brand-new missions on its own — the live
 * binding sets `maxAutoSubgoalsPerDay: 0`, so `generateNextMissions` is capped to
 * zero. That keeps the interactive path free of the runaway-continuation hazard
 * documented in `.amaze/config.yml`.
 *
 * Pure IO adapter: no policy decisions live here. Decisioning is in
 * `./objective-runtime` ({@link settleObjective}) and the live terminal handler.
 */

import type { MissionInput } from "../mission/core/mission-input";
import type { MissionStore } from "../mission/store";
import { type ObjectiveSettlement, settleObjective, summarizeObjectiveMission } from "./objective-runtime";
import type { ObjectiveStore } from "./store";
import type { ObjectiveGuardrails } from "./types";

/**
 * Guardrails applied to an objective auto-bound to a single live mission. The
 * `maxAutoSubgoalsPerDay: 0` floor is load-bearing: it guarantees a live-bound
 * objective can only settle the mission it already owns and can never spawn new
 * missions autonomously.
 */
export const LIVE_BOUND_OBJECTIVE_GUARDRAILS: ObjectiveGuardrails = {
	// The interactive operator is always present, so apply still asks a human.
	requireHumanForApply: true,
	// A live-bound objective never spawns brand-new missions on its own; it only
	// settles the mission it already owns. This is the runaway-loop safety floor.
	maxAutoSubgoalsPerDay: 0,
	forbiddenScopes: [],
};

export interface SessionObjectiveBindingDeps {
	objectives: Pick<ObjectiveStore, "create" | "get">;
	missions: Pick<MissionStore, "getMission" | "updateMission">;
}

export interface EnsureObjectiveForMissionInput {
	missionId: string;
}

export interface EnsureObjectiveForMissionResult {
	objectiveId: string;
	/** True when a new objective row was created this call. */
	created: boolean;
}

/**
 * Ensure the mission identified by `missionId` is bound to a durable objective.
 * Idempotent: a mission already linked to an existing objective returns that
 * objective without creating a new one.
 *
 * @throws if the mission does not exist in the store.
 */
export function ensureObjectiveForMission(
	deps: SessionObjectiveBindingDeps,
	input: EnsureObjectiveForMissionInput,
): EnsureObjectiveForMissionResult {
	const mission = deps.missions.getMission(input.missionId);
	if (!mission) throw new Error(`Mission not found for objective binding: ${input.missionId}`);

	// Reuse an existing, still-present objective binding.
	if (mission.objectiveId) {
		const existing = deps.objectives.get(mission.objectiveId);
		if (existing) return { objectiveId: existing.id, created: false };
	}

	const objective = deps.objectives.create({
		title: mission.title,
		metricTargets: [],
		budget: {},
		guardrails: LIVE_BOUND_OBJECTIVE_GUARDRAILS,
	});
	deps.missions.updateMission(mission.id, { objectiveId: objective.id });
	return { objectiveId: objective.id, created: true };
}

/** Mission factory the settlement loop calls to create capped follow-up missions. */
export type ObjectiveMissionFactory = (input: MissionInput) => Promise<{ id: string }> | { id: string };

export interface SettleObjectiveForMissionDeps {
	objectives: Pick<ObjectiveStore, "get" | "updateProgress" | "updateStatus" | "recordEvent">;
	missions: Pick<MissionStore, "listMissions" | "listAcceptanceCriteria">;
	/** Creates a follow-up mission. Only invoked when settlement returns nextMissions. */
	createMission: ObjectiveMissionFactory;
}

export interface SettleObjectiveForMissionInput {
	objectiveId: string;
}

export interface SettleObjectiveForMissionResult {
	settlement: ObjectiveSettlement;
	/** Ids of follow-up missions created this settlement (empty for a live-bound objective). */
	generatedMissionIds: string[];
}

/**
 * Step-2 settlement: re-evaluate an objective from its missions and persist the
 * verdict, mirroring `ObjectiveScheduler.#settle` but driven by a single finished
 * live mission rather than a full-store scheduler tick.
 *
 * The objective's `guardrails.maxAutoSubgoalsPerDay` is the hard cap on follow-up
 * missions (see {@link settleObjective} / {@link generateNextMissions}). For a
 * live-bound objective that cap is 0, so `nextMissions` is always empty and this
 * function only persists progress/status — it never spawns autonomous work. The
 * `createMission` seam exists so a future caller with a non-zero cap (e.g. an
 * operator-defined objective) reuses the same settlement path.
 *
 * @throws if the objective does not exist.
 */
export async function settleObjectiveForMission(
	deps: SettleObjectiveForMissionDeps,
	input: SettleObjectiveForMissionInput,
): Promise<SettleObjectiveForMissionResult> {
	const objective = deps.objectives.get(input.objectiveId);
	if (!objective) throw new Error(`Objective not found for settlement: ${input.objectiveId}`);

	const summaries = deps.missions
		.listMissions({ objectiveId: objective.id })
		.map(mission =>
			summarizeObjectiveMission(
				objective.id,
				{ id: mission.id, state: mission.state },
				deps.missions.listAcceptanceCriteria(mission.id),
			),
		);

	const settlement = await settleObjective(objective, summaries);
	deps.objectives.updateProgress(objective.id, settlement.progress);
	if (settlement.status !== objective.status) {
		deps.objectives.updateStatus(objective.id, settlement.status);
	}

	const generatedMissionIds: string[] = [];
	for (const missionInput of settlement.nextMissions) {
		const created = await deps.createMission(missionInput);
		generatedMissionIds.push(created.id);
	}

	deps.objectives.recordEvent(objective.id, "session.settlement", {
		status: settlement.status,
		complete: settlement.complete,
		reason: settlement.reason,
		generatedMissionIds,
	});

	return { settlement, generatedMissionIds };
}
