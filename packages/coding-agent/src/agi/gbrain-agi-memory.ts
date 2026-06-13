import type { AgiMemory, MemoryItem, MemoryLevel, MemorySourceRef, WorldClaimLink } from "./memory";

export interface GbrainResult {
	id: string;
	text: string;
	sourceId: string;
	uri?: string;
	contentHash?: string;
	observedAt?: number;
	confidence?: "low" | "medium" | "high";
}

export interface GbrainClient {
	query(input: { query: string; sourceId: string; limit: number }): Promise<GbrainResult[]>;
}

export class GbrainAgiMemory implements AgiMemory {
	readonly #client: GbrainClient;
	readonly #sourceId: string;
	readonly #now: () => number;

	constructor(input: { client: GbrainClient; sourceId: string; now?: () => number }) {
		this.#client = input.client;
		this.#sourceId = input.sourceId;
		this.#now = input.now ?? Date.now;
	}

	async query(input: {
		levels: MemoryLevel[];
		scope: MemoryItem["scope"];
		tags?: string[];
		claimLike?: string;
		limit: number;
	}): Promise<MemoryItem[]> {
		if (!input.levels.includes("L4") && !input.levels.includes("L5")) return [];
		const results = await this.#client.query({
			query: input.claimLike ?? "",
			sourceId: this.#sourceId,
			limit: input.limit,
		});
		return results.flatMap(result => {
			const ref = toSourceRef(result);
			if (!ref) return [];
			return [
				{
					id: result.id,
					level: "L4" as const,
					scope: { ...input.scope, providerSourceId: result.sourceId },
					kind: "claim" as const,
					content: result.text,
					sourceRefs: [ref],
					confidence: result.confidence ?? "medium",
					verified: true,
					createdAt: result.observedAt ?? this.#now(),
					updatedAt: result.observedAt ?? this.#now(),
				},
			];
		});
	}

	async record(): Promise<MemoryItem> {
		throw new Error("GbrainAgiMemory is read-only; writes require a human-approved memory curation proposal");
	}

	async linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void> {
		if (input.evidenceRefs.length === 0) throw new Error("Claim link requires evidence refs");
	}
}

function toSourceRef(result: GbrainResult): MemorySourceRef | undefined {
	if (!result.uri) return undefined;
	if (!result.contentHash && !result.observedAt) return undefined;
	return {
		kind: "provider",
		uri: result.uri,
		contentHash: result.contentHash,
		observedAt: result.observedAt,
	};
}
