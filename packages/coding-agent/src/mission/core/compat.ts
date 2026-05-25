/**
 * Pure, conservative adapters between the existing mission types (mission/types.ts)
 * and the refactored mission core types. Only fields that clearly correspond are
 * mapped; everything ambiguous is left undefined so the caller can decide.
 *
 * This module has no side effects and does not mutate its inputs.
 */
import type { GoalStatus } from "../../goals/state";
import type { ResearchCampaign as LegacyMission, MissionState } from "../types";
import type { Mission as CoreMission, MissionLifecycleState } from "./mission";

/**
 * Map a legacy {@link MissionState} to a core {@link MissionLifecycleState}.
 *
 * Only states with an unambiguous counterpart are translated. Legacy states
 * with no clear core equivalent (`drafting`, `synthesizing`, `deciding`) return
 * `undefined`.
 */
export function legacyStateToLifecycle(state: MissionState): MissionLifecycleState | undefined {
	switch (state) {
		case "researching":
			return "researching";
		case "critiquing":
			return "critiquing";
		case "contracted":
			return "contracting";
		case "executing":
			return "executing";
		case "verifying":
			return "verifying";
		case "completed":
			return "completed";
		case "rolled_back":
			return "rolled_back";
		case "blocked":
			return "blocked";
		case "cancelled":
			return "cancelled";
		// drafting | synthesizing | deciding: no unambiguous core equivalent.
		default:
			return undefined;
	}
}

/**
 * Map a core {@link MissionLifecycleState} back to a legacy {@link MissionState}.
 *
 * Core-only states (`created`, `classified`, `planning`) have no legacy
 * counterpart and return `undefined`.
 */
export function lifecycleToLegacyState(lifecycle: MissionLifecycleState): MissionState | undefined {
	switch (lifecycle) {
		case "researching":
			return "researching";
		case "critiquing":
			return "critiquing";
		case "contracting":
			return "contracted";
		case "executing":
			return "executing";
		case "verifying":
			return "verifying";
		case "completed":
			return "completed";
		case "rolled_back":
			return "rolled_back";
		case "blocked":
			return "blocked";
		case "cancelled":
			return "cancelled";
		// created | classified | planning: no legacy equivalent.
		default:
			return undefined;
	}
}

/**
 * Project the overlapping fields of a legacy mission onto a partial core
 * mission. Fields that do not clearly correspond (objective, mode, budgets,
 * constraints, etc.) are omitted so callers can fill them in deliberately.
 */
export function legacyMissionToCorePartial(legacy: LegacyMission): Partial<CoreMission> {
	const partial: Partial<CoreMission> = {
		id: legacy.id,
		title: legacy.title,
		riskLevel: legacy.riskLevel,
		createdAt: legacy.createdAt,
		updatedAt: legacy.updatedAt,
	};
	const lifecycle = legacyStateToLifecycle(legacy.state);
	if (lifecycle !== undefined) partial.lifecycle = lifecycle;
	if (legacy.decisionId !== null) partial.decisionId = legacy.decisionId;
	return partial;
}

/**
 * Project the overlapping fields of a core mission onto a partial legacy
 * mission. Legacy-only fields (objectiveId, briefId, confidence, snapshotRef)
 * are left absent unless they can be derived.
 */
export function coreMissionToLegacyPartial(core: CoreMission): Partial<LegacyMission> {
	const partial: Partial<LegacyMission> = {
		id: core.id,
		title: core.title,
		riskLevel: core.riskLevel,
		decisionId: core.decisionId ?? null,
		createdAt: core.createdAt,
		updatedAt: core.updatedAt,
	};
	const state = lifecycleToLegacyState(core.lifecycle);
	if (state !== undefined) partial.state = state;
	return partial;
}

/**
 * Map a legacy {@link GoalStatus} (6 states) to a core {@link MissionLifecycleState}
 * (12 states). The Goal model is the interactive single-objective execution mode and
 * skips the orchestration-progression states (created/classified/planning/...). This
 * is the canonical mapping used while unifying ObjectiveRuntimeImpl into the objective runtime.
 *
 * Note: `paused` and `budget-limited` are Goal-specific "awaiting external input"
 * nuances; both collapse to `blocked`. The richer reason is carried separately on the
 * unified runtime, so the reverse mapping is intentionally lossy.
 */
export function goalStatusToLifecycle(status: GoalStatus): MissionLifecycleState {
	switch (status) {
		case "active":
			return "executing";
		case "paused":
		case "budget-limited":
		case "blocked":
			return "blocked";
		case "complete":
			return "completed";
		case "dropped":
			return "cancelled";
	}
}

/**
 * Map a core {@link MissionLifecycleState} back to the closest legacy {@link GoalStatus}.
 * Orchestration-only lifecycle states (created/classified/planning/researching/
 * critiquing/contracting/verifying/rolled_back) have no Goal counterpart and return
 * `undefined`. `blocked` always maps to `blocked` (the paused/budget-limited nuance is
 * not recoverable from lifecycle alone — see {@link goalStatusToLifecycle}).
 */
export function lifecycleToGoalStatus(lifecycle: MissionLifecycleState): GoalStatus | undefined {
	switch (lifecycle) {
		case "executing":
			return "active";
		case "blocked":
			return "blocked";
		case "completed":
			return "complete";
		case "cancelled":
			return "dropped";
		default:
			return undefined;
	}
}
