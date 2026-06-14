import type { OkfStore } from "./store";
import type { OkfDocument, OkfQuery } from "./types";

export interface OkfSearchResult {
	document: OkfDocument;
	score: number;
}

export function searchOkf(store: OkfStore, query: OkfQuery): OkfSearchResult[] {
	const terms = tokenize([query.claimLike, ...(query.tags ?? [])].filter(Boolean).join(" "));
	return store
		.query({ ...query, claimLike: undefined })
		.map(document => ({ document, score: scoreDocument(document, terms) }))
		.filter(result => terms.length === 0 || result.score > 0)
		.sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)
		.slice(0, Math.max(1, Math.trunc(query.limit ?? 100)));
}

function scoreDocument(document: OkfDocument, terms: string[]): number {
	if (terms.length === 0) return 1;
	const haystack = tokenize([document.claim, document.filePath ?? "", ...document.tags].join(" "));
	let score = 0;
	for (const term of terms) {
		if (haystack.includes(term)) score += 2;
		else if (haystack.some(candidate => candidate.includes(term))) score += 1;
	}
	return score;
}

function tokenize(text: string): string[] {
	return text.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
}
