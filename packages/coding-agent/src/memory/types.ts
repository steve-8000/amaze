/**
 * Knowledge plane types — the L1–L5 memory layering documented in the AGI
 * transition design:
 *
 * - L1 `session`  — current-session scratch facts (TTL: session end)
 * - L2 `mission`  — mission/research evidence and decisions (TTL: mission)
 * - L3 `repo`     — durable repo facts anchored to file content hashes
 * - L4 `client`   — client/agency memory (GBrain-backed, mirrored locally)
 * - L5 `global`   — reviewed reusable heuristics/workflows
 *
 * The local {@link KnowledgeStore} persists L1–L3 (and local mirrors of L4/L5).
 * Every item must carry provenance (`sourceRefs`) and repo-anchored items carry
 * a `contentHash` so staleness is detectable instead of silently trusted.
 */

export const KNOWLEDGE_SCOPES = ["session", "mission", "repo", "client", "global"] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_CONFIDENCES = ["low", "medium", "high"] as const;
export type KnowledgeConfidence = (typeof KNOWLEDGE_CONFIDENCES)[number];

export interface KnowledgeItem {
	id: string;
	scope: KnowledgeScope;
	/** The durable claim, stated as a verifiable sentence. */
	claim: string;
	/** Provenance: file paths, URLs, evidence-card ids, mission ids. Never empty. */
	sourceRefs: string[];
	confidence: KnowledgeConfidence;
	/** Repo-anchored items: workspace-relative file path backing the claim. */
	filePath: string | null;
	/** SHA-256 hex of the backing file content at record time (repo scope). */
	contentHash: string | null;
	/** Id of the item this one supersedes (revision chain). */
	supersedes: string | null;
	/** Set when a newer item superseded this one. */
	supersededBy: string | null;
	/** Set when staleness was detected (backing file changed). Stale items must not be cited. */
	staleAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export type NewKnowledgeItem = Omit<KnowledgeItem, "id" | "createdAt" | "updatedAt" | "supersededBy" | "staleAt"> & {
	id?: string;
};

export interface KnowledgeQuery {
	scope?: KnowledgeScope;
	/** Substring match against claim text. */
	claimLike?: string;
	filePath?: string;
	/** Default true: exclude superseded and stale items. */
	activeOnly?: boolean;
	limit?: number;
}
