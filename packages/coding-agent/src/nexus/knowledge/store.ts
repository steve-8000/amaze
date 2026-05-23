import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import { getNexusDbPath, openNexusDb } from "../store";
import type {
	NexusKnowledgeCallee,
	NexusKnowledgeCaller,
	NexusKnowledgeCodeQuery,
	NexusKnowledgeDocument,
	NexusKnowledgeMatchKind,
	NexusKnowledgeReference,
	NexusKnowledgeSearchInput,
	NexusKnowledgeSearchResult,
	NexusKnowledgeSymbol,
	NexusKnowledgeUpsertDocumentInput,
} from "./types";

export interface NexusKnowledgeStoreOptions {
	agentDir: string;
	cwd: string;
	dbPath?: string;
}

interface DocumentRow {
	id: string;
	repo_root: string;
	path: string;
	absolute_path: string;
	kind: NexusKnowledgeDocument["kind"];
	language: string | null;
	content_hash: string;
	size_bytes: number;
	indexed_at: string;
	updated_at: string;
}

interface ChunkRow {
	id: string;
	document_id: string;
	path: string;
	chunk_index: number;
	start_line: number;
	end_line: number;
	content: string;
	content_hash: string;
}

interface SymbolRow {
	id: string;
	document_id: string;
	path: string;
	name: string;
	kind: NexusKnowledgeSymbol["kind"];
	exported: number;
	line: number;
	end_line: number | null;
	column: number;
	signature: string;
	parent_symbol: string | null;
}

interface SearchRow extends DocumentRow {
	chunk_id: string;
	chunk_index: number;
	start_line: number;
	end_line: number;
	chunk_content: string;
	chunk_hash: string;
	score?: number;
}

interface ReferenceRow extends DocumentRow {
	chunk_id: string;
	chunk_index: number;
	start_line: number;
	end_line: number;
	chunk_content: string;
	chunk_hash: string;
}

interface QueryShape {
	raw: string;
	cleaned: string;
	fts: string;
	symbol: string | null;
	path: string | null;
	pathNeedle: string | null;
}

const DEFAULT_LIMIT = 20;
const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const CALL_PATTERN = new RegExp(`\\b(${IDENTIFIER})\\s*\\(`, "g");
const CALL_EXCLUDES = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "new", "super"]);

function hashText(text: string): string {
	return crypto.createHash("sha256").update(text).digest("hex");
}

function stableId(...parts: string[]): string {
	return hashText(parts.join("\0")).slice(0, 32);
}

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeLimit(limit: number | undefined): number {
	return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, 100));
}

function ftsQuery(query: string): string {
	const terms = query
		.trim()
		.split(/\s+/)
		.map(term => term.replace(/^['"`]+|['"`]+$/g, ""))
		.filter(Boolean)
		.map(term => `"${term.replaceAll('"', '""')}"`);
	return terms.join(" AND ");
}

function mapDocument(row: DocumentRow): NexusKnowledgeDocument {
	return {
		id: row.id,
		repoRoot: row.repo_root,
		path: row.path,
		absolutePath: row.absolute_path,
		kind: row.kind,
		language: row.language,
		contentHash: row.content_hash,
		sizeBytes: row.size_bytes,
		indexedAt: row.indexed_at,
		updatedAt: row.updated_at,
	};
}

function mapChunk(row: ChunkRow): NexusKnowledgeSearchResult["chunk"] {
	return {
		id: row.id,
		documentId: row.document_id,
		path: row.path,
		chunkIndex: row.chunk_index,
		startLine: row.start_line,
		endLine: row.end_line,
		content: row.content,
		contentHash: row.content_hash,
	};
}

function mapSymbol(row: SymbolRow): NexusKnowledgeSymbol {
	return {
		id: row.id,
		documentId: row.document_id,
		path: row.path,
		name: row.name,
		kind: row.kind,
		exported: row.exported === 1,
		line: row.line,
		endLine: row.end_line,
		column: row.column,
		signature: row.signature,
		parentSymbol: row.parent_symbol,
	};
}

function symbolFullName(symbol: Pick<NexusKnowledgeSymbol, "name" | "parentSymbol">): string {
	return symbol.parentSymbol ? `${symbol.parentSymbol}.${symbol.name}` : symbol.name;
}

export class NexusKnowledgeStore {
	readonly db: Database;
	readonly dbPath: string;
	readonly cwd: string;

	constructor(options: NexusKnowledgeStoreOptions) {
		this.cwd = options.cwd;
		this.dbPath = options.dbPath ?? getNexusDbPath(options.agentDir);
		this.db = openNexusDb(this.dbPath);
		this.ensureSchema();
	}

	close(): void {
		this.db.close();
	}

	upsertDocument(input: NexusKnowledgeUpsertDocumentInput): NexusKnowledgeDocument {
		const documentId = stableId(input.repoRoot, input.path);
		const indexedAt = nowIso();
		const existing = this.getDocument(documentId);
		if (existing && existing.contentHash === input.contentHash && existing.sizeBytes === input.sizeBytes) return existing;
		this.db.transaction(() => {
			const oldChunks = this.db.query<{ id: string }, [string]>("SELECT id FROM knowledge_chunks WHERE document_id = ?").all(documentId);
			for (const chunk of oldChunks) this.db.query("DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?").run(chunk.id);
			this.db.query("DELETE FROM knowledge_chunks WHERE document_id = ?").run(documentId);
			this.db.query("DELETE FROM knowledge_symbols WHERE document_id = ?").run(documentId);
			this.db
				.query(`
INSERT INTO knowledge_documents (
	id, repo_root, path, absolute_path, kind, language, content_hash, size_bytes, indexed_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	repo_root = excluded.repo_root,
	path = excluded.path,
	absolute_path = excluded.absolute_path,
	kind = excluded.kind,
	language = excluded.language,
	content_hash = excluded.content_hash,
	size_bytes = excluded.size_bytes,
	indexed_at = excluded.indexed_at,
	updated_at = excluded.updated_at
`)
				.run(
					documentId,
					input.repoRoot,
					input.path,
					input.absolutePath,
					input.kind,
					input.language ?? null,
					input.contentHash,
					input.sizeBytes,
					indexedAt,
					indexedAt,
				);
			for (const chunk of input.chunks) {
				const chunkId = stableId(documentId, String(chunk.chunkIndex), chunk.contentHash);
				this.db
					.query(`
INSERT INTO knowledge_chunks (id, document_id, path, chunk_index, start_line, end_line, content, content_hash)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
					.run(chunkId, documentId, input.path, chunk.chunkIndex, chunk.startLine, chunk.endLine, chunk.content, chunk.contentHash);
				this.db.query("INSERT INTO knowledge_chunks_fts (content, path, document_id, chunk_id) VALUES (?, ?, ?, ?)").run(chunk.content, input.path, documentId, chunkId);
			}
			for (const symbol of input.symbols) {
				this.db
					.query(`
INSERT INTO knowledge_symbols (id, document_id, path, name, kind, exported, line, end_line, column, signature, parent_symbol)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
					.run(
						stableId(documentId, symbol.parentSymbol ?? "", symbol.name, symbol.kind, String(symbol.line), String(symbol.column)),
						documentId,
						input.path,
						symbol.name,
						symbol.kind,
						symbol.exported ? 1 : 0,
						symbol.line,
						symbol.endLine,
						symbol.column,
						symbol.signature,
						symbol.parentSymbol ?? null,
					);
			}
		})();
		return this.getDocument(documentId) as NexusKnowledgeDocument;
	}

	search(input: NexusKnowledgeSearchInput): NexusKnowledgeSearchResult[] {
		const limit = normalizeLimit(input.limit);
		const shape = shapeSearchQuery(input.query);
		if (!shape.cleaned) return [];
		const aggregate = new Map<string, { row: SearchRow; score: number; sources: Set<NexusKnowledgeMatchKind>; diagnostics: Set<string> }>();
		const filters = buildSearchFilters(input);
		const ftsRows = shape.fts ? this.searchFtsRows(shape.fts, filters, limit * 4) : [];
		const pathRows = shape.pathNeedle ? this.searchPathRows(shape, filters, limit * 3) : [];
		const symbolRows = shape.symbol ? this.searchSymbolRows(shape, filters, limit * 3) : [];
		mergeRankedRows(aggregate, ftsRows, "fts", row => ftsDiagnostics(row, shape));
		mergeRankedRows(aggregate, pathRows, "path", row => pathDiagnostics(row, shape));
		mergeRankedRows(aggregate, symbolRows, "symbol", row => symbolDiagnostics(row, shape));
		const ranked = [...aggregate.values()]
			.map(entry => ({
				row: entry.row,
				score: entry.score,
				matchKind: collapseMatchKinds(entry.sources),
				diagnostics: [...entry.diagnostics],
			}))
			.sort((left, right) => right.score - left.score || left.row.path.localeCompare(right.row.path) || left.row.chunk_index - right.row.chunk_index)
			.slice(0, limit);
		return ranked.map(entry => ({
			document: mapDocument(entry.row),
			chunk: mapChunk({
				id: entry.row.chunk_id,
				document_id: entry.row.id,
				path: entry.row.path,
				chunk_index: entry.row.chunk_index,
				start_line: entry.row.start_line,
				end_line: entry.row.end_line,
				content: entry.row.chunk_content,
				content_hash: entry.row.chunk_hash,
			}),
			score: Number(entry.score.toFixed(6)),
			matchKind: entry.matchKind,
			diagnostics: entry.diagnostics,
		}));
	}

	codeDefinitions(input: NexusKnowledgeCodeQuery): NexusKnowledgeSymbol[] {
		const rows = this.querySymbols(input);
		return rows
			.map(mapSymbol)
			.map(symbol => ({ symbol, rank: symbolQueryRank(symbol, input.name) }))
			.filter(entry => entry.rank > 0)
			.sort((left, right) => right.rank - left.rank || Number(right.symbol.exported) - Number(left.symbol.exported) || left.symbol.path.localeCompare(right.symbol.path) || left.symbol.line - right.symbol.line)
			.slice(0, normalizeLimit(input.limit))
			.map(entry => entry.symbol);
	}

	codeReferences(input: NexusKnowledgeCodeQuery): NexusKnowledgeReference[] {
		const limit = normalizeLimit(input.limit);
		const symbolName = terminalSymbolName(input.name);
		const pattern = `%${symbolName}%`;
		const filters = ["c.content LIKE ?"];
		const params: (string | number)[] = [pattern];
		if (input.repoRoot) {
			filters.push("d.repo_root = ?");
			params.push(input.repoRoot);
		}
		if (input.path) {
			filters.push("d.path = ?");
			params.push(input.path);
		}
		const rows = this.db
			.query<ReferenceRow, (string | number)[]>(`
SELECT
	d.*, c.id AS chunk_id, c.chunk_index, c.start_line, c.end_line,
	c.content AS chunk_content, c.content_hash AS chunk_hash
FROM knowledge_chunks c
JOIN knowledge_documents d ON d.id = c.document_id
WHERE ${filters.join(" AND ")}
ORDER BY d.path, c.chunk_index
`)
			.all(...params);
		const definitionsByDocument = new Map<string, NexusKnowledgeSymbol[]>();
		const references: NexusKnowledgeReference[] = [];
		const namePattern = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`, "g");
		for (const row of rows) {
			const document = mapDocument(row);
			let definitions = definitionsByDocument.get(document.id);
			if (!definitions) {
				definitions = this.symbolsForDocument(document.id);
				definitionsByDocument.set(document.id, definitions);
			}
			const lines = row.chunk_content.split("\n");
			for (let offset = 0; offset < lines.length; offset++) {
				const snippet = lines[offset] ?? "";
				if (shouldSkipReferenceLine(snippet)) continue;
				namePattern.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = namePattern.exec(snippet)) !== null) {
					const line = row.start_line + offset;
					const column = match.index + 1;
					const definition = definitions.find(symbol => symbolQueryRank(symbol, input.name) > 0 && symbol.line === line) ?? null;
					if (definition && looksLikeDefinitionLine(snippet, symbolName)) continue;
					references.push({
						document,
						path: document.path,
						line,
						column,
						snippet,
						definition,
						kind: definition ? "definition" : "reference",
						chunkIndex: row.chunk_index,
						chunkStartLine: row.start_line,
						chunkEndLine: row.end_line,
					});
					if (references.length >= limit) return references;
				}
			}
		}
		return references;
	}

	codeCallers(input: NexusKnowledgeCodeQuery): NexusKnowledgeCaller[] {
		return this.codeReferences(input).map(reference => ({
			caller: this.enclosingSymbolAtLine(reference.document.id, reference.line, terminalSymbolName(input.name)),
			reference,
		}));
	}

	codeCallees(input: NexusKnowledgeCodeQuery): NexusKnowledgeCallee[] {
		const definition = this.codeDefinitions({ ...input, limit: 1 })[0];
		if (!definition) return [];
		const rangeEnd = definition.endLine ?? this.nextSymbolStartLine(definition.documentId, definition.line) ?? definition.line;
		const chunks = this.chunksForDocumentRange(definition.documentId, definition.line, rangeEnd);
		if (chunks.length === 0) return [];
		const knownSymbols = this.allSymbols(input.repoRoot);
		const knownSymbolNames = new Set(knownSymbols.map(symbol => symbol.name));
		const results: NexusKnowledgeCallee[] = [];
		const seen = new Set<string>();
		for (const chunk of chunks) {
			const lines = chunk.content.split("\n");
			for (let offset = 0; offset < lines.length; offset++) {
				const lineNumber = chunk.start_line + offset;
				if (lineNumber < definition.line || lineNumber > rangeEnd) continue;
				const snippet = lines[offset] ?? "";
				if (shouldSkipExecutableLine(snippet)) continue;
				CALL_PATTERN.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = CALL_PATTERN.exec(snippet)) !== null) {
					const name = match[1] ?? "";
					if (!name || name === definition.name || CALL_EXCLUDES.has(name) || !knownSymbolNames.has(name)) continue;
					if (match.index > 0 && snippet[match.index - 1] === ".") continue;
					const key = `${name}:${lineNumber}:${match.index}`;
					if (seen.has(key)) continue;
					seen.add(key);
					results.push({
						callee: this.codeDefinitions({ name, repoRoot: input.repoRoot, limit: 1 })[0] ?? null,
						name,
						line: lineNumber,
						column: match.index + 1,
						snippet,
					});
					if (results.length >= normalizeLimit(input.limit)) return results;
				}
			}
		}
		return results;
	}

	getDocument(id: string): NexusKnowledgeDocument | null {
		const row = this.db.query<DocumentRow, [string]>("SELECT * FROM knowledge_documents WHERE id = ?").get(id);
		return row ? mapDocument(row) : null;
	}

	getDocumentByRepoPath(repoRoot: string, repoPath: string): NexusKnowledgeDocument | null {
		const row = this.db.query<DocumentRow, [string, string]>("SELECT * FROM knowledge_documents WHERE repo_root = ? AND path = ?").get(repoRoot, repoPath);
		return row ? mapDocument(row) : null;
	}

	listDocumentPaths(repoRoot: string): string[] {
		return this.db.query<{ path: string }, [string]>("SELECT path FROM knowledge_documents WHERE repo_root = ? ORDER BY path").all(repoRoot).map(row => row.path);
	}

	deleteDocumentsByPath(repoRoot: string, repoPaths: string[]): number {
		if (repoPaths.length === 0) return 0;
		return this.db.transaction(() => {
			let deleted = 0;
			for (const repoPath of repoPaths) {
				const rows = this.db.query<{ id: string }, [string, string]>("SELECT id FROM knowledge_documents WHERE repo_root = ? AND path = ?").all(repoRoot, repoPath);
				for (const row of rows) {
					const chunkIds = this.db.query<{ id: string }, [string]>("SELECT id FROM knowledge_chunks WHERE document_id = ?").all(row.id);
					for (const chunk of chunkIds) this.db.query("DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?").run(chunk.id);
					this.db.query("DELETE FROM knowledge_documents WHERE id = ?").run(row.id);
					deleted++;
				}
			}
			return deleted;
		})();
	}

	knowledgeDoctorStats(repoRoot: string): { totalDocuments: number; repoDocuments: number; foreignDocuments: number; symbolsMissingEndLine: number; newestIndexedAt: string | null } {
		const totalDocuments = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM knowledge_documents").get()?.count ?? 0;
		const repoDocuments = this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM knowledge_documents WHERE repo_root = ?").get(repoRoot)?.count ?? 0;
		const foreignDocuments = this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM knowledge_documents WHERE repo_root != ?").get(repoRoot)?.count ?? 0;
		const symbolsMissingEndLine = this.db
			.query<{ count: number }, [string]>(`
SELECT COUNT(*) AS count
FROM knowledge_symbols s
JOIN knowledge_documents d ON d.id = s.document_id
WHERE d.repo_root = ? AND d.kind = 'code' AND s.end_line IS NULL
`)
			.get(repoRoot)?.count ?? 0;
		const newestIndexedAt = this.db
			.query<{ indexed_at: string | null }, [string]>("SELECT MAX(indexed_at) AS indexed_at FROM knowledge_documents WHERE repo_root = ?")
			.get(repoRoot)?.indexed_at ?? null;
		return { totalDocuments, repoDocuments, foreignDocuments, symbolsMissingEndLine, newestIndexedAt };
	}

	private ensureSchema(): void {
		this.db.exec(`
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS knowledge_documents (
	id TEXT PRIMARY KEY,
	repo_root TEXT NOT NULL,
	path TEXT NOT NULL,
	absolute_path TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('code', 'text')),
	language TEXT,
	content_hash TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	indexed_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(repo_root, path)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
	id TEXT PRIMARY KEY,
	document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	chunk_index INTEGER NOT NULL,
	start_line INTEGER NOT NULL,
	end_line INTEGER NOT NULL,
	content TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	UNIQUE(document_id, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
	content,
	path UNINDEXED,
	document_id UNINDEXED,
	chunk_id UNINDEXED,
	tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_symbols (
	id TEXT PRIMARY KEY,
	document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('function', 'class', 'const', 'let', 'var', 'type', 'interface', 'method', 'alias')),
	exported INTEGER NOT NULL CHECK (exported IN (0, 1)),
	line INTEGER NOT NULL,
	column INTEGER NOT NULL,
	signature TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_documents_repo_path_idx ON knowledge_documents(repo_root, path);
CREATE INDEX IF NOT EXISTS knowledge_chunks_document_idx ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS knowledge_symbols_name_idx ON knowledge_symbols(name);
CREATE INDEX IF NOT EXISTS knowledge_symbols_document_line_idx ON knowledge_symbols(document_id, line);
`);
		this.ensureColumn("knowledge_symbols", "end_line", "INTEGER");
		this.ensureColumn("knowledge_symbols", "parent_symbol", "TEXT");
	}

	private ensureColumn(table: string, column: string, definition: string): void {
		const rows = this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
		if (rows.some(row => row.name === column)) return;
		this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
	}

	private symbolsForDocument(documentId: string): NexusKnowledgeSymbol[] {
		return this.db.query<SymbolRow, [string]>("SELECT * FROM knowledge_symbols WHERE document_id = ? ORDER BY line, column").all(documentId).map(mapSymbol);
	}

	private allSymbols(repoRoot: string | undefined): NexusKnowledgeSymbol[] {
		if (repoRoot) {
			return this.db
				.query<SymbolRow, [string]>(`
SELECT s.* FROM knowledge_symbols s
JOIN knowledge_documents d ON d.id = s.document_id
WHERE d.repo_root = ?
ORDER BY s.path, s.line, s.column
`)
				.all(repoRoot)
				.map(mapSymbol);
		}
		return this.db.query<SymbolRow, []>("SELECT * FROM knowledge_symbols ORDER BY path, line, column").all().map(mapSymbol);
	}

	private enclosingSymbolAtLine(documentId: string, line: number, excludeName: string): NexusKnowledgeSymbol | null {
		const symbols = this.symbolsForDocument(documentId).filter(symbol => symbol.name !== excludeName && symbol.line <= line);
		for (let index = 0; index < symbols.length; index++) {
			const symbol = symbols[index]!;
			const next = symbols[index + 1] ?? null;
			if (symbol.line <= line && (!next || next.line > line)) return symbol;
		}
		return symbols[symbols.length - 1] ?? null;
	}

	private nextSymbolStartLine(documentId: string, line: number): number | null {
		const row = this.db.query<{ line: number }, [string, number]>(`
SELECT line FROM knowledge_symbols
WHERE document_id = ? AND line > ?
ORDER BY line
LIMIT 1
`).get(documentId, line);
		return row?.line ?? null;
	}

	private chunksForDocumentRange(documentId: string, startLine: number, endLine: number): ChunkRow[] {
		return this.db
			.query<ChunkRow, [string, number, number]>(`
SELECT * FROM knowledge_chunks
WHERE document_id = ? AND end_line >= ? AND start_line <= ?
ORDER BY chunk_index
`)
			.all(documentId, startLine, endLine);
	}

	private querySymbols(input: NexusKnowledgeCodeQuery): SymbolRow[] {
		const filters: string[] = [];
		const params: (string | number)[] = [];
		if (input.repoRoot) {
			filters.push("d.repo_root = ?");
			params.push(input.repoRoot);
		}
		if (input.path) {
			filters.push("s.path = ?");
			params.push(input.path);
		}
		const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
		return this.db
			.query<SymbolRow, (string | number)[]>(`
SELECT s.* FROM knowledge_symbols s
JOIN knowledge_documents d ON d.id = s.document_id
${where}
ORDER BY s.path, s.line, s.column
`)
			.all(...params);
	}

	private searchFtsRows(query: string, filters: SearchFilters, limit: number): SearchRow[] {
		const rows = this.db
			.query<SearchRow, (string | number)[]>(`
SELECT
	d.*, c.id AS chunk_id, c.chunk_index, c.start_line, c.end_line,
	c.content AS chunk_content, c.content_hash AS chunk_hash,
	bm25(knowledge_chunks_fts) AS score
FROM knowledge_chunks_fts
JOIN knowledge_chunks c ON c.id = knowledge_chunks_fts.chunk_id
JOIN knowledge_documents d ON d.id = c.document_id
WHERE knowledge_chunks_fts MATCH ?${filters.where}
ORDER BY score, c.path, c.chunk_index
LIMIT ?
`)
			.all(query, ...filters.params, limit);
		return rows;
	}

	private searchPathRows(shape: QueryShape, filters: SearchFilters, limit: number): SearchRow[] {
		if (!shape.pathNeedle) return [];
		return this.db
			.query<SearchRow, (string | number)[]>(`
SELECT
	d.*, c.id AS chunk_id, c.chunk_index, c.start_line, c.end_line,
	c.content AS chunk_content, c.content_hash AS chunk_hash
FROM knowledge_documents d
JOIN knowledge_chunks c ON c.document_id = d.id
WHERE d.path LIKE ?${filters.where}
ORDER BY CASE WHEN d.path = ? THEN 0 WHEN d.path LIKE ? THEN 1 ELSE 2 END, length(d.path), c.chunk_index
LIMIT ?
`)
			.all(`%${shape.pathNeedle}%`, ...filters.params, shape.path ?? shape.cleaned, `${shape.pathNeedle}%`, limit);
	}

	private searchSymbolRows(shape: QueryShape, filters: SearchFilters, limit: number): SearchRow[] {
		if (!shape.symbol) return [];
		const fullLike = shape.symbol.includes(".") ? shape.symbol : `%.${shape.symbol}`;
		return this.db
			.query<SearchRow, (string | number)[]>(`
SELECT DISTINCT
	d.*, c.id AS chunk_id, c.chunk_index, c.start_line, c.end_line,
	c.content AS chunk_content, c.content_hash AS chunk_hash
FROM knowledge_symbols s
JOIN knowledge_documents d ON d.id = s.document_id
JOIN knowledge_chunks c ON c.document_id = d.id AND c.start_line <= s.line AND c.end_line >= s.line
WHERE (s.name = ? OR (COALESCE(s.parent_symbol || '.', '') || s.name) = ? OR (COALESCE(s.parent_symbol || '.', '') || s.name) LIKE ?)${filters.where}
ORDER BY CASE
	WHEN (COALESCE(s.parent_symbol || '.', '') || s.name) = ? THEN 0
	WHEN s.name = ? THEN 1
	ELSE 2
END, s.exported DESC, d.path, c.chunk_index
LIMIT ?
`)
			.all(shape.symbol, shape.symbol, fullLike, ...filters.params, shape.symbol, shape.symbol, limit);
	}
}

interface SearchFilters {
	where: string;
	params: (string | number)[];
}

function buildSearchFilters(input: NexusKnowledgeSearchInput): SearchFilters {
	const clauses: string[] = [];
	const params: (string | number)[] = [];
	if (input.repoRoot) {
		clauses.push("d.repo_root = ?");
		params.push(input.repoRoot);
	}
	if (input.pathPrefix) {
		clauses.push("d.path LIKE ?");
		params.push(`${input.pathPrefix}%`);
	}
	return { where: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", params };
}

function mergeRankedRows(
	aggregate: Map<string, { row: SearchRow; score: number; sources: Set<NexusKnowledgeMatchKind>; diagnostics: Set<string> }>,
	rows: SearchRow[],
	source: NexusKnowledgeMatchKind,
	diagnosticsForRow: (row: SearchRow) => string[],
): void {
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index]!;
		const score = 1 / (60 + index);
		const current =
			aggregate.get(row.chunk_id) ?? { row, score: 0, sources: new Set<NexusKnowledgeMatchKind>(), diagnostics: new Set<string>() };
		current.row = row;
		current.score += score;
		current.sources.add(source);
		for (const diagnostic of diagnosticsForRow(row)) current.diagnostics.add(diagnostic);
		aggregate.set(row.chunk_id, current);
	}
}

function collapseMatchKinds(sources: Set<NexusKnowledgeMatchKind>): NexusKnowledgeMatchKind {
	return sources.size === 1 ? [...sources][0]! : "mixed";
}

function ftsDiagnostics(row: SearchRow, shape: QueryShape): string[] {
	const diagnostics = ["fts_match"];
	const oneLine = row.chunk_content.replace(/\s+/g, " ").trim().toLowerCase();
	if (shape.cleaned && oneLine.includes(shape.cleaned.toLowerCase())) diagnostics.push("exact_text");
	return diagnostics;
}

function pathDiagnostics(row: SearchRow, shape: QueryShape): string[] {
	const diagnostics = ["path_match"];
	if (shape.path && row.path === shape.path) diagnostics.push("exact_path");
	return diagnostics;
}

function symbolDiagnostics(row: SearchRow, shape: QueryShape): string[] {
	const diagnostics = ["symbol_match"];
	if (shape.symbol && row.chunk_content.includes(shape.symbol)) diagnostics.push("exact_symbol");
	return diagnostics;
}

function shapeSearchQuery(query: string): QueryShape {
	const cleaned = query.trim();
	const pathCandidate = cleaned.replace(/^\.\//, "");
	const isPathLike = /[/\\]/.test(cleaned) || /\.[A-Za-z0-9_-]+$/.test(cleaned);
	const symbolCandidate = cleaned.match(/^[A-Za-z_$][\w$.]*$/) ? cleaned : null;
	return {
		raw: query,
		cleaned,
		fts: ftsQuery(cleaned),
		symbol: symbolCandidate,
		path: isPathLike ? pathCandidate : null,
		pathNeedle: isPathLike ? pathCandidate : null,
	};
}

function symbolQueryRank(symbol: NexusKnowledgeSymbol, query: string): number {
	const fullName = symbolFullName(symbol);
	if (fullName === query) return 6 + Number(symbol.exported);
	if (symbol.name === query) return 4 + Number(symbol.exported);
	if (!query.includes(".") && fullName.endsWith(`.${query}`)) return 2 + Number(symbol.exported);
	return 0;
}

function terminalSymbolName(query: string): string {
	const normalized = query.trim();
	const parts = normalized.split(".").filter(Boolean);
	return parts[parts.length - 1] ?? normalized;
}

function shouldSkipReferenceLine(snippet: string): boolean {
	const trimmed = snippet.trim();
	return /^import\b/.test(trimmed) || /^export\s*\{/.test(trimmed) || /^export\s+default\b/.test(trimmed);
}

function looksLikeDefinitionLine(snippet: string, symbolName: string): boolean {
	const trimmed = snippet.trim();
	return new RegExp(`(?:function|class|interface|type|const|let|var)\\s+${escapeRegExp(symbolName)}\\b`).test(trimmed);
}

function shouldSkipExecutableLine(snippet: string): boolean {
	const trimmed = snippet.trim();
	return !trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || /^['"`]/.test(trimmed);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
