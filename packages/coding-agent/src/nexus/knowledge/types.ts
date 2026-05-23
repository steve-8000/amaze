export type NexusKnowledgeDocumentKind = "code" | "text";

export type NexusKnowledgeSymbolKind =
	| "function"
	| "class"
	| "const"
	| "let"
	| "var"
	| "type"
	| "interface"
	| "method"
	| "alias";

export type NexusKnowledgeMatchKind = "fts" | "path" | "symbol" | "mixed";

export interface NexusKnowledgeDocument {
	id: string;
	repoRoot: string;
	path: string;
	absolutePath: string;
	kind: NexusKnowledgeDocumentKind;
	language: string | null;
	contentHash: string;
	sizeBytes: number;
	indexedAt: string;
	updatedAt: string;
}

export interface NexusKnowledgeChunk {
	id: string;
	documentId: string;
	path: string;
	chunkIndex: number;
	startLine: number;
	endLine: number;
	content: string;
	contentHash: string;
}

export interface NexusKnowledgeSymbol {
	id: string;
	documentId: string;
	path: string;
	name: string;
	kind: NexusKnowledgeSymbolKind;
	exported: boolean;
	line: number;
	endLine: number | null;
	column: number;
	signature: string;
	parentSymbol: string | null;
}

export interface NexusKnowledgeUpsertDocumentInput {
	repoRoot: string;
	path: string;
	absolutePath: string;
	kind: NexusKnowledgeDocumentKind;
	language?: string | null;
	contentHash: string;
	sizeBytes: number;
	chunks: Omit<NexusKnowledgeChunk, "id" | "documentId" | "path">[];
	symbols: Omit<NexusKnowledgeSymbol, "id" | "documentId" | "path">[];
}

export interface NexusKnowledgeSearchInput {
	query: string;
	repoRoot?: string;
	pathPrefix?: string;
	limit?: number;
}

export interface NexusKnowledgeSearchResult {
	document: NexusKnowledgeDocument;
	chunk: NexusKnowledgeChunk;
	score: number;
	matchKind: NexusKnowledgeMatchKind;
	diagnostics: string[];
}

export interface NexusKnowledgeCodeQuery {
	name: string;
	repoRoot?: string;
	path?: string;
	limit?: number;
}

export interface NexusKnowledgeReference {
	document: NexusKnowledgeDocument;
	path: string;
	line: number;
	column: number;
	snippet: string;
	definition: NexusKnowledgeSymbol | null;
	kind: "definition" | "reference";
	chunkIndex: number;
	chunkStartLine: number;
	chunkEndLine: number;
}

export interface NexusKnowledgeCaller {
	caller: NexusKnowledgeSymbol | null;
	reference: NexusKnowledgeReference;
}

export interface NexusKnowledgeCallee {
	callee: NexusKnowledgeSymbol | null;
	name: string;
	line: number;
	column: number;
	snippet: string;
}

export interface NexusKnowledgeIndexOptions {
	agentDir: string;
	cwd: string;
	repoRoot?: string;
	maxFiles?: number;
	maxFileBytes?: number;
	chunkMaxLines?: number;
	chunkMaxChars?: number;
}

export interface NexusKnowledgeIndexStats {
	repoRoot: string;
	discoveredFiles: number;
	indexedFiles: number;
	skippedFiles: number;
	unchangedFiles: number;
	prunedFiles: number;
	readErrors: number;
	chunks: number;
	symbols: number;
}
