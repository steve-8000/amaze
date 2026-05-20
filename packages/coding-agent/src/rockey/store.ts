import { Database } from "bun:sqlite";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getMemoriesDir } from "@amaze/utils";
import { scanRockeyContent } from "./content-scanner";
import type {
	RockeyMemoryCategory,
	RockeyMemoryEntry,
	RockeyMemoryTarget,
	RockeyMutationResult,
	RockeyScope,
	RockeyStoredTarget,
} from "./types";

const GLOBAL_SCOPE: RockeyScope = { kind: "global", key: null, displayName: "global", cwd: null };
const CATEGORY_VALUES = new Set<RockeyMemoryCategory>([
	"failure",
	"correction",
	"insight",
	"preference",
	"convention",
	"tool-quirk",
]);

interface RockeyStoreOptions {
	agentDir: string;
	cwd: string;
}

interface AddMemoryInput {
	target: RockeyMemoryTarget;
	content: string;
	category?: RockeyMemoryCategory | null;
	failureReason?: string | null;
	toolState?: string | null;
	correctedTo?: string | null;
	scope?: RockeyScope;
}

interface SearchMemoryInput {
	query: string;
	scope?: RockeyScope;
	target?: RockeyStoredTarget;
	category?: RockeyMemoryCategory;
	limit?: number;
	includeGlobal?: boolean;
}

interface ListMemoryInput {
	scope?: RockeyScope;
	target?: RockeyStoredTarget;
	limit?: number;
	includeGlobal?: boolean;
}

interface ReplaceMemoryInput {
	target: RockeyMemoryTarget;
	oldText: string;
	content: string;
	scope?: RockeyScope;
}

interface RemoveMemoryInput {
	target: RockeyMemoryTarget;
	oldText: string;
	scope?: RockeyScope;
}

interface RockeyStats {
	projectEntries: number;
	globalEntries: number;
	projectFailures: number;
	globalFailures: number;
}

interface MemoryRow {
	id: number;
	scope_kind: "global" | "project";
	scope_key: string | null;
	display_name: string;
	cwd: string | null;
	target: RockeyStoredTarget;
	category: RockeyMemoryCategory | null;
	content: string;
	failure_reason: string | null;
	tool_state: string | null;
	corrected_to: string | null;
	created_at: string;
	updated_at: string;
	last_referenced_at: string;
}

export function resolveRockeyScope(cwd: string): RockeyScope {
	const normalized = path.resolve(cwd);
	return {
		kind: "project",
		key: Bun.hash(normalized).toString(16),
		displayName: path.basename(normalized) || normalized,
		cwd: normalized,
	};
}

export function getRockeyDbPath(agentDir: string): string {
	return path.join(getMemoriesDir(agentDir), "rockey", "rockey.db");
}

export class RockeyStore {
	readonly artifactRoot: string;
	readonly scope: RockeyScope;
	readonly dbPath: string;
	#db?: Database;

	constructor(readonly options: RockeyStoreOptions) {
		this.scope = resolveRockeyScope(options.cwd);
		this.dbPath = getRockeyDbPath(options.agentDir);
		this.artifactRoot = getRockeyArtifactRoot(options.agentDir, options.cwd);
	}

	close(): void {
		this.#db?.close(false);
		this.#db = undefined;
	}

	add(input: AddMemoryInput): RockeyMutationResult {
		const content = input.content.trim();
		if (!content) return { success: false, error: "Content cannot be empty." };
		const scanError = scanRockeyContent(content);
		if (scanError) return { success: false, error: scanError };

		const storedTarget = storedTargetFor(input.target);
		const scope = scopeForTarget(input.target, input.scope ?? this.scope);
		const now = today();
		const category = normalizeCategory(input.category);
		const existing = this.#findExact(scope, storedTarget, content);
		if (existing) {
			this.#dbInstance
				.prepare("UPDATE memories SET last_referenced_at = ?, updated_at = ? WHERE id = ?")
				.run(now, now, existing.id);
			this.#logEvent(existing.id, "touch", "memory_tool", existing, this.#getById(existing.id) ?? existing);
			return {
				success: true,
				message: "Entry already exists; refreshed last referenced date.",
				target: input.target,
				entry: this.#getById(existing.id) ?? existing,
			};
		}

		const result = this.#dbInstance
			.prepare(`
				INSERT INTO memories (
					scope_kind, scope_key, display_name, cwd, target, category, content,
					failure_reason, tool_state, corrected_to, created_at, updated_at, last_referenced_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				scope.kind,
				scope.key,
				scope.displayName,
				scope.cwd,
				storedTarget,
				category,
				content,
				normalizeNullable(input.failureReason),
				normalizeNullable(input.toolState),
				normalizeNullable(input.correctedTo),
				now,
				now,
				now,
			);
		const inserted = this.#getById(Number(result.lastInsertRowid)) ?? undefined;
		if (inserted) this.#logEvent(inserted.id, "add", "memory_tool", null, inserted);

		return {
			success: true,
			message: "Entry added.",
			target: input.target,
			entry: inserted,
		};
	}

	replace(input: ReplaceMemoryInput): RockeyMutationResult {
		const oldText = input.oldText.trim();
		const content = input.content.trim();
		if (!oldText) return { success: false, error: "old_text cannot be empty." };
		if (!content) return { success: false, error: "content cannot be empty. Use remove to delete entries." };
		const scanError = scanRockeyContent(content);
		if (scanError) return { success: false, error: scanError };

		const matches = this.#findContaining(
			scopeForTarget(input.target, input.scope ?? this.scope),
			storedTargetFor(input.target),
			oldText,
		);
		if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
		if (matches.length > 1)
			return { success: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, entries: matches };

		const now = today();
		this.#dbInstance
			.prepare("UPDATE memories SET content = ?, updated_at = ?, last_referenced_at = ? WHERE id = ?")
			.run(content, now, now, matches[0].id);
		const updated = this.#getById(matches[0].id) ?? undefined;
		if (updated) this.#logEvent(matches[0].id, "replace", "memory_tool", matches[0], updated);
		return {
			success: true,
			message: "Entry replaced.",
			target: input.target,
			entry: updated,
		};
	}

	remove(input: RemoveMemoryInput): RockeyMutationResult {
		const oldText = input.oldText.trim();
		if (!oldText) return { success: false, error: "old_text cannot be empty." };

		const matches = this.#findContaining(
			scopeForTarget(input.target, input.scope ?? this.scope),
			storedTargetFor(input.target),
			oldText,
		);
		if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
		if (matches.length > 1)
			return { success: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, entries: matches };

		this.#dbInstance.prepare("DELETE FROM memories WHERE id = ?").run(matches[0].id);
		this.#logEvent(matches[0].id, "remove", "memory_tool", matches[0], null);
		return { success: true, message: "Entry removed.", target: input.target };
	}

	search(input: SearchMemoryInput): RockeyMemoryEntry[] {
		const query = input.query.trim();
		if (!query) return [];
		const limit = clampLimit(input.limit, 10, 20);
		const params: Array<string | number | null> = [escapeFts5Query(query)];
		const conditions = ["m.rowid IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)"];
		appendScopeConditions(conditions, params, input.scope, input.includeGlobal ?? true);
		if (input.target) {
			conditions.push("m.target = ?");
			params.push(input.target);
		}
		if (input.category) {
			conditions.push("m.category = ?");
			params.push(input.category);
		}
		params.push(limit);

		try {
			const rows = this.#dbInstance
				.prepare(`
					SELECT ${MEMORY_COLUMNS}
					FROM memories m
					WHERE ${conditions.join(" AND ")}
					ORDER BY m.last_referenced_at DESC, m.id DESC
					LIMIT ?
				`)
				.all(...params) as MemoryRow[];
			return rows.map(mapRow);
		} catch {
			return [];
		}
	}

	list(input: ListMemoryInput = {}): RockeyMemoryEntry[] {
		const limit = clampLimit(input.limit, 20, 200);
		const params: Array<string | number | null> = [];
		const conditions: string[] = [];
		appendScopeConditions(conditions, params, input.scope, input.includeGlobal ?? true);
		if (input.target) {
			conditions.push("target = ?");
			params.push(input.target);
		}
		params.push(limit);
		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = this.#dbInstance
			.prepare(`
				SELECT ${MEMORY_COLUMNS}
				FROM memories m
				${where}
				ORDER BY last_referenced_at DESC, id DESC
				LIMIT ?
			`)
			.all(...params) as MemoryRow[];
		return rows.map(mapRow);
	}

	stats(): RockeyStats {
		const countFor = (scopeKind: "global" | "project", target?: "failure"): number => {
			const row = this.#dbInstance
				.prepare(
					`SELECT COUNT(*) as count FROM memories WHERE scope_kind = ?${target ? " AND target = ?" : ""}${
						scopeKind === "project" ? " AND scope_key = ?" : ""
					}`,
				)
				.get(
					...(scopeKind === "project"
						? target
							? [scopeKind, target, this.scope.key]
							: [scopeKind, this.scope.key]
						: target
							? [scopeKind, target]
							: [scopeKind]),
				) as { count: number };
			return row.count;
		};
		return {
			projectEntries: countFor("project"),
			globalEntries: countFor("global"),
			projectFailures: countFor("project", "failure"),
			globalFailures: countFor("global", "failure"),
		};
	}

	clear(): void {
		this.#dbInstance.exec("DELETE FROM memories");
		this.#logEvent(null, "clear", "memory_tool", null, null);
	}

	async renderArtifacts(): Promise<void> {
		const projectEntries = this.list({ scope: this.scope, includeGlobal: false, limit: 200 });
		const globalEntries = this.list({ scope: GLOBAL_SCOPE, includeGlobal: false, limit: 200 });
		await fs.mkdir(this.artifactRoot, { recursive: true });
		await Promise.all([
			Bun.write(
				path.join(this.artifactRoot, "MEMORY.md"),
				renderMarkdown(
					"PROJECT MEMORY",
					projectEntries.filter(entry => entry.target === "memory"),
				),
			),
			Bun.write(
				path.join(this.artifactRoot, "USER.md"),
				renderMarkdown(
					"USER MEMORY",
					globalEntries.filter(entry => entry.target === "user"),
				),
			),
			Bun.write(
				path.join(this.artifactRoot, "FAILURES.md"),
				renderMarkdown(
					"FAILURE MEMORY",
					[...projectEntries, ...globalEntries].filter(entry => entry.target === "failure"),
				),
			),
			Bun.write(path.join(this.artifactRoot, "memory_summary.md"), renderSummary(projectEntries, globalEntries)),
		]);
	}

	get #dbInstance(): Database {
		if (!this.#db) {
			this.#db = openRockeyDb(this.dbPath);
		}
		return this.#db;
	}

	#logEvent(
		memoryId: number | null,
		eventType: "add" | "replace" | "remove" | "clear" | "touch",
		source: string,
		before: RockeyMemoryEntry | null,
		after: RockeyMemoryEntry | null,
	): void {
		this.#dbInstance
			.prepare(
				"INSERT INTO memory_events (memory_id, event_type, source, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				memoryId,
				eventType,
				source,
				before ? JSON.stringify(before) : null,
				after ? JSON.stringify(after) : null,
				new Date().toISOString(),
			);
	}

	#findExact(scope: RockeyScope, target: RockeyStoredTarget, content: string): RockeyMemoryEntry | null {
		const row = this.#dbInstance
			.prepare(`
				SELECT ${MEMORY_COLUMNS}
				FROM memories m
				WHERE scope_kind = ? AND COALESCE(scope_key, '') = COALESCE(?, '') AND target = ? AND content = ?
				LIMIT 1
			`)
			.get(scope.kind, scope.key, target, content) as MemoryRow | undefined;
		return row ? mapRow(row) : null;
	}

	#findContaining(scope: RockeyScope, target: RockeyStoredTarget, text: string): RockeyMemoryEntry[] {
		const rows = this.#dbInstance
			.prepare(`
				SELECT ${MEMORY_COLUMNS}
				FROM memories m
				WHERE scope_kind = ? AND COALESCE(scope_key, '') = COALESCE(?, '') AND target = ? AND content LIKE ? ESCAPE '\\'
				ORDER BY id ASC
			`)
			.all(scope.kind, scope.key, target, `%${escapeLikePattern(text)}%`) as MemoryRow[];
		return rows.map(mapRow);
	}

	#getById(id: number): RockeyMemoryEntry | null {
		const row = this.#dbInstance.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories m WHERE id = ?`).get(id) as
			| MemoryRow
			| undefined;
		return row ? mapRow(row) : null;
	}
}

const MEMORY_COLUMNS = [
	"m.id",
	"m.scope_kind",
	"m.scope_key",
	"m.display_name",
	"m.cwd",
	"m.target",
	"m.category",
	"m.content",
	"m.failure_reason",
	"m.tool_state",
	"m.corrected_to",
	"m.created_at",
	"m.updated_at",
	"m.last_referenced_at",
].join(", ");

function openRockeyDb(dbPath: string): Database {
	fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath, { create: true });
	db.exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA busy_timeout=5000;

		CREATE TABLE IF NOT EXISTS memories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'project')),
			scope_key TEXT,
			display_name TEXT NOT NULL,
			cwd TEXT,
			target TEXT NOT NULL CHECK (target IN ('memory', 'user', 'failure')),
			category TEXT CHECK (category IN ('failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk')),
			content TEXT NOT NULL,
			failure_reason TEXT,
			tool_state TEXT,
			corrected_to TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_referenced_at TEXT NOT NULL
		);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_rockey_memories_unique
		ON memories(scope_kind, COALESCE(scope_key, ''), target, content);

		CREATE INDEX IF NOT EXISTS idx_rockey_memories_scope ON memories(scope_kind, scope_key);
		CREATE INDEX IF NOT EXISTS idx_rockey_memories_target ON memories(target);
		CREATE INDEX IF NOT EXISTS idx_rockey_memories_category ON memories(category);
		CREATE INDEX IF NOT EXISTS idx_rockey_memories_last_ref ON memories(last_referenced_at);

		CREATE TABLE IF NOT EXISTS memory_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			memory_id INTEGER,
			event_type TEXT NOT NULL,
			source TEXT NOT NULL,
			before_json TEXT,
			after_json TEXT,
			created_at TEXT NOT NULL
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
			content,
			display_name,
			category,
			content='memories',
			content_rowid='id'
		);

		CREATE TRIGGER IF NOT EXISTS rockey_memories_ai AFTER INSERT ON memories BEGIN
			INSERT INTO memory_fts(rowid, content, display_name, category)
			VALUES (new.id, new.content, new.display_name, new.category);
		END;

		CREATE TRIGGER IF NOT EXISTS rockey_memories_ad AFTER DELETE ON memories BEGIN
			INSERT INTO memory_fts(memory_fts, rowid, content, display_name, category)
			VALUES ('delete', old.id, old.content, old.display_name, old.category);
		END;

		CREATE TRIGGER IF NOT EXISTS rockey_memories_au AFTER UPDATE ON memories BEGIN
			INSERT INTO memory_fts(memory_fts, rowid, content, display_name, category)
			VALUES ('delete', old.id, old.content, old.display_name, old.category);
			INSERT INTO memory_fts(rowid, content, display_name, category)
			VALUES (new.id, new.content, new.display_name, new.category);
		END;
	`);
	return db;
}

export function getRockeyArtifactRoot(agentDir: string, cwd: string): string {
	return path.join(getMemoriesDir(agentDir), encodeProjectPath(cwd));
}

function encodeProjectPath(cwd: string): string {
	return `--${path
		.resolve(cwd)
		.replace(/^[/\\]/, "")
		.replace(/[/\\:]/g, "-")}--`;
}

function storedTargetFor(target: RockeyMemoryTarget): RockeyStoredTarget {
	if (target === "project") return "memory";
	return target;
}

function scopeForTarget(target: RockeyMemoryTarget, projectScope: RockeyScope): RockeyScope {
	return target === "project" ? projectScope : GLOBAL_SCOPE;
}

function normalizeNullable(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function normalizeCategory(value: RockeyMemoryCategory | null | undefined): RockeyMemoryCategory | null {
	return value && CATEGORY_VALUES.has(value) ? value : null;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(max, Math.floor(value)));
}

function appendScopeConditions(
	conditions: string[],
	params: Array<string | number | null>,
	scope: RockeyScope | undefined,
	includeGlobal: boolean,
): void {
	if (!scope) return;
	if (scope.kind === "global") {
		conditions.push("m.scope_kind = 'global'");
		return;
	}
	if (includeGlobal) {
		conditions.push("(m.scope_kind = 'global' OR (m.scope_kind = 'project' AND m.scope_key = ?))");
		params.push(scope.key);
		return;
	}
	conditions.push("m.scope_kind = 'project' AND m.scope_key = ?");
	params.push(scope.key);
}

function escapeFts5Query(query: string): string {
	if (/\b(OR|AND|NOT|NEAR)\b/.test(query)) return query;
	return `"${query.replace(/"/g, '""')}"`;
}

function escapeLikePattern(text: string): string {
	return text.replace(/[\\%_]/g, "\\$&");
}

function mapRow(row: MemoryRow): RockeyMemoryEntry {
	return {
		id: row.id,
		scopeKind: row.scope_kind,
		scopeKey: row.scope_key,
		displayName: row.display_name,
		cwd: row.cwd,
		target: row.target,
		category: row.category,
		content: row.content,
		failureReason: row.failure_reason,
		toolState: row.tool_state,
		correctedTo: row.corrected_to,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastReferencedAt: row.last_referenced_at,
	};
}

function renderMarkdown(title: string, entries: RockeyMemoryEntry[]): string {
	if (entries.length === 0) return `# ${title}\n\n_No entries._\n`;
	const lines = [`# ${title}`, ""];
	for (const entry of entries) {
		const category = entry.category ? ` [${entry.category}]` : "";
		lines.push(
			`- ${entry.content}${category} <!-- id=${entry.id}, created=${entry.createdAt}, last=${entry.lastReferencedAt} -->`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

function renderSummary(projectEntries: RockeyMemoryEntry[], globalEntries: RockeyMemoryEntry[]): string {
	const lines = ["# Rockey Memory Summary", "", "This file is generated from the Rockey SQLite memory store.", ""];
	const userEntries = globalEntries.filter(entry => entry.target === "user");
	const globalMemoryEntries = globalEntries.filter(entry => entry.target === "memory");
	const projectMemoryEntries = projectEntries.filter(entry => entry.target === "memory");
	const failureEntries = [...projectEntries, ...globalEntries].filter(entry => entry.target === "failure");
	renderSection(lines, "User", userEntries);
	renderSection(lines, "Global", globalMemoryEntries);
	renderSection(lines, "Project", projectMemoryEntries);
	renderSection(lines, "Failures", failureEntries);
	return lines.join("\n");
}

function renderSection(lines: string[], title: string, entries: RockeyMemoryEntry[]): void {
	lines.push(`## ${title}`, "");
	if (entries.length === 0) {
		lines.push("_No entries._", "");
		return;
	}
	for (const entry of entries) {
		const prefix = entry.category ? `[${entry.category}] ` : "";
		lines.push(`- ${prefix}${entry.content}`);
	}
	lines.push("");
}
