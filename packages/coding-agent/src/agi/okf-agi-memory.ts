import type { KnowledgeScope } from "../memory/types";
import { searchOkf } from "../okf/search";
import type { OkfStore } from "../okf/store";
import type { OkfDocument, OkfSourceRef } from "../okf/types";
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

export class OkfAgiMemory implements AgiMemory {
	readonly #store: OkfStore;
	readonly #links: WorldClaimLink[] = [];
	readonly #now: () => number;

	constructor(input: { store: OkfStore; now?: () => number }) {
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
			const results = searchOkf(this.#store, {
				scope,
				claimLike: input.claimLike,
				tags: input.tags,
				activeOnly: true,
				limit: input.limit,
			});
			for (const result of results) {
				const item = fromOkfDocument(result.document, input.scope);
				if (!matchesScope(item, input.scope)) continue;
				items.push(item);
				if (items.length >= input.limit) return items;
			}
		}
		return items;
	}

	async record(item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<MemoryItem> {
		if (item.sourceRefs.length === 0) throw new Error("OKF memory item requires at least one source ref");
		const scope = LEVEL_TO_SCOPE[item.level];
		if (!scope) throw new Error(`OkfAgiMemory cannot record ${item.level}`);
		const document = this.#store.record({
			scope,
			claim: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
			sourceRefs: item.sourceRefs.map(toOkfSourceRef),
			confidence: item.confidence,
			filePath: item.scope.workspace ?? null,
			contentHash: firstContentHash(item.sourceRefs),
			supersedes: item.supersedes?.[0] ?? null,
			tags: [item.kind, item.level],
		});
		return fromOkfDocument(document, item.scope, item);
	}

	async linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void> {
		if (input.evidenceRefs.length === 0) throw new Error("Claim link requires evidence refs");
		this.#links.push({
			id: `okf-claim-link-${this.#now()}`,
			createdAt: this.#now(),
			...input,
		});
	}
}

function fromOkfDocument(document: OkfDocument, scope: MemoryItem["scope"], overlay?: Partial<MemoryItem>): MemoryItem {
	return {
		id: document.id,
		level: SCOPE_TO_LEVEL[document.scope],
		scope: overlay?.scope ?? { ...scope, workspace: document.filePath ?? scope.workspace },
		kind: overlay?.kind ?? "claim",
		content: overlay?.content ?? document.claim,
		sourceRefs: overlay?.sourceRefs ?? document.sourceRefs.map(fromOkfSourceRef),
		confidence: document.confidence,
		verified: overlay?.verified ?? document.confidence === "high",
		createdAt: document.createdAt,
		updatedAt: document.updatedAt,
		expiresAt: overlay?.expiresAt,
		supersedes: document.supersedes ? [document.supersedes] : undefined,
	};
}

function matchesScope(item: MemoryItem, scope: MemoryItem["scope"]): boolean {
	if (scope.missionId && item.scope.missionId && scope.missionId !== item.scope.missionId) return false;
	if (scope.objectiveId && item.scope.objectiveId && scope.objectiveId !== item.scope.objectiveId) return false;
	if (scope.providerSourceId && item.scope.providerSourceId && scope.providerSourceId !== item.scope.providerSourceId) return false;
	return true;
}

function firstContentHash(sourceRefs: MemorySourceRef[]): string | null {
	return sourceRefs.find(ref => ref.contentHash)?.contentHash ?? null;
}

function toOkfSourceRef(ref: MemorySourceRef): OkfSourceRef {
	return {
		kind: toOkfSourceRefKind(ref),
		uri: ref.uri,
		contentHash: ref.contentHash,
		observedAt: ref.observedAt,
	};
}

function toOkfSourceRefKind(ref: MemorySourceRef): OkfSourceRef["kind"] {
	if (ref.kind !== "evidence") return ref.kind;
	if (isUrlRef(ref.uri)) return "url";
	if (isFileRef(ref.uri)) return "file";
	return ref.kind;
}

function isUrlRef(uri: string): boolean {
	return /^https?:\/\//i.test(uri);
}

function isFileRef(uri: string): boolean {
	return uri.startsWith("file://") || uri.startsWith("./") || uri.startsWith("../") || uri.includes("/") || uri.includes("\\");
}

function fromOkfSourceRef(ref: OkfSourceRef): MemorySourceRef {
	return {
		kind: ref.kind === "file" || ref.kind === "url" ? "evidence" : ref.kind,
		uri: ref.uri,
		contentHash: ref.contentHash,
		observedAt: ref.observedAt,
	};
}
