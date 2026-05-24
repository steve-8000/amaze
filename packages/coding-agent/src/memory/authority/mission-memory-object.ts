/**
 * Mission memory object shape (workplan §11.2).
 *
 * Pure type only. This is the canonical in-memory representation a mission
 * carries for a unit of recalled/curated knowledge. It is deliberately
 * storage-agnostic: no persistence, no nexus/memory-backend coupling. Field
 * naming follows existing conventions (camelCase, ISO-8601 string timestamps)
 * so a future bridge can map to/from {@link NexusMemoryEntry} without churn.
 */

import type { Authority } from "./authority-hierarchy";

/**
 * Kind of knowledge a mission memory object holds. Distinct from {@link Authority}
 * (which is *how much it counts*); `type` is *what it is*.
 */
export type MissionMemoryType = "instruction" | "repo_truth" | "evidence" | "decision" | "durable_memory" | "summary";

/**
 * A single mission memory object: a piece of content with a known authority,
 * confidence, and provenance back to the event/evidence that produced it.
 */
export interface MissionMemoryObject {
	/** Stable identifier for this object. */
	id: string;
	/** Owning mission, when scoped to one. */
	missionId?: string;
	/** Owning project, when scoped to one. */
	projectId?: string;
	/** Owning session, when scoped to one. */
	sessionId?: string;
	/** What kind of knowledge this is. */
	type: MissionMemoryType;
	/** How authoritative this object is relative to others. */
	authority: Authority;
	/** Human-readable content of the memory. */
	content: string;
	/** Confidence in the content, in the closed interval [0, 1]. */
	confidence: number;
	/** Event id that produced this object, when traceable. */
	sourceEventId?: string;
	/** Evidence references (e.g. tool-result ids) backing this object. */
	sourceEvidenceRefs: string[];
	/** ISO-8601 creation timestamp. */
	createdAt: string;
	/** ISO-8601 last-update timestamp. */
	updatedAt: string;
}
