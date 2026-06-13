/**
 * Cognition plane — world-model context.
 *
 * The `mission_world_model` table has existed since the mission store baseline
 * but nothing read it for reasoning. This module makes it consumable: it
 * selects the claims worth injecting into planning/critique prompts and
 * records planner/learner actions back as world-model records so the mission's
 * causal trail is queryable.
 */

import type { MissionStore } from "../mission/store";
import type { MissionWorldModelRecord } from "../mission/types";

/**
 * Select world-model claims for prompt injection. Priorities, in order:
 * verified outcomes (ground truth), contradicted/failed outcomes (hazards),
 * then unverified claims (context). Bounded for prompt budget.
 */
export function worldModelForPlanning(store: MissionStore, missionId: string, limit = 10): string[] {
	const records = store.listWorldModel(missionId);
	const ranked = [...records].sort((a, b) => rank(b) - rank(a) || b.createdAt - a.createdAt);
	return ranked.slice(0, limit).map(formatClaim);
}

function rank(record: MissionWorldModelRecord): number {
	if (record.verified && record.outcomeStatus === "pass") return 3;
	if (record.outcomeStatus === "fail" || record.outcomeStatus === "blocked") return 2;
	if (record.verified) return 1;
	return 0;
}

function formatClaim(record: MissionWorldModelRecord): string {
	const status = record.outcomeStatus ? ` [${record.outcomeStatus}]` : "";
	const verified = record.verified ? " (verified)" : "";
	return `${record.kind}${status}${verified}: ${record.claim}`;
}

/** Record a planner decomposition as a world-model action record. */
export function recordPlanAction(
	store: MissionStore,
	missionId: string,
	input: { revision: number; stepCount: number; rationale?: string },
): MissionWorldModelRecord {
	return store.recordWorldModel({
		missionId,
		kind: "action",
		source: "decision",
		sourceId: `plan-rev-${input.revision}`,
		claim: `Planner decomposed objective into ${input.stepCount} steps (revision ${input.revision})${
			input.rationale ? `: ${input.rationale}` : ""
		}`,
		evidenceRefs: [`plan://${missionId}/rev/${input.revision}`],
		verified: false,
	});
}

/** Record a learned heuristic as a world-model outcome record. */
export function recordLearnedOutcome(
	store: MissionStore,
	missionId: string,
	input: { claim: string; knowledgeItemId: string; outcomeStatus: "pass" | "fail" | "uncertain" | "blocked" },
): MissionWorldModelRecord {
	return store.recordWorldModel({
		missionId,
		kind: "outcome",
		source: "task-attempt",
		sourceId: input.knowledgeItemId,
		claim: input.claim,
		evidenceRefs: [`knowledge://${input.knowledgeItemId}`],
		outcomeStatus: input.outcomeStatus,
		verified: false,
	});
}
