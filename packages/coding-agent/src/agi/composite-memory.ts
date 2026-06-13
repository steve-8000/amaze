import type { AgiMemory, MemoryItem, MemoryLevel, MemorySourceRef, WorldClaimLink } from "./memory";

export class CompositeAgiMemory implements AgiMemory {
	readonly #memories: AgiMemory[];

	constructor(memories: AgiMemory[]) {
		this.#memories = memories;
	}

	async query(input: {
		levels: MemoryLevel[];
		scope: MemoryItem["scope"];
		tags?: string[];
		claimLike?: string;
		limit: number;
	}): Promise<MemoryItem[]> {
		const seen = new Set<string>();
		const out: MemoryItem[] = [];
		for (const memory of this.#memories) {
			const items = await memory.query({ ...input, limit: input.limit });
			for (const item of items) {
				if (!hasPlanningAuthority(item)) continue;
				if (seen.has(item.id)) continue;
				seen.add(item.id);
				out.push(item);
				if (out.length >= input.limit) return out;
			}
		}
		return out;
	}

	async record(item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<MemoryItem> {
		if (!this.#memories[0]) throw new Error("CompositeAgiMemory requires at least one backend");
		return this.#memories[0].record(item);
	}

	async linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void> {
		await Promise.all(this.#memories.map(memory => memory.linkClaims(input)));
	}
}

export function hasPlanningAuthority(item: MemoryItem, now = Date.now()): boolean {
	if (item.sourceRefs.length === 0) return false;
	if (item.expiresAt !== undefined && item.expiresAt <= now) return false;
	if (item.kind === "provider-context") return false;
	if (item.level === "L6") return false;
	if (item.level === "L4" || item.level === "L5") {
		return item.verified && item.confidence !== "low" && item.sourceRefs.every(hasUsableProvenance);
	}
	return item.sourceRefs.every(hasUsableProvenance);
}

function hasUsableProvenance(ref: MemorySourceRef): boolean {
	return (
		ref.uri.length > 0 && (ref.contentHash !== undefined || ref.observedAt !== undefined || ref.kind !== "provider")
	);
}
