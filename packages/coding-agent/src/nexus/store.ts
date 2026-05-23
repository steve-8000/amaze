import { Database } from "bun:sqlite";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getMemoriesDir } from "@amaze/utils";
import { bufferToVector, cosineSimilarity, vectorToBuffer } from "./embedding-client";
import { activeScopesForSearch, resolveNexusProjectScope, scopeForTarget, staticNexusScope } from "./scope";
import type {
	NexusConfidence,
	NexusDoctorResult,
	NexusMemoryCategory,
	NexusMemoryEntry,
	NexusMemoryStatus,
	NexusMemoryTarget,
	NexusMemoryType,
	NexusMutationResult,
	NexusScope,
	NexusSearchInput,
	NexusSourceKind,
	NexusStaleness,
} from "./types";

const CATEGORY_VALUES = new Set<NexusMemoryCategory>([
	"failure",
	"correction",
	"insight",
	"preference",
	"convention",
	"tool-quirk",
]);

interface NexusStoreOptions {
	agentDir: string;
	cwd: string;
	contradictionThreshold?: number;
}

interface AddMemoryInput {
	target: NexusMemoryTarget;
	content: string;
	category?: NexusMemoryCategory | null;
	memoryType?: NexusMemoryType;
	confidence?: NexusConfidence;
	provenance?: string;
	sourceKind?: NexusSourceKind;
	sourcePath?: string | null;
	sourceRecordId?: string | null;
	failureReason?: string | null;
	scope?: NexusScope;
}

interface ReplaceMemoryInput {
	target: NexusMemoryTarget;
	oldText: string;
	content: string;
	scope?: NexusScope;
}

interface RemoveMemoryInput {
	target: NexusMemoryTarget;
	oldText: string;
	scope?: NexusScope;
}

interface ImportSourceInput {
	sourceKind: NexusSourceKind;
	sourcePath?: string | null;
	sourceRecordId?: string | null;
	threadId?: string | null;
	sessionId?: string | null;
	projectKey?: string | null;
	content: string;
	rawJson?: unknown;
}

interface MemoryRow {
	id: string;
	scope_id: string;
	scope_kind: NexusMemoryEntry["scopeKind"];
	scope_key: string | null;
	display_name: string;
	cwd: string | null;
	git_origin: string | null;
	target: NexusMemoryTarget;
	category: NexusMemoryCategory | null;
	memory_type: NexusMemoryType;
	content: string;
	provenance: string;
	confidence: NexusConfidence;
	staleness: NexusStaleness;
	status: NexusMemoryStatus;
	usage_count: number;
	last_used_at: string | null;
	last_verified_at: string | null;
	valid_from: string | null;
	valid_to: string | null;
	created_at: string;
	updated_at: string;
}

const MEMORY_COLUMNS = [
	"mi.id",
	"mi.scope_id",
	"s.scope_kind",
	"s.scope_key",
	"s.display_name",
	"s.cwd",
	"s.git_origin",
	"mi.target",
	"mi.category",
	"mi.memory_type",
	"mi.content",
	"mi.provenance",
	"mi.confidence",
	"mi.staleness",
	"mi.status",
	"mi.usage_count",
	"mi.last_used_at",
	"mi.last_verified_at",
	"mi.valid_from",
	"mi.valid_to",
	"mi.created_at",
	"mi.updated_at",
].join(", ");

export function getNexusDbPath(agentDir: string): string {
	return path.join(getMemoriesDir(agentDir), "nexus", "nexus.db");
}
export function getNexusKnowledgeDbPath(agentDir: string): string {
	return path.join(getNexusRoot(agentDir), "nexus-knowledge.db");
}


export function getNexusRoot(agentDir: string): string {
	return path.join(getMemoriesDir(agentDir), "nexus");
}

export function getNexusArtifactRoot(agentDir: string, cwd: string): string {
	return path.join(getNexusRoot(agentDir), "projects", resolveNexusProjectScope(cwd).key ?? "unknown");
}

export function openNexusDb(dbPath: string): Database {
	fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath, { create: true });
	db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS memory_scopes (
	id TEXT PRIMARY KEY,
	scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'user', 'project', 'knowledge', 'failure', 'session')),
	scope_key TEXT,
	display_name TEXT NOT NULL,
	cwd TEXT,
	git_origin TEXT,
	repo_root TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_sources (
	id TEXT PRIMARY KEY,
	source_kind TEXT NOT NULL,
	source_path TEXT,
	source_record_id TEXT,
	thread_id TEXT,
	session_id TEXT,
	project_key TEXT,
	checksum TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	raw_json TEXT
);

CREATE TABLE IF NOT EXISTS memory_items (
	id TEXT PRIMARY KEY,
	scope_id TEXT NOT NULL,
	source_id TEXT,
	target TEXT NOT NULL CHECK (target IN ('memory', 'user', 'project', 'knowledge', 'failure')),
	category TEXT CHECK (category IN ('failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk')),
	memory_type TEXT NOT NULL,
	content TEXT NOT NULL,
	provenance TEXT NOT NULL,
	confidence TEXT NOT NULL,
	staleness TEXT NOT NULL,
	status TEXT NOT NULL,
	usage_count INTEGER NOT NULL DEFAULT 0,
	last_used_at TEXT,
	last_verified_at TEXT,
	valid_from TEXT,
	valid_to TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	embedding BLOB,
	embedding_model TEXT,
	embedding_dim INTEGER,
	FOREIGN KEY(scope_id) REFERENCES memory_scopes(id),
	FOREIGN KEY(source_id) REFERENCES memory_sources(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nexus_items_unique_active
ON memory_items(scope_id, target, content)
WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_nexus_items_scope ON memory_items(scope_id, status);
CREATE INDEX IF NOT EXISTS idx_nexus_items_usage ON memory_items(usage_count, last_used_at);
CREATE INDEX IF NOT EXISTS idx_nexus_items_target ON memory_items(target);
CREATE INDEX IF NOT EXISTS idx_nexus_items_category ON memory_items(category);

CREATE TABLE IF NOT EXISTS memory_events (
	id TEXT PRIMARY KEY,
	memory_id TEXT,
	event_type TEXT NOT NULL,
	source TEXT NOT NULL,
	before_json TEXT,
	after_json TEXT,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_runtime_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	kind TEXT NOT NULL,
	severity TEXT NOT NULL CHECK (severity IN ('info','warn','error')),
	message TEXT NOT NULL,
	context_json TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_events_recent ON memory_runtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_kind ON memory_runtime_events(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_relations (
	from_id TEXT NOT NULL,
	to_id TEXT NOT NULL,
	relation TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY(from_id, to_id, relation)
);

CREATE TRIGGER IF NOT EXISTS nexus_relations_validate_ai BEFORE INSERT ON memory_relations
WHEN NEW.relation NOT IN ('supports','contradicts','supersedes','duplicate_of','generalizes','specializes')
BEGIN
	SELECT RAISE(ABORT, 'invalid memory_relations.relation value');
END;

CREATE TRIGGER IF NOT EXISTS nexus_relations_validate_au BEFORE UPDATE ON memory_relations
WHEN NEW.relation NOT IN ('supports','contradicts','supersedes','duplicate_of','generalizes','specializes')
BEGIN
	SELECT RAISE(ABORT, 'invalid memory_relations.relation value');
END;

CREATE TABLE IF NOT EXISTS memory_jobs (
	kind TEXT NOT NULL,
	job_key TEXT NOT NULL,
	scope_id TEXT,
	status TEXT NOT NULL,
	worker_id TEXT,
	ownership_token TEXT,
	started_at INTEGER,
	finished_at INTEGER,
	lease_until INTEGER,
	retry_at INTEGER,
	retry_remaining INTEGER NOT NULL DEFAULT 3,
	last_error TEXT,
	input_watermark INTEGER,
	last_success_watermark INTEGER,
	PRIMARY KEY(kind, job_key)
);

CREATE TABLE IF NOT EXISTS memory_usage (
	id TEXT PRIMARY KEY,
	memory_id TEXT NOT NULL,
	thread_id TEXT,
	turn_id TEXT,
	citation_note TEXT,
	used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_hypotheses (
	id TEXT PRIMARY KEY,
	scope_id TEXT,
	prompt TEXT NOT NULL,
	hypothesis TEXT NOT NULL,
	supporting_memory_ids TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected', 'expired')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_skills (
	id TEXT PRIMARY KEY,
	scope_id TEXT NOT NULL,
	name TEXT NOT NULL,
	content TEXT NOT NULL,
	status TEXT NOT NULL,
	source_memory_ids TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(scope_id, name)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
	content,
	display_name,
	category,
	memory_type,
	content='memory_items'
);

CREATE TRIGGER IF NOT EXISTS nexus_items_ai AFTER INSERT ON memory_items BEGIN
	INSERT INTO memory_fts(rowid, content, display_name, category, memory_type)
	SELECT new.rowid, new.content, s.display_name, new.category, new.memory_type
	FROM memory_scopes s WHERE s.id = new.scope_id;
END;

CREATE TRIGGER IF NOT EXISTS nexus_items_ad AFTER DELETE ON memory_items BEGIN
	INSERT INTO memory_fts(memory_fts, rowid, content, display_name, category, memory_type)
	VALUES ('delete', old.rowid, old.content, '', old.category, old.memory_type);
END;

CREATE TRIGGER IF NOT EXISTS nexus_items_au AFTER UPDATE ON memory_items BEGIN
	INSERT INTO memory_fts(memory_fts, rowid, content, display_name, category, memory_type)
	VALUES ('delete', old.rowid, old.content, '', old.category, old.memory_type);
	INSERT INTO memory_fts(rowid, content, display_name, category, memory_type)
	SELECT new.rowid, new.content, s.display_name, new.category, new.memory_type
	FROM memory_scopes s WHERE s.id = new.scope_id;
END;
`);
	ensureMemoryItemsColumns(db);
	ensureMemoryJobsStageColumns(db);
	return db;
}

function ensureMemoryItemsColumns(db: Database): void {
	const rows = db.prepare("PRAGMA table_info(memory_items)").all() as Array<{ name?: string }>;
	const existing = new Set(rows.map(row => row.name).filter((value): value is string => typeof value === "string"));
	for (const [name, ddl] of [
		["embedding", "BLOB"],
		["embedding_model", "TEXT"],
		["embedding_dim", "INTEGER"],
	] as const) {
		if (!existing.has(name)) db.exec(`ALTER TABLE memory_items ADD COLUMN ${name} ${ddl}`);
	}
}

function ensureMemoryJobsStageColumns(db: Database): void {
	const rows = db.prepare("PRAGMA table_info(memory_jobs)").all() as Array<{ name?: string }>;
	const existing = new Set(rows.map(row => row.name).filter((value): value is string => typeof value === "string"));
	for (const [name, ddl] of [
		["stage", "TEXT"],
		["duration_ms", "INTEGER"],
		["llm_calls", "INTEGER NOT NULL DEFAULT 0"],
		["embed_calls", "INTEGER NOT NULL DEFAULT 0"],
	] as const) {
		if (!existing.has(name)) db.exec(`ALTER TABLE memory_jobs ADD COLUMN ${name} ${ddl}`);
	}
}

export class NexusStore {
	readonly scope: NexusScope;
	readonly dbPath: string;
	readonly root: string;
	readonly artifactRoot: string;
	#db?: Database;
	#contradictionThreshold: number;

	constructor(readonly options: NexusStoreOptions) {
		this.scope = resolveNexusProjectScope(options.cwd);
		this.root = getNexusRoot(options.agentDir);
		this.dbPath = getNexusDbPath(options.agentDir);
		this.artifactRoot = getNexusArtifactRoot(options.agentDir, options.cwd);
		this.#contradictionThreshold = options.contradictionThreshold ?? 0.7;
	}

	close(): void {
		this.#db?.close(false);
		this.#db = undefined;
	}

	ensureScope(scope: NexusScope): void {
		const now = isoNow();
		this.#dbInstance
			.prepare(`
INSERT INTO memory_scopes (id, scope_kind, scope_key, display_name, cwd, git_origin, repo_root, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	display_name = excluded.display_name,
	cwd = excluded.cwd,
	git_origin = excluded.git_origin,
	repo_root = excluded.repo_root,
	updated_at = excluded.updated_at
`)
			.run(scope.id, scope.kind, scope.key, scope.displayName, scope.cwd, scope.gitOrigin, scope.repoRoot, now, now);
	}

	add(input: AddMemoryInput): NexusMutationResult {
		const content = input.content.trim();
		if (!content) return { success: false, error: "Content cannot be empty." };
		const scanError = scanNexusContent(content);
		if (scanError) return { success: false, error: scanError };
		const scope = input.scope ?? scopeForTarget(input.target, this.options.cwd);
		this.ensureScope(scope);
		const sourceId = this.importSource({
			sourceKind: input.sourceKind ?? "manual",
			sourcePath: input.sourcePath,
			sourceRecordId: input.sourceRecordId,
			projectKey: scope.kind === "project" ? scope.key : null,
			content,
			rawJson: { target: input.target, category: input.category ?? null, failureReason: input.failureReason ?? null },
		});
		const existing = this.#findExact(scope.id, input.target, content);
		if (existing) {
			const now = isoNow();
			this.#dbInstance.prepare("UPDATE memory_items SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?").run(now, now, existing.id);
			const updated = this.#getById(existing.id) ?? existing;
			this.#logEvent(updated.id, "touch", "nexus_memory_tool", existing, updated);
			return {
				success: true,
				message: "Entry already exists; refreshed usage metadata.",
				target: input.target,
				entry: updated,
			};
		}
		const now = isoNow();
		const id = crypto.randomUUID();
		const memoryType = input.memoryType ?? inferMemoryType(input.target, input.category);
		const confidence = input.confidence ?? (input.sourceKind?.startsWith("old_") ? "imported_unverified" : "user_asserted");
		this.#dbInstance
			.prepare(`
INSERT INTO memory_items (
	id, scope_id, source_id, target, category, memory_type, content, provenance, confidence,
	staleness, status, last_verified_at, valid_from, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
`)
			.run(
				id,
				scope.id,
				sourceId,
				input.target,
				normalizeCategory(input.category),
				memoryType,
				content,
				input.provenance ?? `source:${input.sourceKind ?? "manual"}`,
				confidence,
				confidence === "imported_unverified" ? "unknown" : "fresh",
				confidence === "tool_verified" ? now : null,
				now,
				now,
				now,
			);
		const entry = this.#getById(id) ?? undefined;
		if (entry) this.#logEvent(entry.id, "accepted", "nexus_memory_tool", null, entry);
		return { success: true, message: "Entry added.", target: input.target, entry };
	}

	replace(input: ReplaceMemoryInput): NexusMutationResult {
		const oldText = input.oldText.trim();
		const content = input.content.trim();
		if (!oldText) return { success: false, error: "old_text cannot be empty." };
		if (!content) return { success: false, error: "content cannot be empty. Use remove to delete entries." };
		const scope = input.scope ?? scopeForTarget(input.target, this.options.cwd);
		const matches = this.#findContaining(scope.id, input.target, oldText, true);
		if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
		if (matches.length > 1) return { success: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, entries: matches };
		const previous = matches[0];
		const now = isoNow();
		const replacement = this.add({
			target: input.target,
			content,
			category: previous.category,
			memoryType: previous.memoryType,
			confidence: previous.confidence,
			provenance: `replacement_for:${previous.id}`,
			sourceKind: "manual",
			scope,
		});
		if (!replacement.success || !replacement.entry) return replacement;
		this.#dbInstance.prepare("UPDATE memory_items SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?").run(now, now, previous.id);
		this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations (from_id, to_id, relation, created_at) VALUES (?, ?, 'supersedes', ?)").run(replacement.entry.id, previous.id, now);
		this.#logEvent(previous.id, "superseded", "nexus_memory_tool", previous, this.#getById(previous.id));
		return { ...replacement, message: "Entry replaced; previous entry retained as superseded history." };
	}

	remove(input: RemoveMemoryInput): NexusMutationResult {
		const oldText = input.oldText.trim();
		if (!oldText) return { success: false, error: "old_text cannot be empty." };
		const scope = input.scope ?? scopeForTarget(input.target, this.options.cwd);
		const matches = this.#findContaining(scope.id, input.target, oldText, true);
		if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
		if (matches.length > 1) return { success: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, entries: matches };
		const previous = matches[0];
		const now = isoNow();
		this.#dbInstance.prepare("UPDATE memory_items SET status = 'deleted', valid_to = ?, updated_at = ? WHERE id = ?").run(now, now, previous.id);
		this.#logEvent(previous.id, "deleted", "nexus_memory_tool", previous, this.#getById(previous.id));
		return { success: true, message: "Entry deleted from active projection; temporal history retained.", target: input.target };
	}

	search(input: NexusSearchInput): NexusMemoryEntry[] {
		const query = input.query.trim();
		const limit = clampLimit(input.limit, 10, 50);
		if (!query || query === "*") {
			return rankForGoal(this.list({ scope: input.scope, target: input.target, limit }), input.goal);
		}
		const scopes = activeScopesForSearch(this.options.cwd, input.scope);
		const queryVector = input.queryVector;
		if (queryVector && queryVector.length > 0) {
			const weight = Math.min(1, Math.max(0, input.vectorWeight ?? 0.6));
			return this.#hybridSearch(query, queryVector, weight, scopes, input, limit);
		}
		try {
			const fts = this.#runFtsSearch(query, scopes, input, limit);
			if (fts.length > 0) return rankForGoal(fts, input.goal);
		} catch {
			// Fall through to token search below.
		}
		const tokenHits = this.#fallbackTokenSearch(query, scopes, input, limit);
		if (tokenHits.length > 0) return rankForGoal(tokenHits, input.goal);
		return rankForGoal(this.#fallbackLikeSearch(query, scopes, input, limit), input.goal);
	}

	/**
	 * Persist a precomputed embedding for an existing memory entry. The vector
	 * is stored as little-endian Float32 bytes; dimension and model name are
	 * recorded for later validation by hybrid search.
	 */
	addEmbedding(memoryId: string, vector: Float32Array, model: string): void {
		if (!vector || vector.length === 0) return;
		const buffer = vectorToBuffer(vector);
		this.#dbInstance
			.prepare("UPDATE memory_items SET embedding = ?, embedding_model = ?, embedding_dim = ?, updated_at = ? WHERE id = ?")
			.run(buffer, model, vector.length, isoNow(), memoryId);
	}

	/**
	 * Active memory entries whose embedding is missing or was generated by a
	 * different model. Pipeline workers pick up this list, batch-embed via the
	 * embedding client, and write back with `addEmbedding`. Missing vectors are
	 * prioritized over model drift so new rows are searchable first.
	 */
	listMissingOrStaleEmbeddings(limit: number, activeModel: string | null | undefined): Array<{ id: string; content: string; reason: "missing" | "stale_model" }> {
		const cap = Math.max(1, Math.min(500, limit));
		const rows = this.#dbInstance
			.prepare(`
SELECT id, content,
       CASE WHEN embedding IS NULL THEN 'missing' ELSE 'stale_model' END AS reason
FROM memory_items
WHERE status = 'active'
  AND (embedding IS NULL OR (? IS NOT NULL AND embedding_model IS NOT ?))
ORDER BY (embedding IS NULL) DESC, updated_at DESC
LIMIT ?
`)
			.all(activeModel ?? null, activeModel ?? null, cap) as Array<{ id: string; content: string; reason: "missing" | "stale_model" }>;
		return rows;
	}

	listMissingEmbeddings(limit: number): Array<{ id: string; content: string }> {
		return this.listMissingOrStaleEmbeddings(limit, null).map(({ id, content }) => ({ id, content }));
	}

	/**
	 * Pure cosine top-K. Returns active entries (or all when `includeHistory`)
	 * with their similarity score against `queryVector`. Used standalone by
	 * dream/skill workers and as an input to hybrid search.
	 */
	vectorSearch(
		queryVector: Float32Array,
		options: { scope?: NexusSearchInput["scope"]; limit?: number; includeHistory?: boolean } = {},
	): Array<{ entry: NexusMemoryEntry; score: number }> {
		if (!queryVector || queryVector.length === 0) return [];
		const limit = clampLimit(options.limit, 10, 50);
		const scopes = activeScopesForSearch(this.options.cwd, options.scope);
		const params: Array<string | number | null> = [queryVector.length];
		const conditions = ["mi.embedding IS NOT NULL", "mi.embedding_dim = ?"];
		appendScopeConditions(conditions, params, scopes);
		if (!options.includeHistory) conditions.push("mi.status = 'active'");
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}, mi.embedding AS embedding
FROM memory_items mi
JOIN memory_scopes s ON s.id = mi.scope_id
WHERE ${conditions.join(" AND ")}
`)
			.all(...params) as Array<MemoryRow & { embedding: Uint8Array | null }>;
		const scored: Array<{ entry: NexusMemoryEntry; score: number }> = [];
		for (const row of rows) {
			const vec = bufferToVector(row.embedding);
			if (vec.length !== queryVector.length) continue;
			const score = cosineSimilarity(queryVector, vec);
			scored.push({ entry: mapRow(row), score });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit);
	}

	#runFtsSearch(query: string, scopes: NexusScope[] | undefined, input: NexusSearchInput, limit: number): NexusMemoryEntry[] {
		const params: Array<string | number | null> = [escapeFts5Query(query)];
		const conditions = ["mi.rowid IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)"];
		appendScopeConditions(conditions, params, scopes);
		if (!input.includeHistory) conditions.push("mi.status = 'active'");
		if (input.target) {
			conditions.push(input.target === "memory" ? "mi.target IN ('memory', 'project', 'knowledge')" : "mi.target = ?");
			if (input.target !== "memory") params.push(input.target);
		}
		if (input.category) {
			conditions.push("mi.category = ?");
			params.push(input.category);
		}
		params.push(limit);
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}
FROM memory_items mi
JOIN memory_scopes s ON s.id = mi.scope_id
WHERE ${conditions.join(" AND ")}
ORDER BY
	CASE mi.status WHEN 'active' THEN 0 ELSE 1 END,
	CASE mi.confidence WHEN 'tool_verified' THEN 0 WHEN 'user_asserted' THEN 1 WHEN 'inferred' THEN 2 ELSE 3 END,
	mi.usage_count DESC,
	COALESCE(mi.last_used_at, mi.updated_at) DESC
LIMIT ?
`)
			.all(...params) as MemoryRow[];
		return rows.map(mapRow);
	}

	#hybridSearch(
		query: string,
		queryVector: Float32Array,
		vectorWeight: number,
		scopes: NexusScope[] | undefined,
		input: NexusSearchInput,
		limit: number,
	): NexusMemoryEntry[] {
		const ftsLimit = Math.min(50, Math.max(limit, limit * 3));
		let ftsCandidates: NexusMemoryEntry[] = [];
		try {
			ftsCandidates = this.#runFtsSearch(query, scopes, input, ftsLimit);
		} catch {
			ftsCandidates = [];
		}
		if (ftsCandidates.length === 0) {
			ftsCandidates = this.#fallbackTokenSearch(query, scopes, input, ftsLimit);
		}
		if (ftsCandidates.length === 0) {
			ftsCandidates = this.#fallbackLikeSearch(query, scopes, input, ftsLimit);
		}
		const vectorCandidates = this.vectorSearch(queryVector, { scope: input.scope, limit: ftsLimit, includeHistory: input.includeHistory });
		const ftsScores = new Map<string, { entry: NexusMemoryEntry; rank: number }>();
		ftsCandidates.forEach((entry, index) => ftsScores.set(entry.id, { entry, rank: index + 1 }));
		const vectorScores = new Map<string, { entry: NexusMemoryEntry; score: number }>();
		for (const candidate of vectorCandidates) vectorScores.set(candidate.entry.id, candidate);
		const merged = new Map<string, { entry: NexusMemoryEntry; score: number }>();
		const ftsCount = ftsCandidates.length || 1;
		const ftsW = 1 - vectorWeight;
		for (const [id, { entry, rank }] of ftsScores) {
			const ftsScore = ftsW * (1 - (rank - 1) / ftsCount);
			const vectorScore = vectorWeight * Math.max(0, vectorScores.get(id)?.score ?? 0);
			merged.set(id, { entry, score: ftsScore + vectorScore + confidenceBoost(entry) + goalBoost(entry, input.goal) });
		}
		for (const [id, { entry, score }] of vectorScores) {
			if (merged.has(id)) continue;
			merged.set(id, { entry, score: vectorWeight * Math.max(0, score) + confidenceBoost(entry) + goalBoost(entry, input.goal) });
		}
		const ordered = [...merged.values()].sort((a, b) => b.score - a.score);
		const filtered = ordered.filter(({ entry }) => {
			if (input.target === "memory") return entry.target === "memory" || entry.target === "project" || entry.target === "knowledge";
			if (input.target) return entry.target === input.target;
			return true;
		});
		return filtered.slice(0, limit).map(item => item.entry);
	}

	list(input: { scope?: NexusSearchInput["scope"]; target?: "memory" | "user" | "failure"; limit?: number } = {}): NexusMemoryEntry[] {
		const limit = clampLimit(input.limit, 50, 500);
		const scopes = activeScopesForSearch(this.options.cwd, input.scope);
		const params: Array<string | number | null> = [];
		const conditions = ["mi.status = 'active'"];
		appendScopeConditions(conditions, params, scopes);
		if (input.target) {
			conditions.push(input.target === "memory" ? "mi.target IN ('memory', 'project', 'knowledge')" : "mi.target = ?");
			if (input.target !== "memory") params.push(input.target);
		}
		params.push(limit);
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}
FROM memory_items mi
JOIN memory_scopes s ON s.id = mi.scope_id
WHERE ${conditions.join(" AND ")}
ORDER BY COALESCE(mi.last_used_at, mi.updated_at) DESC, mi.id DESC
LIMIT ?
`)
			.all(...params) as MemoryRow[];
		return rows.map(mapRow);
	}

	importSource(input: ImportSourceInput): string {
		const content = input.content.trim();
		const checksum = hashString(`${input.sourceKind}\n${input.sourcePath ?? ""}\n${input.sourceRecordId ?? ""}\n${content}`);
		const existing = this.#dbInstance.prepare("SELECT id FROM memory_sources WHERE checksum = ?").get(checksum) as { id: string } | undefined;
		if (existing) return existing.id;
		const id = crypto.randomUUID();
		const now = isoNow();
		this.#dbInstance
			.prepare(`
INSERT INTO memory_sources (
	id, source_kind, source_path, source_record_id, thread_id, session_id, project_key, checksum, created_at, updated_at, raw_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
			.run(
				id,
				input.sourceKind,
				input.sourcePath ?? null,
				input.sourceRecordId ?? null,
				input.threadId ?? null,
				input.sessionId ?? null,
				input.projectKey ?? null,
				checksum,
				now,
				now,
				input.rawJson === undefined ? null : JSON.stringify(input.rawJson),
			);
		return id;
	}

	recordUsage(memoryIds: string[], threadId?: string, turnId?: string, citationNote?: string): void {
		if (memoryIds.length === 0) return;
		const now = isoNow();
		const tx = this.#dbInstance.transaction((ids: string[]) => {
			for (const id of ids) {
				this.#dbInstance.prepare("UPDATE memory_items SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
				this.#dbInstance.prepare("INSERT INTO memory_usage (id, memory_id, thread_id, turn_id, citation_note, used_at) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), id, threadId ?? null, turnId ?? null, citationNote ?? null, now);
			}
		});
		tx(memoryIds);
	}

	createHypothesis(prompt: string, hypothesis: string, supportingMemoryIds: string[] = [], scope = this.scope): string {
		this.ensureScope(scope);
		const id = crypto.randomUUID();
		const now = isoNow();
		this.#dbInstance
			.prepare("INSERT INTO memory_hypotheses (id, scope_id, prompt, hypothesis, supporting_memory_ids, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)")
			.run(id, scope.id, prompt, hypothesis, JSON.stringify(supportingMemoryIds), now, now);
		return id;
	}

	listHypotheses(status: "proposed" | "accepted" | "rejected" | "expired" = "proposed", limit = 20): Array<{
		id: string;
		scopeId: string | null;
		prompt: string;
		hypothesis: string;
		supportingMemoryIds: string[];
		status: "proposed" | "accepted" | "rejected" | "expired";
		createdAt: string;
		updatedAt: string;
	}> {
		const rows = this.#dbInstance
			.prepare("SELECT id, scope_id, prompt, hypothesis, supporting_memory_ids, status, created_at, updated_at FROM memory_hypotheses WHERE status = ? ORDER BY created_at ASC LIMIT ?")
			.all(status, clampLimit(limit, 20, 200)) as Array<{
				id: string;
				scope_id: string | null;
				prompt: string;
				hypothesis: string;
				supporting_memory_ids: string;
				status: "proposed" | "accepted" | "rejected" | "expired";
				created_at: string;
				updated_at: string;
			}>;
		return rows.map(row => ({
			id: row.id,
			scopeId: row.scope_id,
			prompt: row.prompt,
			hypothesis: row.hypothesis,
			supportingMemoryIds: parseJsonStringArray(row.supporting_memory_ids),
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	updateHypothesisStatus(id: string, status: "accepted" | "rejected" | "expired", reason: string, verifier = "nexus_hypothesis_verifier"): boolean {
		const before = this.#dbInstance.prepare("SELECT * FROM memory_hypotheses WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		if (!before) return false;
		const now = isoNow();
		const result = this.#dbInstance.prepare("UPDATE memory_hypotheses SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
		this.#logEvent(null, `hypothesis_${status}`, verifier, null, {
			id,
			scopeId: typeof before.scope_id === "string" ? before.scope_id : "project:unknown",
			scopeKind: "project",
			scopeKey: null,
			displayName: "hypothesis",
			cwd: null,
			gitOrigin: null,
			target: "knowledge",
			category: "insight",
			memoryType: "note",
			content: `${String(before.hypothesis ?? "")}\n\nVerification: ${reason}`,
			provenance: verifier,
			confidence: "inferred",
			staleness: "fresh",
			status: "active",
			usageCount: 0,
			lastUsedAt: null,
			lastVerifiedAt: now,
			validFrom: now,
			validTo: null,
			createdAt: now,
			updatedAt: now,
		});
		return Number(result.changes ?? 0) > 0;
	}

	listSkillCandidateEntries(limit = 40): NexusMemoryEntry[] {
		const usedSourceIds = new Set<string>();
		const skillRows = this.#dbInstance
			.prepare("SELECT source_memory_ids FROM memory_skills WHERE status IN ('active', 'validated')")
			.all() as Array<{ source_memory_ids: string }>;
		for (const row of skillRows) {
			for (const id of parseJsonStringArray(row.source_memory_ids)) usedSourceIds.add(id);
		}
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}
FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id
WHERE mi.status = 'active' AND mi.memory_type IN ('workflow', 'skill_candidate', 'command') AND length(mi.content) <= 2000
ORDER BY mi.scope_id, mi.updated_at DESC
LIMIT ?
`)
			.all(clampLimit(limit, 40, 500)) as MemoryRow[];
		return rows.map(mapRow).filter(entry => !usedSourceIds.has(entry.id));
	}

	upsertSkill(scopeId: string, name: string, content: string, sourceMemoryIds: string[], status: "draft" | "active" | "validated" = "active"): boolean {
		const skillName = sanitizeSkillName(name);
		const now = isoNow();
		const existing = this.#dbInstance.prepare("SELECT id FROM memory_skills WHERE scope_id = ? AND name = ?").get(scopeId, skillName) as { id: string } | undefined;
		if (existing) {
			const result = this.#dbInstance
				.prepare("UPDATE memory_skills SET content = ?, status = ?, source_memory_ids = ?, updated_at = ? WHERE id = ?")
				.run(content, status, JSON.stringify(sourceMemoryIds), now, existing.id);
			return Number(result.changes ?? 0) > 0;
		}
		this.#dbInstance
			.prepare("INSERT INTO memory_skills (id, scope_id, name, content, status, source_memory_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
			.run(crypto.randomUUID(), scopeId, skillName, content, status, JSON.stringify(sourceMemoryIds), now, now);
		return true;
	}

	explainMemory(id: string): {
		entry: NexusMemoryEntry | null;
		source: Record<string, unknown> | null;
		events: Array<Record<string, unknown>>;
		relations: Array<Record<string, unknown>>;
		usage: Array<Record<string, unknown>>;
	} {
		const entry = this.#getById(id);
		const source = this.#dbInstance
			.prepare("SELECT ms.* FROM memory_items mi LEFT JOIN memory_sources ms ON ms.id = mi.source_id WHERE mi.id = ?")
			.get(id) as Record<string, unknown> | undefined;
		const escaped = `%${escapeLikePattern(id)}%`;
		const events = this.#dbInstance
			.prepare("SELECT * FROM memory_events WHERE memory_id = ? OR (memory_id IS NULL AND (after_json LIKE ? ESCAPE '\\' OR before_json LIKE ? ESCAPE '\\')) ORDER BY created_at ASC")
			.all(id, escaped, escaped) as Array<Record<string, unknown>>;
		const relations = this.#dbInstance.prepare("SELECT * FROM memory_relations WHERE from_id = ? OR to_id = ? ORDER BY created_at ASC").all(id, id) as Array<Record<string, unknown>>;
		const usage = this.#dbInstance.prepare("SELECT * FROM memory_usage WHERE memory_id = ? ORDER BY used_at DESC LIMIT 50").all(id) as Array<Record<string, unknown>>;
		return { entry, source: source ?? null, events, relations, usage };
	}

	runSelfHealing(options: { semanticDuplicateThreshold?: number } = {}): {
		duplicates: number;
		stale: number;
		contradictions: number;
		scopeLeaks: number;
		skills: number;
		semanticDuplicates: number;
	} {
		const duplicates = this.#markDuplicates();
		const stale = this.#markStaleImported();
		const contradictions = this.#detectTextContradictions();
		const scopeLeaks = this.#detectScopeLeaks();
		const skills = this.#promoteRepeatedSkillCandidates();
		const semanticDuplicates = this.#markSemanticDuplicates(options.semanticDuplicateThreshold ?? 0.92);
		return { duplicates, stale, contradictions, scopeLeaks, skills, semanticDuplicates };
	}

	stats(): NexusDoctorResult["stats"] {
		const scalar = (sql: string): number => {
			const row = this.#dbInstance.prepare(sql).get() as { count?: number } | undefined;
			return row?.count ?? 0;
		};
		return {
			active: scalar("SELECT COUNT(*) AS count FROM memory_items WHERE status = 'active'"),
			superseded: scalar("SELECT COUNT(*) AS count FROM memory_items WHERE status = 'superseded'"),
			quarantined: scalar("SELECT COUNT(*) AS count FROM memory_items WHERE status = 'quarantined'"),
			hypotheses: scalar("SELECT COUNT(*) AS count FROM memory_hypotheses WHERE status = 'proposed'"),
			pendingJobs: scalar("SELECT COUNT(*) AS count FROM memory_jobs WHERE status IN ('pending', 'running', 'error')"),
			unresolvedContradictions: scalar("SELECT COUNT(*) AS count FROM memory_relations WHERE relation = 'contradicts'"),
		};
	}

	clear(): void {
		this.#dbInstance.exec(`
DELETE FROM memory_usage;
DELETE FROM memory_relations;
DELETE FROM memory_events;
DELETE FROM memory_hypotheses;
DELETE FROM memory_skills;
DELETE FROM memory_items;
DELETE FROM memory_sources;
DELETE FROM memory_jobs;
DELETE FROM memory_scopes;
`);
	}

	async renderArtifacts(): Promise<void> {
		await fs.mkdir(this.root, { recursive: true });
		await this.#renderScopeArtifacts(staticNexusScope("global"), path.join(this.root, "global"));
		await this.#renderScopeArtifacts(staticNexusScope("user"), path.join(this.root, "user"));
		await this.#renderScopeArtifacts(staticNexusScope("knowledge"), path.join(this.root, "knowledge"));
		await this.#renderScopeArtifacts(staticNexusScope("failure"), path.join(this.root, "failures"));
		await this.#renderScopeArtifacts(this.scope, this.artifactRoot);
	}

	get db(): Database {
		return this.#dbInstance;
	}

	get #dbInstance(): Database {
		if (!this.#db) this.#db = openNexusDb(this.dbPath);
		return this.#db;
	}

	#findExact(scopeId: string, target: NexusMemoryTarget, content: string): NexusMemoryEntry | null {
		const row = this.#dbInstance
			.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE mi.scope_id = ? AND mi.target = ? AND mi.content = ? AND mi.status != 'deleted' LIMIT 1`)
			.get(scopeId, target, content) as MemoryRow | undefined;
		return row ? mapRow(row) : null;
	}

	#findContaining(scopeId: string, target: NexusMemoryTarget, text: string, activeOnly: boolean): NexusMemoryEntry[] {
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}
FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id
WHERE mi.scope_id = ? AND mi.target = ? AND mi.content LIKE ? ESCAPE '\\' ${activeOnly ? "AND mi.status = 'active'" : ""}
ORDER BY mi.created_at ASC
`)
			.all(scopeId, target, `%${escapeLikePattern(text)}%`) as MemoryRow[];
		return rows.map(mapRow);
	}

	#getById(id: string): NexusMemoryEntry | null {
		const row = this.#dbInstance
			.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE mi.id = ? LIMIT 1`)
			.get(id) as MemoryRow | undefined;
		return row ? mapRow(row) : null;
	}

	#fallbackLikeSearch(query: string, scopes: NexusScope[] | undefined, input: NexusSearchInput, limit: number): NexusMemoryEntry[] {
		const params: Array<string | number | null> = [`%${escapeLikePattern(query)}%`];
		const conditions = ["mi.content LIKE ? ESCAPE '\\'"];
		appendScopeConditions(conditions, params, scopes);
		if (!input.includeHistory) conditions.push("mi.status = 'active'");
		params.push(limit);
		const rows = this.#dbInstance
			.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE ${conditions.join(" AND ")} ORDER BY mi.updated_at DESC LIMIT ?`)
			.all(...params) as MemoryRow[];
		return rows.map(mapRow);
	}

	#fallbackTokenSearch(query: string, scopes: NexusScope[] | undefined, input: NexusSearchInput, limit: number): NexusMemoryEntry[] {
		const tokens = tokenizeSearchQuery(query).slice(0, 8);
		if (tokens.length === 0) return [];
		const params: Array<string | number | null> = tokens.map(token => `%${escapeLikePattern(token)}%`);
		const conditions = [`(${tokens.map(() => "mi.content LIKE ? ESCAPE '\\'").join(" OR ")})`];
		appendScopeConditions(conditions, params, scopes);
		if (!input.includeHistory) conditions.push("mi.status = 'active'");
		if (input.target) {
			conditions.push(input.target === "memory" ? "mi.target IN ('memory', 'project', 'knowledge')" : "mi.target = ?");
			if (input.target !== "memory") params.push(input.target);
		}
		params.push(Math.min(50, Math.max(limit, limit * 3)));
		const rows = this.#dbInstance
			.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE ${conditions.join(" AND ")} ORDER BY mi.updated_at DESC LIMIT ?`)
			.all(...params) as MemoryRow[];
		const minMatches = Math.min(2, tokens.length);
		return rows
			.map(mapRow)
			.map(entry => {
				const matches = tokens.reduce((sum, token) => sum + (entry.content.toLowerCase().includes(token) ? 1 : 0), 0);
				return {
					entry,
					matches,
					score: matches + confidenceBoost(entry) + goalBoost(entry, input.goal),
				};
			})
			.filter(item => item.matches >= minMatches)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map(item => item.entry);
	}

	#logEvent(memoryId: string | null, eventType: string, source: string, before: NexusMemoryEntry | null, after: NexusMemoryEntry | null): void {
		this.#dbInstance
			.prepare("INSERT INTO memory_events (id, memory_id, event_type, source, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run(crypto.randomUUID(), memoryId, eventType, source, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, isoNow());
	}

	async #renderScopeArtifacts(scope: NexusScope, root: string): Promise<void> {
		this.ensureScope(scope);
		await fs.mkdir(root, { recursive: true });
		const entries = this.#listScopeEntries(scope.id);
		const skills = this.#listSkills(scope.id);
		const title = scopeTitle(scope);
		await Promise.all([
			Bun.write(path.join(root, "MEMORY.md"), renderMarkdown(title, entries)),
			Bun.write(path.join(root, "memory_summary.md"), renderSummary(scope, entries, skills)),
			Bun.write(path.join(root, "FAILURES.md"), renderMarkdown(`${title} FAILURES`, entries.filter(entry => entry.target === "failure"))),
		]);
		const skillsDir = path.join(root, "skills");
		await fs.mkdir(skillsDir, { recursive: true });
		const keep = new Set<string>();
		for (const skill of skills) {
			keep.add(skill.name);
			const skillDir = path.join(skillsDir, skill.name);
			await fs.mkdir(skillDir, { recursive: true });
			await Bun.write(path.join(skillDir, "SKILL.md"), renderSkillMarkdown(skill));
		}
		const existing = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as Awaited<ReturnType<typeof fs.readdir>>);
		for (const dirent of existing) {
			if (!dirent.isDirectory()) continue;
			const dirName = dirent.name.toString();
			if (keep.has(dirName)) continue;
			await fs.rm(path.join(skillsDir, dirName), { recursive: true, force: true });
		}
	}

	#listScopeEntries(scopeId: string): NexusMemoryEntry[] {
		const rows = this.#dbInstance
			.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE mi.scope_id = ? AND mi.status = 'active' ORDER BY COALESCE(mi.last_used_at, mi.updated_at) DESC, mi.id DESC`)
			.all(scopeId) as MemoryRow[];
		return rows.map(mapRow);
	}

	#listSkills(scopeId: string): Array<{ name: string; content: string; status: string; sourceMemoryIds: string[] }> {
		const rows = this.#dbInstance
			.prepare("SELECT name, content, status, source_memory_ids FROM memory_skills WHERE scope_id = ? AND status IN ('draft', 'active', 'validated') ORDER BY updated_at DESC, name ASC")
			.all(scopeId) as Array<{ name: string; content: string; status: string; source_memory_ids: string }>;
		return rows.map(row => ({
			name: row.name,
			content: row.content,
			status: row.status,
			sourceMemoryIds: parseJsonStringArray(row.source_memory_ids),
		}));
	}

	/**
	 * Cosine-similarity duplicate pass. Walks scope+target groups of active
	 * entries that share an embedding model and dimension, and marks any pair
	 * with cosine ≥ `threshold` as duplicates of one another. The older /
	 * higher-confidence entry wins; the loser is `superseded` and a
	 * `duplicate_of` relation is recorded. Pairs are skipped when both have
	 * already been chained, so the pass is idempotent.
	 */
	#markSemanticDuplicates(threshold: number): number {
		if (threshold <= 0 || threshold > 1) return 0;
		const rows = this.#dbInstance
			.prepare(`
SELECT ${MEMORY_COLUMNS}, mi.embedding AS embedding, mi.embedding_model AS embedding_model, mi.embedding_dim AS embedding_dim
FROM memory_items mi
JOIN memory_scopes s ON s.id = mi.scope_id
WHERE mi.status = 'active' AND mi.embedding IS NOT NULL
`)
			.all() as Array<MemoryRow & { embedding: Uint8Array | null; embedding_model: string | null; embedding_dim: number | null }>;
		const buckets = new Map<string, Array<{ entry: NexusMemoryEntry; vector: Float32Array }>>();
		for (const row of rows) {
			const vector = bufferToVector(row.embedding);
			if (vector.length === 0) continue;
			const key = `${row.scope_id}::${row.target}::${row.embedding_model ?? ""}::${row.embedding_dim ?? vector.length}`;
			const bucket = buckets.get(key);
			if (bucket) bucket.push({ entry: mapRow(row), vector });
			else buckets.set(key, [{ entry: mapRow(row), vector }]);
		}
		let merged = 0;
		const superseded = new Set<string>();
		for (const bucket of buckets.values()) {
			if (bucket.length < 2) continue;
			bucket.sort((a, b) => rankForCanonical(a.entry) - rankForCanonical(b.entry));
			for (let i = 0; i < bucket.length; i += 1) {
				const canonical = bucket[i];
				if (superseded.has(canonical.entry.id)) continue;
				for (let j = i + 1; j < bucket.length; j += 1) {
					const candidate = bucket[j];
					if (superseded.has(candidate.entry.id)) continue;
					if (canonical.vector.length !== candidate.vector.length) continue;
					const score = cosineSimilarity(canonical.vector, candidate.vector);
					if (score < threshold) continue;
					const now = isoNow();
					this.#dbInstance.prepare("UPDATE memory_items SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(now, now, candidate.entry.id);
					this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations (from_id, to_id, relation, created_at) VALUES (?, ?, 'duplicate_of', ?)").run(candidate.entry.id, canonical.entry.id, now);
					this.#logEvent(candidate.entry.id, "semantic_duplicate", "nexus_self_healing", candidate.entry, this.#getById(candidate.entry.id));
					superseded.add(candidate.entry.id);
					merged += 1;
				}
			}
		}
		return merged;
	}

	#markDuplicates(): number {
		const rows = this.#dbInstance.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE mi.status = 'active'`).all() as MemoryRow[];
		const groups = new Map<string, NexusMemoryEntry[]>();
		for (const row of rows) {
			const entry = mapRow(row);
			const key = `${entry.scopeId}::${entry.target}::${normalizeForDuplicate(entry.content)}`;
			const bucket = groups.get(key);
			if (bucket) bucket.push(entry);
			else groups.set(key, [entry]);
		}
		let changed = 0;
		for (const entries of groups.values()) {
			if (entries.length < 2) continue;
			entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
			const canonical = entries[0];
			for (const duplicate of entries.slice(1)) {
				this.#dbInstance.prepare("UPDATE memory_items SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(isoNow(), isoNow(), duplicate.id);
				this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations (from_id, to_id, relation, created_at) VALUES (?, ?, 'duplicate_of', ?)").run(duplicate.id, canonical.id, isoNow());
				changed += 1;
			}
		}
		return changed;
	}

	#markStaleImported(): number {
		const result = this.#dbInstance.prepare("UPDATE memory_items SET staleness = 'needs_refresh', updated_at = ? WHERE status = 'active' AND confidence = 'imported_unverified' AND staleness = 'unknown'").run(isoNow());
		return Number(result.changes ?? 0);
	}

	#detectTextContradictions(): number {
		const rows = this.#dbInstance.prepare(`SELECT ${MEMORY_COLUMNS}, mi.embedding AS embedding, mi.embedding_model AS embedding_model FROM memory_items mi JOIN memory_scopes s ON s.id = mi.scope_id WHERE mi.status = 'active'`).all() as Array<MemoryRow & { embedding: Uint8Array | null; embedding_model: string | null }>;
		const groups = new Map<string, Array<NexusMemoryEntry & { vector?: Float32Array }>>();
		for (const row of rows) {
			const entry = mapRow(row);
			const vector = bufferToVector(row.embedding);
			const key = `${entry.scopeId}::${entry.target}::${entry.memoryType}::${extractSubjectKey(entry.content)}`;
			const bucket = groups.get(key);
			const enriched = { ...entry, vector: vector.length > 0 ? vector : undefined };
			if (bucket) bucket.push(enriched);
			else groups.set(key, [enriched]);
		}
		const threshold = this.#contradictionThreshold;
		let changed = 0;
		for (const entries of groups.values()) {
			if (entries.length < 2) continue;
			for (let i = 0; i < entries.length; i += 1) {
				for (let j = i + 1; j < entries.length; j += 1) {
					if (entries[i].content === entries[j].content) continue;
					const score = scoreContradictionLikelihood(entries[i], entries[j]);
					if (score < threshold) continue;
					this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations (from_id, to_id, relation, created_at) VALUES (?, ?, 'contradicts', ?)").run(entries[i].id, entries[j].id, isoNow());
					this.#dbInstance.prepare("INSERT OR IGNORE INTO memory_relations (from_id, to_id, relation, created_at) VALUES (?, ?, 'contradicts', ?)").run(entries[j].id, entries[i].id, isoNow());
					changed += 1;
				}
			}
		}
		return changed;
	}

	#detectScopeLeaks(): number {
		const result = this.#dbInstance.prepare("UPDATE memory_items SET status = 'quarantined', updated_at = ? WHERE status = 'active' AND ((target = 'project' AND scope_id NOT LIKE 'project:%') OR (target = 'user' AND scope_id != 'user'))").run(isoNow());
		return Number(result.changes ?? 0);
	}

	#promoteRepeatedSkillCandidates(): number {
		const rows = this.#dbInstance
			.prepare(`SELECT mi.id, mi.scope_id, mi.content, mi.memory_type FROM memory_items mi WHERE mi.status = 'active' AND mi.memory_type IN ('workflow', 'skill_candidate', 'command') ORDER BY mi.scope_id, mi.created_at`)
			.all() as Array<{ id: string; scope_id: string; content: string; memory_type: string }>;
		const byScope = new Map<string, Array<{ id: string; content: string; memory_type: string }>>();
		for (const row of rows) {
			const bucket = byScope.get(row.scope_id);
			if (bucket) bucket.push({ id: row.id, content: row.content, memory_type: row.memory_type });
			else byScope.set(row.scope_id, [{ id: row.id, content: row.content, memory_type: row.memory_type }]);
		}
		let created = 0;
		for (const [scopeId, entries] of byScope) {
			if (entries.length < 2 && !entries.some(entry => entry.memory_type === "skill_candidate")) continue;
			const name = sanitizeSkillName(entries[0]?.content ?? "memory-skill");
			const existing = this.#dbInstance.prepare("SELECT id FROM memory_skills WHERE scope_id = ? AND name = ?").get(scopeId, name) as { id: string } | undefined;
			const now = isoNow();
			const content = buildSkillContent(name, entries.map(entry => entry.content));
			const sourceMemoryIds = JSON.stringify(entries.map(entry => entry.id));
			if (existing) {
				this.#dbInstance.prepare("UPDATE memory_skills SET content = ?, status = 'active', source_memory_ids = ?, updated_at = ? WHERE id = ?").run(content, sourceMemoryIds, now, existing.id);
				continue;
			}
			this.#dbInstance.prepare("INSERT INTO memory_skills (id, scope_id, name, content, status, source_memory_ids, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)").run(crypto.randomUUID(), scopeId, name, content, sourceMemoryIds, now, now);
			created += 1;
		}
		return created;
	}
}

function scanNexusContent(content: string): string | null {
	return containsSecretLikeValue(content)
		? "Content looks like it may contain a secret; refusing to persist durable memory."
		: null;
}

function containsSecretLikeValue(content: string): boolean {
	return /(api[_-]?key|secret|token|password|passwd)[^\n]{0,40}[=:][^\s]+/i.test(content);
}

function inferMemoryType(target: NexusMemoryTarget, category?: NexusMemoryCategory | null): NexusMemoryType {
	if (target === "failure" || category === "failure" || category === "correction") return "failure";
	if (target === "user" || category === "preference") return "preference";
	if (category === "tool-quirk") return "tool_quirk";
	if (target === "project") return "project_convention";
	if (target === "knowledge") return "workflow";
	return "imported";
}

function normalizeCategory(value: NexusMemoryCategory | null | undefined): NexusMemoryCategory | null {
	return value && CATEGORY_VALUES.has(value) ? value : null;
}

function appendScopeConditions(conditions: string[], params: Array<string | number | null>, scopes: NexusScope[] | undefined): void {
	if (!scopes || scopes.length === 0) return;
	conditions.push(`mi.scope_id IN (${scopes.map(() => "?").join(", ")})`);
	for (const scope of scopes) params.push(scope.id);
}

function rankForGoal(entries: NexusMemoryEntry[], goal: string | undefined): NexusMemoryEntry[] {
	if (!goal?.trim() || entries.length < 2) return entries;
	return [...entries].sort((a, b) => goalBoost(b, goal) - goalBoost(a, goal));
}

function goalBoost(entry: NexusMemoryEntry, goal: string | undefined): number {
	const goalTokens = tokenizeForGoal(goal ?? "");
	if (goalTokens.length === 0) return 0;
	const contentTokens = new Set(tokenizeForGoal(entry.content));
	let overlap = 0;
	for (const token of goalTokens) if (contentTokens.has(token)) overlap += 1;
	if (overlap === 0) return 0;
	const coverage = overlap / Math.max(1, goalTokens.length);
	const targetBoost = entry.target === "project" || entry.target === "knowledge" ? 0.04 : 0;
	return Math.min(0.35, coverage * 0.3 + targetBoost);
}

function tokenizeForGoal(value: string): string[] {
	return [
		...new Set(
			value
				.toLowerCase()
				.split(/[^a-z0-9_.:-]+/)
				.filter(token => token.length >= 3 && !GOAL_STOP_WORDS.has(token)),
		),
	];
}

function tokenizeSearchQuery(value: string): string[] {
	return [
		...new Set(
			(value.toLowerCase().match(/[\p{L}\p{N}_.:-]{3,}/gu) ?? []).filter(token => !GOAL_STOP_WORDS.has(token)),
		),
	];
}

const GOAL_STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "about", "how", "why", "what", "when", "where", "which", "work", "future", "현재", "목표", "진행", "구현"]);

function confidenceBoost(entry: NexusMemoryEntry): number {
	let boost = 0;
	if (entry.confidence === "tool_verified") boost += 0.08;
	else if (entry.confidence === "user_asserted") boost += 0.04;
	else if (entry.confidence === "imported_unverified") boost -= 0.04;
	if (entry.status !== "active") boost -= 0.2;
	if (entry.staleness === "stale") boost -= 0.08;
	else if (entry.staleness === "needs_refresh") boost -= 0.04;
	return boost;
}

function rankForCanonical(entry: NexusMemoryEntry): number {
	const confidenceRank: Record<string, number> = {
		tool_verified: 0,
		user_asserted: 1,
		inferred: 2,
		imported_unverified: 3,
		hypothesis: 4,
	};
	const base = confidenceRank[entry.confidence] ?? 5;
	// Older entries (smaller createdAt timestamps) win ties so the canonical
	// is the established memory rather than the most recent restatement.
	return base * 1_000_000_000_000 + Date.parse(entry.createdAt);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(max, Math.floor(value)));
}

function escapeFts5Query(query: string): string {
	if (/\b(OR|AND|NOT|NEAR)\b/.test(query)) return query;
	return `"${query.replace(/"/g, '""')}"`;
}

function escapeLikePattern(text: string): string {
	return text.replace(/[\\%_]/g, "\\$&");
}

function mapRow(row: MemoryRow): NexusMemoryEntry {
	return {
		id: row.id,
		scopeId: row.scope_id,
		scopeKind: row.scope_kind,
		scopeKey: row.scope_key,
		displayName: row.display_name,
		cwd: row.cwd,
		gitOrigin: row.git_origin,
		target: row.target,
		category: row.category,
		memoryType: row.memory_type,
		content: row.content,
		provenance: row.provenance,
		confidence: row.confidence,
		staleness: row.staleness,
		status: row.status,
		usageCount: row.usage_count,
		lastUsedAt: row.last_used_at,
		lastVerifiedAt: row.last_verified_at,
		validFrom: row.valid_from,
		validTo: row.valid_to,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function renderMarkdown(title: string, entries: NexusMemoryEntry[]): string {
	if (entries.length === 0) return `# ${title}\n\n_No entries._\n`;
	const lines = [`# ${title}`, ""];
	for (const entry of entries) {
		const meta = [
			`id=${entry.id}`,
			`scope=${entry.scopeKind}`,
			`target=${entry.target}`,
			`confidence=${entry.confidence}`,
			`staleness=${entry.staleness}`,
		].join(", ");
		const category = entry.category ? ` [${entry.category}]` : "";
		lines.push(`- ${entry.content}${category} <!-- ${meta} -->`);
	}
	lines.push("");
	return lines.join("\n");
}

function renderSummary(
	scope: NexusScope,
	entries: NexusMemoryEntry[],
	skills: Array<{ name: string; content: string; status: string; sourceMemoryIds: string[] }>,
): string {
	const lines = [
		"v1",
		"",
		"## User Profile",
		scope.kind === "project"
			? `Project scope ${scope.displayName}${scope.gitOrigin ? ` (${scope.gitOrigin})` : ""}.`
			: `Scope ${scope.displayName}.`,
		"",
		"## User preferences",
	];
	const preferences = entries.filter(entry => entry.target === "user" || entry.category === "preference");
	if (preferences.length === 0) lines.push("- No stored user preferences.");
	else for (const entry of preferences.slice(0, 8)) lines.push(`- ${truncateChars(entry.content, 160)}`);
	lines.push("", "## General Tips");
	const tips = entries.filter(entry => entry.target !== "user" && entry.target !== "failure");
	if (tips.length === 0) lines.push("- No stored general tips.");
	else for (const entry of tips.slice(0, 8)) lines.push(`- ${truncateChars(entry.content, 160)}`);
	lines.push("", "## What's in Memory", "", `### ${scope.displayName}`, "", `#### ${isoToday()}`);
	const topicEntries = entries.slice(0, 12);
	if (topicEntries.length === 0) {
		lines.push("- No active memory topics.");
	} else {
		for (const entry of topicEntries) {
			const keywords = extractKeywords(entry.content).slice(0, 5).join(", ");
			lines.push(`- ${topicLabel(entry)}: ${keywords || entry.memoryType}`);
			lines.push(`  - desc: ${truncateChars(entry.content, 140)}`);
			lines.push(`  - learnings: confidence=${entry.confidence}; staleness=${entry.staleness}`);
		}
	}
	if (skills.length > 0) {
		lines.push("", "### Skills", "");
		for (const skill of skills.slice(0, 12)) lines.push(`- skills/${skill.name}/SKILL.md`);
	}
	lines.push("");
	return lines.join("\n");
}

function renderSkillMarkdown(skill: { name: string; content: string; status: string; sourceMemoryIds: string[] }): string {
	return [
		"---",
		`name: ${skill.name}`,
		"description: Generated from repeated verified memory evidence",
		"user-invocable: false",
		"disable-model-invocation: true",
		"---",
		"",
		"## Procedure",
		"",
		skill.content.trim(),
		"",
		"## Sources",
		"",
		...skill.sourceMemoryIds.map(id => `- ${id}`),
		"",
	].join("\n");
}

export interface PipelineStageRecord {
	kind: string;
	jobKey: string;
	stage: string;
	durationMs: number;
	llmCalls?: number;
	embedCalls?: number;
	status: "success" | "failure";
	lastError?: string;
}

export function recordPipelineStage(db: Database, rec: PipelineStageRecord): void {
	const now = Date.now();
	db.prepare(`INSERT INTO memory_jobs (kind, job_key, scope_id, status, started_at, finished_at, retry_remaining, last_error, stage, duration_ms, llm_calls, embed_calls)
		VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?)
		ON CONFLICT(kind, job_key) DO UPDATE SET status=excluded.status, finished_at=excluded.finished_at, last_error=excluded.last_error, stage=excluded.stage, duration_ms=excluded.duration_ms, llm_calls=excluded.llm_calls, embed_calls=excluded.embed_calls`).run(
		rec.kind,
		rec.jobKey,
		rec.status,
		now - rec.durationMs,
		now,
		rec.lastError ?? null,
		rec.stage,
		rec.durationMs,
		rec.llmCalls ?? 0,
		rec.embedCalls ?? 0,
	);
}

export type RuntimeEventSeverity = "info" | "warn" | "error";

export interface RuntimeEventInput {
	kind: string;
	severity: RuntimeEventSeverity;
	message: string;
	context?: Record<string, unknown>;
}

export interface RuntimeEventRow extends RuntimeEventInput {
	id: number;
	createdAt: string;
}

export function recordRuntimeEvent(db: Database, event: RuntimeEventInput): void {
	try {
		db.prepare(
			`INSERT INTO memory_runtime_events(kind, severity, message, context_json, created_at) VALUES (?, ?, ?, ?, ?)`,
		).run(
			event.kind,
			event.severity,
			event.message.slice(0, 4000),
			event.context ? JSON.stringify(event.context).slice(0, 8000) : null,
			new Date().toISOString(),
		);
	} catch {
		// Never let an event recorder failure cascade.
	}
}

export function recentRuntimeEvents(db: Database, limit = 50): RuntimeEventRow[] {
	const rows = db
		.prepare(`SELECT id, kind, severity, message, context_json, created_at FROM memory_runtime_events ORDER BY id DESC LIMIT ?`)
		.all(limit) as Array<{ id: number; kind: string; severity: string; message: string; context_json: string | null; created_at: string }>;
	return rows.map(row => ({
		id: row.id,
		kind: row.kind,
		severity: row.severity as RuntimeEventSeverity,
		message: row.message,
		context: row.context_json ? safeParse(row.context_json) : undefined,
		createdAt: row.created_at,
	}));
}

function safeParse(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

export interface StageStat {
	stage: string;
	count: number;
	avgDurationMs: number;
	p95DurationMs: number;
	totalLlmCalls: number;
	totalEmbedCalls: number;
	lastError: string | null;
}

export function recentStageStats(db: Database, limit = 50): StageStat[] {
	const rows = db.prepare("SELECT stage, duration_ms, llm_calls, embed_calls, last_error FROM memory_jobs WHERE stage IS NOT NULL ORDER BY finished_at DESC LIMIT ?").all(limit) as Array<{
		stage: string | null;
		duration_ms: number | null;
		llm_calls: number;
		embed_calls: number;
		last_error: string | null;
	}>;
	const byStage = new Map<string, { durations: number[]; llm: number; embed: number; lastError: string | null }>();
	for (const row of rows) {
		if (!row.stage) continue;
		const acc = byStage.get(row.stage) ?? { durations: [], llm: 0, embed: 0, lastError: null };
		if (typeof row.duration_ms === "number") acc.durations.push(row.duration_ms);
		acc.llm += row.llm_calls;
		acc.embed += row.embed_calls;
		if (row.last_error && !acc.lastError) acc.lastError = row.last_error;
		byStage.set(row.stage, acc);
	}
	const out: StageStat[] = [];
	for (const [stage, acc] of byStage) {
		const sorted = [...acc.durations].sort((a, b) => a - b);
		const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
		const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
		out.push({ stage, count: sorted.length, avgDurationMs: Math.round(avg), p95DurationMs: p95, totalLlmCalls: acc.llm, totalEmbedCalls: acc.embed, lastError: acc.lastError });
	}
	return out;
}

function topicLabel(entry: NexusMemoryEntry): string {
	return extractSubjectKey(entry.content) || entry.memoryType;
}

function extractKeywords(content: string): string[] {
	return [...new Set(content.toLowerCase().split(/[^a-z0-9_./-]+/).filter(token => token.length >= 4))];
}

function normalizeForDuplicate(content: string): string {
	return content.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractSubjectKey(content: string): string {
	return content.split(/[:\-–—]/, 1)[0]?.trim().toLowerCase().slice(0, 80) ?? "";
}

function scoreContradictionLikelihood(
	a: { content: string; confidence: string; vector?: Float32Array },
	b: { content: string; confidence: string; vector?: Float32Array },
): number {
	let score = 0.5;
	const hasA = !!(a.vector && a.vector.length > 0);
	const hasB = !!(b.vector && b.vector.length > 0);
	if (hasA && hasB && a.vector!.length === b.vector!.length) {
		const cos = cosineSimilarity(a.vector!, b.vector!);
		if (cos >= 0.7) score += 0.3;
		else if (cos >= 0.5) score += 0.15;
		else if (cos < 0.3) score -= 0.3;
	} else if (!hasA && !hasB) {
		// No embeddings on either side: lexical subject-key match is the only signal.
		// Trust it as strong evidence so callers without embeddings still surface contradictions.
		score = 0.85;
	}
	// One-sided embedding gives no useful comparison; keep baseline 0.5.
	if (a.confidence === "imported_unverified" || b.confidence === "imported_unverified") score -= 0.1;
	return Math.max(0, Math.min(1, score));
}

function parseJsonStringArray(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function sanitizeSkillName(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "memory-skill";
}

function buildSkillContent(name: string, entries: string[]): string {
	return [
		`Generated skill ${name}.`,
		"",
		"When to use:",
		...entries.slice(0, 6).map(entry => `- ${truncateChars(entry, 160)}`),
		"",
		"Verification:",
		"- Confirm the current project/repo evidence still supports these steps before use.",
	].join("\n");
}

function hashString(value: string): string {
	return Bun.hash(value).toString(16);
}

function truncateChars(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function isoNow(): string {
	return new Date().toISOString();
}

function isoToday(): string {
	return new Date().toISOString().slice(0, 10);
}

function scopeTitle(scope: NexusScope): string {
	switch (scope.kind) {
		case "project":
			return "PROJECT MEMORY";
		case "user":
			return "USER MEMORY";
		case "failure":
			return "FAILURE MEMORY";
		case "knowledge":
			return "KNOWLEDGE MEMORY";
		case "session":
			return "SESSION MEMORY";
		case "global":
			return "GLOBAL MEMORY";
	}
}
