import { randomBytes } from "node:crypto";
import type { KnowledgeStore } from "../memory/knowledge-store";
import type { KnowledgeScope, KnowledgeItem as LocalKnowledgeItem } from "../memory/types";
import type { AgiMemory, MemoryItem, MemoryLevel, MemorySourceRef, WorldClaimLink } from "./memory";

const LEVEL_TO_SCOPE: Partial<Record<MemoryLevel, KnowledgeScope>> = {
	L1: "session",
	L2: "mission",
	L3: "repo",
	L4: "client",
	L5: "global",
};

const SCOPE_TO_LEVEL: Record<KnowledgeScope, MemoryLevel> = {
	session: "L1",
	mission: "L2",
	repo: "L3",
	client: "L4",
	global: "L5",
};

export class LocalAgiMemory implements AgiMemory {
	readonly #store: KnowledgeStore;
	readonly #links: WorldClaimLink[] = [];
	readonly #now: () => number;

	constructor(input: { store: KnowledgeStore; now?: () => number }) {
		this.#store = input.store;
		this.#now = input.now ?? Date.now;
	}

	async query(input: {
		levels: MemoryLevel[];
		scope: MemoryItem["scope"];
		tags?: string[];
		claimLike?: string;
		limit: number;
	}): Promise<MemoryItem[]> {
		const items: MemoryItem[] = [];
		for (const level of input.levels) {
			const scope = LEVEL_TO_SCOPE[level];
			if (!scope) continue;
			const rows = this.#store.query({ scope, claimLike: input.claimLike, activeOnly: true, limit: input.limit });
			for (const row of rows) {
				const item = fromLocalKnowledge(row);
				if (item.expiresAt !== undefined && item.expiresAt <= this.#now()) continue;
				if (!matchesScope(item, input.scope)) continue;
				items.push(item);
				if (items.length >= input.limit) return items;
			}
		}
		return items;
	}

	async record(item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<MemoryItem> {
		if (item.sourceRefs.length === 0) throw new Error("AgiMemory item requires at least one source ref");
		const scope = LEVEL_TO_SCOPE[item.level];
		if (!scope) throw new Error(`LocalAgiMemory cannot record ${item.level}`);
		const recorded = this.#store.record({
			scope,
			claim: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
			sourceRefs: item.sourceRefs.map(sourceRefToString),
			confidence: item.confidence,
			filePath: item.scope.workspace ?? null,
			contentHash: firstContentHash(item.sourceRefs),
			supersedes: item.supersedes?.[0] ?? null,
		});
		return fromLocalKnowledge(recorded, item);
	}

	async linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void> {
		if (input.evidenceRefs.length === 0) throw new Error("Claim link requires evidence refs");
		this.#links.push({
			id: `claim-link-${this.#now()}-${randomBytes(4).toString("hex")}`,
			createdAt: this.#now(),
			...input,
		});
	}
}

function fromLocalKnowledge(row: LocalKnowledgeItem, overlay?: Partial<MemoryItem>): MemoryItem {
	return {
		id: row.id,
		level: SCOPE_TO_LEVEL[row.scope],
		scope: overlay?.scope ?? { workspace: row.filePath ?? undefined },
		kind: overlay?.kind ?? "claim",
		content: overlay?.content ?? row.claim,
		sourceRefs: overlay?.sourceRefs ?? row.sourceRefs.map(stringToSourceRef),
		confidence: row.confidence,
		verified: overlay?.verified ?? row.confidence === "high",
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		expiresAt: overlay?.expiresAt,
		supersedes: row.supersedes ? [row.supersedes] : undefined,
	};
}

function matchesScope(item: MemoryItem, scope: MemoryItem["scope"]): boolean {
	if (scope.missionId && item.scope.missionId && scope.missionId !== item.scope.missionId) return false;
	if (scope.objectiveId && item.scope.objectiveId && scope.objectiveId !== item.scope.objectiveId) return false;
	if (scope.providerSourceId && item.scope.providerSourceId && scope.providerSourceId !== item.scope.providerSourceId)
		return false;
	return true;
}

function firstContentHash(sourceRefs: MemorySourceRef[]): string | null {
	return sourceRefs.find(ref => ref.contentHash)?.contentHash ?? null;
}

function sourceRefToString(ref: MemorySourceRef): string {
	return JSON.stringify(ref);
}

function stringToSourceRef(value: string): MemorySourceRef {
	try {
		const parsed = JSON.parse(value) as MemorySourceRef;
		if (parsed && typeof parsed.kind === "string" && typeof parsed.uri === "string") return parsed;
	} catch {}
	return { kind: "evidence", uri: value };
}
