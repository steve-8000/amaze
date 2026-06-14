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
import type { OkfStore } from "../okf/store";
import type { OkfDocument } from "../okf/types";

/** Per-tool failure tally harvested from the durable runtime-action log. */
export interface ToolFailureTally {
	tool: string;
	count: number;
}

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
	/** Tool failures harvested from the runtime-action log (Step-3 tool_action events). */
	toolFailures?: ToolFailureTally[];
	/** Count of runtime-level error events (blocked/failed runtime actions) for this mission. */
	runtimeErrorCount?: number;
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
	// 5. Repeated tool failures → avoidance heuristic. A tool that errored multiple
	// times in one mission is a recurring hazard worth surfacing to future planning.
	for (const failure of snapshot.toolFailures ?? []) {
		if (failure.count < 2) continue;
		out.push({
			claim: `Tool "${failure.tool}" failed ${failure.count}x on objective like "${truncate(snapshot.objective)}" — prefer an alternative approach or verify its preconditions before relying on it for similar work.`,
			sourceRefs: [missionRef],
			confidence: "medium",
		});
	}

	// 6. Runtime errors on a non-successful mission → surface as a recurring runtime hazard.
	if ((snapshot.runtimeErrorCount ?? 0) > 0 && snapshot.status !== "success") {
		out.push({
			claim: `Objective like "${truncate(snapshot.objective)}" hit ${snapshot.runtimeErrorCount} runtime error(s) before ending ${snapshot.status} — add a guarded precondition/health check step for similar work.`,
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

export type LearnerMemoryItem = KnowledgeItem | OkfDocument;

export interface LearnerMemory {
	query(input: {
		scope: "global" | "mission";
		claimLike?: string;
		activeOnly?: boolean;
		limit?: number;
	}): LearnerMemoryItem[];
	record(input: {
		scope: "global" | "mission";
		claim: string;
		sourceRefs: string[];
		confidence: "low" | "medium" | "high";
		filePath: null;
		contentHash: null;
		supersedes: null;
	}): LearnerMemoryItem;
}

export interface LearnResult {
	recorded: LearnerMemoryItem[];
	skippedDuplicates: number;
}

/**
 * Derive and persist heuristics for a finished mission. Duplicate claims
 * (normalized text already active at global scope) are skipped so repeated
 * learning passes are idempotent.
 */
export function learnFromMission(
	snapshot: MissionOutcomeSnapshot,
	knowledge: KnowledgeStore | OkfStore | LearnerMemory,
): LearnResult {
	const recorded: LearnerMemoryItem[] = [];
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
export function heuristicsForPlanning(knowledge: KnowledgeStore | OkfStore | LearnerMemory, limit = 8): string[] {
	return knowledge.query({ scope: "global", activeOnly: true, limit }).map(item => item.claim);
}

/**
 * One durable episode summarizing a finished mission — the L3 "episodic" layer.
 * Distinct from a {@link DerivedHeuristic} (a generalized strategic lesson at L5
 * global scope): an episode is the concrete what-happened record of a single
 * mission, stored at `mission` scope so it never leaks into
 * {@link heuristicsForPlanning} (which reads global) yet remains queryable for
 * cross-mission recall via {@link episodesForObjective}.
 */
export interface EpisodeRecord {
	/** Stable, mission-keyed claim text. Carries a `[mission:<id>]` marker for dedup. */
	claim: string;
	sourceRefs: string[];
	confidence: "low" | "medium" | "high";
}

// Episodes use the same `KnowledgeStore | OkfStore | LearnerMemory` seam as
// heuristics; `LearnerMemory` now accepts `mission` scope (see above), so the
// disabled stub no-ops and the real stores persist.

/** Stable per-mission marker embedded in an episode claim so re-learning is idempotent. */
export function episodeMarker(missionId: string): string {
	return `[mission:${missionId}]`;
}

/**
 * Build the single episode record for a finished mission. Pure and deterministic.
 * The claim captures terminal status, verification verdict, and checkpoint tallies
 * so a later recall conveys the shape of what happened without re-reading the store.
 */
export function deriveEpisode(snapshot: MissionOutcomeSnapshot): EpisodeRecord {
	const failed = snapshot.checkpoints.filter(c => c.status === "failed").length;
	const blocked = snapshot.checkpoints.filter(c => c.status === "blocked").length;
	const verdict = snapshot.verificationVerdict ?? "none";
	const claim = `EPISODE ${episodeMarker(snapshot.missionId)} status=${snapshot.status} verdict=${verdict}: "${truncate(snapshot.objective)}" — ${snapshot.checkpoints.length} checkpoint(s), ${failed} failed, ${blocked} blocked.`;
	const confidence: EpisodeRecord["confidence"] = snapshot.status === "success" ? "high" : "medium";
	return { claim, sourceRefs: [`mission://${snapshot.missionId}`], confidence };
}

/**
 * Persist a finished mission's episode at `mission` scope. Idempotent: an episode
 * already recorded for the same mission id (detected via the `[mission:<id>]`
 * marker) is skipped, so repeated terminal passes do not duplicate.
 */
export function recordEpisode(
	snapshot: MissionOutcomeSnapshot,
	knowledge: KnowledgeStore | OkfStore | LearnerMemory,
): LearnerMemoryItem | undefined {
	const episode = deriveEpisode(snapshot);
	const marker = episodeMarker(snapshot.missionId);
	const existing = knowledge.query({ scope: "mission", claimLike: marker });
	if (existing.some(item => item.claim.includes(marker))) return undefined;
	return knowledge.record({
		scope: "mission",
		claim: episode.claim,
		sourceRefs: episode.sourceRefs,
		confidence: episode.confidence,
		filePath: null,
		contentHash: null,
		supersedes: null,
	});
}

/**
 * Recall past mission episodes whose objective resembles `objectiveLike`. Most
 * recently updated first, bounded for prompt budget. Returns the episode claims.
 */
export function episodesForObjective(
	knowledge: KnowledgeStore | OkfStore | LearnerMemory,
	objectiveLike: string,
	limit = 5,
): string[] {
	const trimmed = objectiveLike.trim().slice(0, 80);
	// Over-fetch, then filter to episode records, then bound: this keeps the result
	// at `limit` episodes even if other item kinds are later added at mission scope
	// (filtering before the limit would otherwise under-return).
	return knowledge
		.query({
			scope: "mission",
			claimLike: trimmed.length > 0 ? trimmed : undefined,
			activeOnly: true,
			limit: Math.max(1, limit) * 4,
		})
		.filter(item => item.claim.startsWith("EPISODE "))
		.slice(0, Math.max(1, limit))
		.map(item => item.claim);
}
