export type MemoryLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export interface MemorySourceRef {
	kind: "mission" | "task" | "tool" | "evidence" | "verifier" | "proposal" | "provider" | "human";
	uri: string;
	contentHash?: string;
	observedAt?: number;
}

export interface MemoryItem<T = unknown> {
	id: string;
	level: MemoryLevel;
	scope: { missionId?: string; objectiveId?: string; workspace?: string; providerSourceId?: string };
	kind: "observation" | "evidence" | "claim" | "heuristic" | "procedure" | "provider-context";
	content: T;
	sourceRefs: MemorySourceRef[];
	confidence: "low" | "medium" | "high";
	verified: boolean;
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
	supersedes?: string[];
}

export interface WorldClaim {
	id: string;
	missionId?: string;
	objectiveId?: string;
	kind: "repo_state" | "external_fact" | "action" | "outcome" | "hazard" | "procedure";
	claim: string;
	status: "unverified" | "verified" | "contradicted" | "superseded" | "expired";
	outcomeStatus?: "pass" | "fail" | "blocked" | "uncertain";
	confidence: "low" | "medium" | "high";
	sourceRefs: MemorySourceRef[];
	provider?: { name: "mission-store" | "okf" | "web" | "manual"; sourceId?: string };
	createdAt: number;
	verifiedAt?: number;
	expiresAt?: number;
}

export interface WorldClaimLink {
	id: string;
	fromClaimId: string;
	toClaimId: string;
	relation: "supports" | "contradicts" | "supersedes" | "derived_from" | "caused" | "blocks";
	evidenceRefs: MemorySourceRef[];
	createdAt: number;
}

export interface AgiMemory {
	query(input: {
		levels: MemoryLevel[];
		scope: MemoryItem["scope"];
		tags?: string[];
		claimLike?: string;
		limit: number;
	}): Promise<MemoryItem[]>;
	record(item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<MemoryItem>;
	linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void>;
}

export function isWorldClaimPlanningEligible(claim: WorldClaim, now: number): boolean {
	if (claim.status === "superseded" || claim.status === "expired") return false;
	if (claim.expiresAt !== undefined && claim.expiresAt <= now) return false;
	return claim.sourceRefs.length > 0;
}

export function eligibleWorldClaimsForPlanning(claims: readonly WorldClaim[], now: number): WorldClaim[] {
	return claims.filter(claim => isWorldClaimPlanningEligible(claim, now));
}
