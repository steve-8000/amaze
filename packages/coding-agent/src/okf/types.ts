import type { KnowledgeConfidence, KnowledgeScope } from "../memory/types";

export type OkfSourceRefKind = "mission" | "task" | "tool" | "evidence" | "verifier" | "proposal" | "provider" | "human" | "file" | "url";

export interface OkfSourceRef {
	kind: OkfSourceRefKind;
	uri: string;
	contentHash?: string;
	observedAt?: number;
}

export interface OkfDocument {
	id: string;
	scope: KnowledgeScope;
	claim: string;
	sourceRefs: OkfSourceRef[];
	confidence: KnowledgeConfidence;
	filePath: string | null;
	contentHash: string | null;
	supersedes: string | null;
	supersededBy: string | null;
	staleAt: number | null;
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

export type NewOkfDocument = Omit<OkfDocument, "id" | "sourceRefs" | "createdAt" | "updatedAt" | "supersededBy" | "staleAt" | "tags"> & {
	id?: string;
	sourceRefs: OkfSourceRef[] | string[];
	staleAt?: number | null;
	tags?: string[];
};

export interface OkfQuery {
	scope?: KnowledgeScope;
	claimLike?: string;
	filePath?: string;
	tags?: string[];
	activeOnly?: boolean;
	limit?: number;
}
