/**
 * Cognition plane — outcome-to-heuristic learner.
 *
 * Closes the minimal failure-learning loop: after a mission reaches a terminal
 * state, the learner derives durable heuristics from observable evidence
 * (task attempt checkpoints, verification verdicts, outcome status) and records
 * them in the {@link KnowledgeStore} at `global` scope (L5). The planner then
 * injects active heuristics into future decomposition prompts via
 * {@link heuristicsForPlanning}.
 *
 * Deliberately evidence-first: every heuristic cites the mission and checkpoint
 * ids it was derived from (KnowledgeStore rejects unsourced claims), and
 * deriving twice for the same mission supersedes nothing — duplicates are
 * skipped by normalized claim text.
 */

import type { KnowledgeStore } from "../memory/knowledge-store";
import type { KnowledgeItem } from "../memory/types";
import type { MissionTaskAttemptCheckpoint } from "../mission/types";

/** Observable mission outcome snapshot the learner consumes. Pure data. */
export interface MissionOutcomeSnapshot {
	missionId: string;
	objective: string;
	/** Terminal status the mission ended in. */
	status: "success" | "partial" | "failure" | "cancelled" | "blocked";
	/** Task attempt checkpoints recorded during the mission. */
	checkpoints: MissionTaskAttemptCheckpoint[];
	/** Final verification verdict, when one was recorded. */
	verificationVerdict?: "pass" | "fail" | "pending" | null;
}

export interface DerivedHeuristic {
	claim: string;
	sourceRefs: string[];
	confidence: "low" | "medium" | "high";
}

/**
 * Derive heuristics from a mission outcome. Pure: no IO, deterministic given
 * the snapshot. Heuristics are conservative — only patterns with direct
 * observable evidence are emitted:
 *
 * 1. Repeated contract failures by the same agent/role → "needs tighter scoping".
 * 2. Uncertain verdicts that escalated → "criteria were not independently verifiable".
 * 3. Blocked checkpoints → "prerequisite was missing; plan should surface it earlier".
 * 4. Successful mission with zero failed checkpoints → reinforce the decomposition shape.
 */
export function deriveHeuristics(snapshot: MissionOutcomeSnapshot): DerivedHeuristic[] {
	const out: DerivedHeuristic[] = [];
	const ref = (checkpoint: MissionTaskAttemptCheckpoint) => `checkpoint://${checkpoint.id}`;
	const missionRef = `mission://${snapshot.missionId}`;

	// 1. Repeated contract failures per agent+role.
	const failuresByActor = new Map<string, MissionTaskAttemptCheckpoint[]>();
	for (const checkpoint of snapshot.checkpoints) {
		if (checkpoint.status !== "failed" || checkpoint.lastVerdict !== "fail") continue;
		const key = `${checkpoint.agent}:${checkpoint.role}`;
		const group = failuresByActor.get(key) ?? [];
		group.push(checkpoint);
		failuresByActor.set(key, group);
	}
	for (const [actor, group] of failuresByActor) {
		if (group.length < 2) continue;
		out.push({
			claim: `Agent "${actor}" failed contract verification ${group.length}x on objective like "${truncate(snapshot.objective)}" — decompose into smaller steps with narrower file scope for similar work.`,
			sourceRefs: [missionRef, ...group.map(ref)],
			confidence: "medium",
		});
	}

	// 2. Uncertainty escalations.
	const uncertain = snapshot.checkpoints.filter(
		checkpoint => checkpoint.lastVerdict === "uncertain" && checkpoint.status === "escalated",
	);
	if (uncertain.length > 0) {
		out.push({
			claim: `Objective like "${truncate(snapshot.objective)}" produced ${uncertain.length} uncertain contract verdicts — success criteria must be stated as independently checkable observations.`,
			sourceRefs: [missionRef, ...uncertain.map(ref)],
			confidence: "medium",
		});
	}

	// 3. Blocked prerequisites.
	const blocked = snapshot.checkpoints.filter(checkpoint => checkpoint.status === "blocked");
	if (blocked.length > 0) {
		out.push({
			claim: `Objective like "${truncate(snapshot.objective)}" hit ${blocked.length} blocked attempt(s) — plans for similar work should verify prerequisites as an explicit first step.`,
			sourceRefs: [missionRef, ...blocked.map(ref)],
			confidence: "low",
		});
	}

	// 4. Clean success reinforcement.
	const failedCount = snapshot.checkpoints.filter(checkpoint => checkpoint.status === "failed").length;
	if (snapshot.status === "success" && snapshot.verificationVerdict === "pass" && failedCount === 0) {
		out.push({
			claim: `Objective like "${truncate(snapshot.objective)}" completed with verified pass and zero failed attempts — its decomposition shape is a good template for similar work.`,
			sourceRefs: [missionRef],
			confidence: "low",
		});
	}

	return out;
}

function truncate(text: string, max = 120): string {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export interface LearnResult {
	recorded: KnowledgeItem[];
	skippedDuplicates: number;
}

/**
 * Derive and persist heuristics for a finished mission. Duplicate claims
 * (normalized text already active at global scope) are skipped so repeated
 * learning passes are idempotent.
 */
export function learnFromMission(snapshot: MissionOutcomeSnapshot, knowledge: KnowledgeStore): LearnResult {
	const recorded: KnowledgeItem[] = [];
	let skippedDuplicates = 0;
	for (const heuristic of deriveHeuristics(snapshot)) {
		const existing = knowledge.query({ scope: "global", claimLike: heuristic.claim.slice(0, 80) });
		if (existing.some(item => item.claim === heuristic.claim)) {
			skippedDuplicates++;
			continue;
		}
		recorded.push(
			knowledge.record({
				scope: "global",
				claim: heuristic.claim,
				sourceRefs: heuristic.sourceRefs,
				confidence: heuristic.confidence,
				filePath: null,
				contentHash: null,
				supersedes: null,
			}),
		);
	}
	return { recorded, skippedDuplicates };
}

/**
 * Retrieve active learned heuristics for planner context injection. Most
 * recently updated first, bounded so the planning prompt stays small.
 */
export function heuristicsForPlanning(knowledge: KnowledgeStore, limit = 8): string[] {
	return knowledge.query({ scope: "global", activeOnly: true, limit }).map(item => item.claim);
}
