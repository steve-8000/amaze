export type NexusScopeKind = "global" | "user" | "project" | "knowledge" | "failure" | "session";

export type NexusMemoryTarget = "memory" | "user" | "project" | "knowledge" | "failure";

export type NexusMemoryCategory = "failure" | "correction" | "insight" | "preference" | "convention" | "tool-quirk";

export type NexusMemoryType =
	| "preference"
	| "project_convention"
	| "failure"
	| "command"
	| "decision"
	| "architecture"
	| "workflow"
	| "tool_quirk"
	| "skill_candidate"
	| "imported"
	| "note";

export type NexusConfidence = "user_asserted" | "tool_verified" | "inferred" | "imported_unverified" | "hypothesis";

export type NexusStaleness = "fresh" | "needs_refresh" | "stale" | "unknown";

export type NexusMemoryStatus = "active" | "superseded" | "deleted" | "quarantined" | "pending";

export type NexusSourceKind =
	| "manual"
	| "rollout"
	| "online_turn"
	| "old_rockey"
	| "old_local"
	| "old_hindsight"
	| "ad_hoc"
	| "healing"
	| "dream";

export type NexusRelationKind =
	| "supports"
	| "contradicts"
	| "supersedes"
	| "duplicate_of"
	| "generalizes"
	| "specializes";

export interface NexusScope {
	id: string;
	kind: NexusScopeKind;
	key: string | null;
	displayName: string;
	cwd: string | null;
	gitOrigin: string | null;
	repoRoot: string | null;
}

export interface NexusMemoryEntry {
	id: string;
	scopeId: string;
	scopeKind: NexusScopeKind;
	scopeKey: string | null;
	displayName: string;
	cwd: string | null;
	gitOrigin: string | null;
	target: NexusMemoryTarget;
	category: NexusMemoryCategory | null;
	memoryType: NexusMemoryType;
	content: string;
	provenance: string;
	confidence: NexusConfidence;
	staleness: NexusStaleness;
	status: NexusMemoryStatus;
	usageCount: number;
	lastUsedAt: string | null;
	lastVerifiedAt: string | null;
	validFrom: string | null;
	validTo: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface NexusSearchInput {
	query: string;
	scope?: "current_project" | "global" | "knowledge" | "failure" | "session" | "all";
	target?: "memory" | "user" | "failure";
	category?: NexusMemoryCategory;
	limit?: number;
	includeHistory?: boolean;
	/**
	 * Current user goal/task. When supplied, recall results are re-ranked toward
	 * memories whose content overlaps the goal. This is deliberately a ranking
	 * signal, not a hard filter: goal-conditioned recall should still surface
	 * safety and user-preference memories that do not share task vocabulary.
	 */
	goal?: string;
	/**
	 * Optional dense embedding for the query. When supplied alongside FTS
	 * keyword matching, the store blends keyword recall with cosine similarity
	 * over indexed embeddings.
	 */
	queryVector?: Float32Array;
	/**
	 * Weight in [0, 1] for the vector signal in the blend. Defaults to 0.6 when
	 * a `queryVector` is supplied. Ignored otherwise.
	 */
	vectorWeight?: number;
}

export interface NexusMutationResult {
	success: boolean;
	error?: string;
	message?: string;
	entry?: NexusMemoryEntry;
	entries?: NexusMemoryEntry[];
	target?: NexusMemoryTarget;
}

export interface NexusCapabilities {
	llm: "disabled" | "configured" | "unavailable";
	embeddings: "disabled" | "configured" | "unavailable";
	vector: "disabled" | "configured" | "unavailable";
	reranker: "disabled" | "configured" | "unavailable";
	retrievalMode: "fts" | "hybrid";
	deterministicFallback: boolean;
}

export interface NexusDoctorResult {
	status: "PASS" | "WARN" | "FAIL";
	score: number;
	capabilities: NexusCapabilities;
	checks: Array<{ id: string; status: "PASS" | "WARN" | "FAIL"; message: string }>;
	stats: {
		active: number;
		superseded: number;
		quarantined: number;
		hypotheses: number;
		pendingJobs: number;
		unresolvedContradictions: number;
	};
}
