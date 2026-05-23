import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import { getNexusDbPath, openNexusDb } from "../store";
import type {
	NexusKnowledgeCallee,
	NexusKnowledgeCaller,
	NexusKnowledgeCodeQuery,
	NexusKnowledgeDocument,
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
	column: number;
	signature: string;
}

interface SearchRow extends DocumentRow {
	chunk_id: string;
	chunk_index: number;
	start_line: number;
	end_line: number;
	chunk_content: string;
	chunk_hash: string;
	score: number;
}

interface ReferenceRow extends DocumentRow {
	chunk_id: string;
	chunk_index: number;
	start_line: number;
	end_line: number;
	chunk_content: string;
	chunk_hash: string;
}

const DEFAULT_LIMIT = 20;
const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const CALL_PATTERN = new RegExp(`\\b(${IDENTIFIER})\\s*\\(`, "g");
const CALL_EXCLUDES = new Set([
	"if",
	"for",
	"while",
	"switch",
	"catch",
	"function",
	"return",
	"typeof",
	"await",
	"new",
	"super",
]);

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
		column: row.column,
		signature: row.signature,
	};
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
		const updatedAt = indexedAt;
		this.db.transaction(() => {
			const oldChunks = this.db
				.query<{ id: string }, [string]>("SELECT id FROM knowledge_chunks WHERE document_id = ?")
				.all(documentId);
			for (const chunk of oldChunks) {
				this.db.query("DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?").run(chunk.id);
			}
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
					updatedAt,
				);
			for (const chunk of input.chunks) {
				const chunkId = stableId(documentId, String(chunk.chunkIndex), chunk.contentHash);
				this.db
					.query(`
INSERT INTO knowledge_chunks (id, document_id, path, chunk_index, start_line, end_line, content, content_hash)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
					.run(
						chunkId,
						documentId,
						input.path,
						chunk.chunkIndex,
						chunk.startLine,
						chunk.endLine,
						chunk.content,
						chunk.contentHash,
					);
				this.db
					.query(
						"INSERT INTO knowledge_chunks_fts (content, path, document_id, chunk_id) VALUES (?, ?, ?, ?)",
					)
					.run(chunk.content, input.path, documentId, chunkId);
			}
			for (const symbol of input.symbols) {
				this.db
					.query(`
INSERT INTO knowledge_symbols (id, document_id, path, name, kind, exported, line, column, signature)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
					.run(
						stableId(documentId, symbol.name, symbol.kind, String(symbol.line), String(symbol.column)),
						documentId,
						input.path,
						symbol.name,
						symbol.kind,
						symbol.exported ? 1 : 0,
						symbol.line,
						symbol.column,
						symbol.signature,
					);
			}
		})();
		return this.getDocument(documentId) as NexusKnowledgeDocument;
	}

	search(input: NexusKnowledgeSearchInput): NexusKnowledgeSearchResult[] {
		const query = ftsQuery(input.query);
		if (!query) return [];
		const limit = normalizeLimit(input.limit);
		const filters: string[] = [];
		const params: (string | number)[] = [query];
		if (input.repoRoot) {
			filters.push("d.repo_root = ?");
			params.push(input.repoRoot);
		}
		if (input.pathPrefix) {
			filters.push("d.path LIKE ?");
			params.push(`${input.pathPrefix}%`);
		}
		params.push(limit);
		const where = filters.length > 0 ? ` AND ${filters.join(" AND ")}` : "";
		const rows = this.db
			.query<SearchRow, (string | number)[]>(`
SELECT
	d.*, c.id AS chunk_id, c.chunk_index, c.start_line, c.end_line,
	c.content AS chunk_content, c.content_hash AS chunk_hash,
	bm25(knowledge_chunks_fts) AS score
FROM knowledge_chunks_fts
JOIN knowledge_chunks c ON c.id = knowledge_chunks_fts.chunk_id
JOIN knowledge_documents d ON d.id = c.document_id
WHERE knowledge_chunks_fts MATCH ?${where}
ORDER BY score, c.path, c.chunk_index
LIMIT ?
`)
			.all(...params);
		return rows.map(row => ({
			document: mapDocument(row),
			chunk: mapChunk({
				id: row.chunk_id,
				document_id: row.id,
				path: row.path,
				chunk_index: row.chunk_index,
				start_line: row.start_line,
				end_line: row.end_line,
				content: row.chunk_content,
				content_hash: row.chunk_hash,
			}),
			score: row.score,
		}));
	}

	codeDefinitions(input: NexusKnowledgeCodeQuery): NexusKnowledgeSymbol[] {
		const filters = ["name = ?"];
		const params: (string | number)[] = [input.name];
		if (input.repoRoot) {
			filters.push("document_id IN (SELECT id FROM knowledge_documents WHERE repo_root = ?)");
			params.push(input.repoRoot);
		}
		if (input.path) {
			filters.push("path = ?");
			params.push(input.path);
		}
		params.push(normalizeLimit(input.limit));
		return this.db
			.query<SymbolRow, (string | number)[]>(`
SELECT * FROM knowledge_symbols
WHERE ${filters.join(" AND ")}
ORDER BY exported DESC, path, line
LIMIT ?
`)
			.all(...params)
			.map(mapSymbol);
	}

	codeReferences(input: NexusKnowledgeCodeQuery): NexusKnowledgeReference[] {
		const limit = normalizeLimit(input.limit);
		const pattern = `%${input.name}%`;
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
		const namePattern = new RegExp(`\\b${escapeRegExp(input.name)}\\b`, "g");
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
				namePattern.lastIndex = 0;
				let match: RegExpExecArray | null;
				while ((match = namePattern.exec(snippet)) !== null) {
					const line = row.start_line + offset;
					const column = match.index + 1;
					const definition = definitions.find(symbol => symbol.name === input.name && symbol.line === line) ?? null;
					references.push({ document, path: document.path, line, column, snippet, definition });
					if (references.length >= limit) return references;
				}
			}
		}
		return references;
	}

	codeCallers(input: NexusKnowledgeCodeQuery): NexusKnowledgeCaller[] {
		return this.codeReferences(input).map(reference => ({
			caller: this.nearestSymbolBefore(reference.document.id, reference.line, input.name),
			reference,
		}));
	}

	codeCallees(input: NexusKnowledgeCodeQuery): NexusKnowledgeCallee[] {
		const definitions = this.codeDefinitions({ ...input, limit: 1 });
		const definition = definitions[0];
		if (!definition) return [];
		const chunk = this.db
			.query<ChunkRow, [string, number, number]>(`
SELECT * FROM knowledge_chunks
WHERE document_id = ? AND start_line <= ? AND end_line >= ?
ORDER BY chunk_index
LIMIT 1
`)
			.get(definition.documentId, definition.line, definition.line);
		if (!chunk) return [];
		const knownSymbols = new Set(this.allSymbols(input.repoRoot).map(symbol => symbol.name));
		const lines = chunk.content.split("\n");
		const results: NexusKnowledgeCallee[] = [];
		for (let offset = Math.max(0, definition.line - chunk.start_line); offset < lines.length; offset++) {
			const snippet = lines[offset] ?? "";
			CALL_PATTERN.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = CALL_PATTERN.exec(snippet)) !== null) {
				const name = match[1] ?? "";
				if (!name || name === definition.name || CALL_EXCLUDES.has(name) || !knownSymbols.has(name)) continue;
				results.push({
					callee: this.codeDefinitions({ name, repoRoot: input.repoRoot, limit: 1 })[0] ?? null,
					name,
					line: chunk.start_line + offset,
					column: match.index + 1,
					snippet,
				});
				if (results.length >= normalizeLimit(input.limit)) return results;
			}
		}
		return results;
	}

	getDocument(id: string): NexusKnowledgeDocument | null {
		const row = this.db.query<DocumentRow, [string]>("SELECT * FROM knowledge_documents WHERE id = ?").get(id);
		return row ? mapDocument(row) : null;
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
	kind TEXT NOT NULL CHECK (kind IN ('function', 'class', 'const', 'let', 'var', 'type', 'interface')),
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
	}

	private symbolsForDocument(documentId: string): NexusKnowledgeSymbol[] {
		return this.db
			.query<SymbolRow, [string]>("SELECT * FROM knowledge_symbols WHERE document_id = ? ORDER BY line")
			.all(documentId)
			.map(mapSymbol);
	}

	private allSymbols(repoRoot: string | undefined): NexusKnowledgeSymbol[] {
		if (repoRoot) {
			return this.db
				.query<SymbolRow, [string]>(`
SELECT s.* FROM knowledge_symbols s
JOIN knowledge_documents d ON d.id = s.document_id
WHERE d.repo_root = ?
ORDER BY s.path, s.line
`)
				.all(repoRoot)
				.map(mapSymbol);
		}
		return this.db.query<SymbolRow, []>("SELECT * FROM knowledge_symbols ORDER BY path, line").all().map(mapSymbol);
	}

	private nearestSymbolBefore(documentId: string, line: number, calleeName: string): NexusKnowledgeSymbol | null {
		const row = this.db
			.query<SymbolRow, [string, string, number]>(`
SELECT * FROM knowledge_symbols
WHERE document_id = ? AND name != ? AND line <= ?
ORDER BY line DESC
LIMIT 1
`)
			.get(documentId, calleeName, line);
		return row ? mapSymbol(row) : null;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
