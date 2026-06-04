import type { SQLQueryBindings } from "bun:sqlite";
import type { DatabaseManager } from "./db";
import { isFts5QueryError, normalizeFts5Query } from "./fts-query";
import type { HermesMemoryEntry, HermesMemorySearchOptions, MemoryCategory, MemoryTarget } from "./types";

const MEMORY_SELECT_COLUMNS =
	"id, project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced";
const FAILURE_CATEGORY_SET = new Set<MemoryCategory>([
	"failure",
	"correction",
	"insight",
	"preference",
	"convention",
	"tool-quirk",
	"turn_sync",
	"checkpoint",
]);

export interface SqliteMemorySyncInput {
	content: string;
	target: MemoryTarget;
	project?: string | null;
	category?: MemoryCategory | null;
	failureReason?: string | null;
	toolState?: string | null;
	correctedTo?: string | null;
	created?: string | null;
	lastReferenced?: string | null;
}

function today(): string {
	return new Date().toISOString().split("T")[0];
}

function normalizeNullable(value?: string | null): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function mapRow(row: any): HermesMemoryEntry {
	return {
		id: row.id,
		project: row.project,
		target: row.target as MemoryTarget,
		category: row.category as MemoryCategory | null,
		content: row.content,
		failureReason: row.failure_reason,
		toolState: row.tool_state,
		correctedTo: row.corrected_to,
		created: row.created,
		lastReferenced: row.last_referenced,
	};
}

function buildScopeConditions(
	params: SQLQueryBindings[],
	target?: MemoryTarget,
	project?: string | null,
	category?: MemoryCategory | null,
): string[] {
	const conditions: string[] = [];
	if (target) {
		conditions.push("target = ?");
		params.push(target);
	}
	if (project !== undefined) {
		if (project === null) conditions.push("project IS NULL");
		else {
			conditions.push("project = ?");
			params.push(project);
		}
	}
	if (category !== undefined) {
		if (category === null) conditions.push("category IS NULL");
		else {
			conditions.push("category = ?");
			params.push(category);
		}
	}
	return conditions;
}

function parseMetadataComment(raw: string): { text: string; created: string; lastReferenced: string } {
	const match = raw.match(/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/);
	if (match) return { text: match[1].trim(), created: match[2].trim(), lastReferenced: match[3].trim() };
	const fallback = today();
	return { text: raw.trim(), created: fallback, lastReferenced: fallback };
}

export function parseMarkdownMemoryEntry(
	rawEntry: string,
	target: MemoryTarget,
	project: string | null = null,
): SqliteMemorySyncInput {
	const { text, created, lastReferenced } = parseMetadataComment(rawEntry);
	if (target !== "failure")
		return { content: text, target, project: normalizeNullable(project), created, lastReferenced };

	let category: MemoryCategory | null = null;
	let failureReason: string | null = null;
	let toolState: string | null = null;
	let correctedTo: string | null = null;
	const categoryMatch = text.match(/^\[([^\]]+)\]\s+/);
	if (categoryMatch && FAILURE_CATEGORY_SET.has(categoryMatch[1] as MemoryCategory))
		category = categoryMatch[1] as MemoryCategory;
	for (const segment of text.split(" — ").slice(1)) {
		if (segment.startsWith("Failed: ") && !failureReason)
			failureReason = normalizeNullable(segment.slice("Failed: ".length));
		else if (segment.startsWith("Tool state: ") && !toolState)
			toolState = normalizeNullable(segment.slice("Tool state: ".length));
		else if (segment.startsWith("Corrected to: ") && !correctedTo)
			correctedTo = normalizeNullable(segment.slice("Corrected to: ".length));
	}
	return {
		content: text,
		target: "failure",
		project: normalizeNullable(project),
		category,
		failureReason,
		toolState,
		correctedTo,
		created,
		lastReferenced,
	};
}

export function addMemory(dbManager: DatabaseManager, input: SqliteMemorySyncInput): HermesMemoryEntry {
	const db = dbManager.getDb();
	const content = input.content.trim();
	const project = normalizeNullable(input.project);
	const category = input.category ?? null;
	const failureReason = normalizeNullable(input.failureReason);
	const toolState = normalizeNullable(input.toolState);
	const correctedTo = normalizeNullable(input.correctedTo);
	const created = input.created?.trim() || today();
	const lastReferenced = input.lastReferenced?.trim() || created;
	const result = db
		.prepare(
			"INSERT INTO memories (project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(project, input.target, category, content, failureReason, toolState, correctedTo, created, lastReferenced);
	return {
		id: Number(result.lastInsertRowid),
		project,
		target: input.target,
		category,
		content,
		failureReason,
		toolState,
		correctedTo,
		created,
		lastReferenced,
	};
}

export function syncMemoryEntry(dbManager: DatabaseManager, input: SqliteMemorySyncInput): HermesMemoryEntry {
	const db = dbManager.getDb();
	const content = input.content.trim();
	const project = normalizeNullable(input.project);
	const category = input.category ?? null;
	const params: SQLQueryBindings[] = [];
	const conditions = buildScopeConditions(params, input.target, project, category);
	conditions.push("content = ?");
	params.push(content);
	const existing = db
		.prepare(
			`SELECT ${MEMORY_SELECT_COLUMNS} FROM memories WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT 1`,
		)
		.get(...params) as any;
	if (existing) return mapRow(existing);
	return addMemory(dbManager, { ...input, content, project, category });
}

export function removeExactSyncedMemories(
	dbManager: DatabaseManager,
	content: string,
	options: { target: MemoryTarget; project?: string | null },
): number {
	const params: SQLQueryBindings[] = [];
	const conditions = buildScopeConditions(params, options.target, options.project ?? undefined);
	conditions.push("content = ?");
	params.push(content.trim());
	const result = dbManager
		.getDb()
		.prepare(`DELETE FROM memories WHERE ${conditions.join(" AND ")}`)
		.run(...params);
	return result.changes;
}

export function searchMemories(
	dbManager: DatabaseManager,
	query: string,
	options: HermesMemorySearchOptions = {},
): HermesMemoryEntry[] {
	const normalizedQuery = normalizeFts5Query(query);
	if (!normalizedQuery) return [];
	const { project, target, category, limit = 10 } = options;
	const params: SQLQueryBindings[] = [normalizedQuery];
	const conditions = ["m.id IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)"];
	if (project !== undefined) {
		if (project === null) conditions.push("m.project IS NULL");
		else {
			conditions.push("m.project = ?");
			params.push(project);
		}
	}
	if (target) {
		conditions.push("m.target = ?");
		params.push(target);
	}
	if (category) {
		conditions.push("m.category = ?");
		params.push(category);
	}
	params.push(limit);
	try {
		const rows = dbManager
			.getDb()
			.prepare(
				`SELECT ${MEMORY_SELECT_COLUMNS} FROM memories m WHERE ${conditions.join(" AND ")} ORDER BY m.last_referenced DESC, m.id DESC LIMIT ?`,
			)
			.all(...params) as any[];
		return rows.map(mapRow);
	} catch (err) {
		if (isFts5QueryError(err)) return [];
		throw err;
	}
}

export function getMemories(
	dbManager: DatabaseManager,
	options: { project?: string | null; target?: MemoryTarget; category?: MemoryCategory } = {},
): HermesMemoryEntry[] {
	const params: SQLQueryBindings[] = [];
	const conditions = buildScopeConditions(params, options.target, options.project, options.category);
	const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	const rows = dbManager
		.getDb()
		.prepare(`SELECT ${MEMORY_SELECT_COLUMNS} FROM memories ${whereClause} ORDER BY last_referenced DESC, id DESC`)
		.all(...params) as any[];
	return rows.map(mapRow);
}

export function touchMemory(dbManager: DatabaseManager, id: number): void {
	dbManager.getDb().prepare("UPDATE memories SET last_referenced = ? WHERE id = ?").run(today(), id);
}
