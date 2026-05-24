/**
 * Mission ↔ memory bridge (workplan Lane J / §11, §15.5).
 *
 * Closes the "mission ↔ memory boundary" gap documented in
 * `docs/refactor/03-memory-call-sites.md §4`: recall today does not know which
 * mission it serves, and recalled text is not modelled as mission knowledge.
 *
 * The bridge is the READ side. On recall it:
 *   1. attaches a `missionId` to the read (so recall is mission-scoped), and
 *   2. surfaces each hit as a Lane D {@link MissionMemoryObject}, TAGGED at the
 *      recall authority floor — memory is *guidance*, never repo truth.
 *
 * It is deliberately storage-agnostic: it consumes a `recall` callback shaped
 * like {@link NexusStore.search} rather than importing the store, so wiring it
 * in is purely additive and opt-in. Default memory behaviour is unchanged: code
 * that does not construct a bridge sees no difference.
 */

import type { NexusMemoryEntry, NexusSearchInput } from "../../nexus/types";
import type { Authority, MissionMemoryObject, MissionMemoryType } from "../authority";
import { isMoreAuthoritative } from "../authority";

/**
 * Authority assigned to anything recalled from memory. Recall is guidance, so
 * it sits at the floor of the Lane D hierarchy (`historical_summary`) — strictly
 * below `repo_truth`, `instruction`, and `mission_evidence`. The exported
 * constant makes the "guidance, not authority" rule explicit and testable.
 *
 * (The workplan prose calls this level `guidance`; Lane D's concrete enum names
 * the floor `historical_summary`. They are the same rung — the lowest.)
 */
export const RECALL_AUTHORITY: Authority = "historical_summary";

/** Human-facing label for the recall authority, per workplan prose. */
export const RECALL_AUTHORITY_LABEL = "guidance" as const;

/** A recall function shaped like {@link NexusStore.search}. */
export type RecallFn = (input: NexusSearchInput) => NexusMemoryEntry[];

/** A recalled memory item, modelled as a Lane D mission memory object. */
export interface RecalledMemoryItem extends MissionMemoryObject {
	/** Always `RECALL_AUTHORITY` — recall is guidance, never repo truth. */
	authority: typeof RECALL_AUTHORITY;
}

/**
 * The recall surface attached to a mission context packet. Additive: callers
 * that never set this keep the existing packet shape and behaviour.
 */
export interface MissionMemoryRecall {
	missionId: string;
	query: string;
	/** Recalled items, highest-confidence first, each tagged guidance authority. */
	items: RecalledMemoryItem[];
	/** The authority every item carries (always the guidance floor). */
	authority: typeof RECALL_AUTHORITY;
}

export interface MissionMemoryBridgeOptions {
	/** Mission this bridge recalls for; attached to every read + item. */
	missionId: string;
	/** Recall implementation (e.g. `store.search.bind(store)`). */
	recall: RecallFn;
	/** Owning project, propagated onto recalled items when known. */
	projectId?: string;
	/** Owning session, propagated onto recalled items when known. */
	sessionId?: string;
}

export interface BridgeRecallInput {
	/** Free-text query (typically the user prompt / current goal). */
	query: string;
	/** Forwarded to the underlying recall; defaults to `current_project`. */
	scope?: NexusSearchInput["scope"];
	/** Forwarded to the underlying recall as a re-ranking signal. */
	goal?: string;
	/** Max items to surface. */
	limit?: number;
}

/**
 * Maps a Nexus confidence label to a numeric confidence in [0, 1] for the
 * mission memory object. Deterministic and behaviour-preserving — it does not
 * change recall ranking, only annotates the surfaced object.
 */
function confidenceToScore(confidence: NexusMemoryEntry["confidence"]): number {
	switch (confidence) {
		case "tool_verified":
			return 0.9;
		case "user_asserted":
			return 0.75;
		case "inferred":
			return 0.5;
		case "hypothesis":
			return 0.3;
		case "imported_unverified":
			return 0.2;
		default:
			return 0.5;
	}
}

/** Maps a Nexus memory type onto the Lane D {@link MissionMemoryType}. */
function toMissionMemoryType(entry: NexusMemoryEntry): MissionMemoryType {
	if (entry.target === "knowledge") return "repo_truth";
	switch (entry.memoryType) {
		case "decision":
			return "decision";
		case "preference":
		case "project_convention":
			return "instruction";
		default:
			return "summary";
	}
}

/**
 * The READ-side bridge. Construct one per mission, then call {@link recall}.
 * Pure aside from the injected recall callback; no storage coupling.
 */
export class MissionMemoryBridge {
	readonly missionId: string;
	readonly #recall: RecallFn;
	readonly #projectId?: string;
	readonly #sessionId?: string;

	constructor(options: MissionMemoryBridgeOptions) {
		this.missionId = options.missionId;
		this.#recall = options.recall;
		this.#projectId = options.projectId;
		this.#sessionId = options.sessionId;
	}

	/**
	 * Recall memory for this mission and surface it as guidance-authority
	 * mission memory objects. Returns an empty recall on any underlying failure
	 * so recall can never break the mission loop.
	 */
	recall(input: BridgeRecallInput): MissionMemoryRecall {
		const query = input.query.trim();
		const empty: MissionMemoryRecall = {
			missionId: this.missionId,
			query,
			items: [],
			authority: RECALL_AUTHORITY,
		};
		if (!query) return empty;
		let entries: NexusMemoryEntry[];
		try {
			entries = this.#recall({
				query,
				goal: input.goal,
				scope: input.scope ?? "current_project",
				limit: input.limit,
			});
		} catch {
			return empty;
		}
		return {
			missionId: this.missionId,
			query,
			authority: RECALL_AUTHORITY,
			items: entries.map(entry => this.#toItem(entry)),
		};
	}

	#toItem(entry: NexusMemoryEntry): RecalledMemoryItem {
		return {
			id: entry.id,
			missionId: this.missionId,
			projectId: this.#projectId,
			sessionId: this.#sessionId,
			type: toMissionMemoryType(entry),
			// Recall is guidance, full stop — never promoted to repo truth here.
			authority: RECALL_AUTHORITY,
			content: entry.content,
			confidence: confidenceToScore(entry.confidence),
			sourceEvidenceRefs: [entry.id],
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
		};
	}
}

/**
 * Guard helper for callers: returns true when `repoTruth` (or any non-recall
 * authority) must win over recalled guidance. Encodes the §11 invariant that
 * recall never overrides repo truth.
 */
export function recallDefersTo(other: Authority): boolean {
	return isMoreAuthoritative(other, RECALL_AUTHORITY);
}
