import { Database } from "bun:sqlite";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSessionsDir, parseJsonlLenient } from "@amaze/utils";
import { CryptoHasher } from "bun";
import type { Settings } from "../config/settings";
import { escapeFts5Query } from "./fts-escape";
import { resolveNexusProjectScope } from "./scope";
import { getNexusDbPath, getNexusRoot, openNexusDb, recordRuntimeEvent } from "./store";

/**
 * Session-anchor search for past conversation transcripts. Ported from the
 * removed Rockey subsystem so Nexus remains the single memory backend without
 * losing the ability to recall prior session content by FTS.
 *
 * The data lives in a sibling SQLite file `nexus-sessions.db` next to
 * `nexus.db` so its schema evolves independently of the canonical Nexus store.
 */

interface IndexedSessionRow {
	session_id: string;
	session_file: string;
	cwd: string;
	scope_key: string;
	display_name: string;
	started_at: string;
	indexed_at: string;
	file_mtime_ms: number;
	file_size: number;
	message_count: number;
	content_hash: string | null;
}

interface IndexedMessageRow {
	id: number;
	session_id: string;
	line_no: number;
	role: string;
	content: string;
	timestamp: string;
	session_file: string;
	display_name: string;
}

interface ParsedSessionMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
	lineNo: number;
}

interface ParsedSessionFile {
	sessionId: string;
	cwd: string;
	startedAt: string;
	messages: ParsedSessionMessage[];
}

export interface NexusSessionAnchor {
	path: string;
	startLine: number;
	endLine: number;
	/** Line of the previous message in the same session, if any. */
	prevLine?: number;
	/** Line of the next message in the same session, if any. */
	nextLine?: number;
	reason: string;
}

export interface NexusSessionSearchOptions {
	scope?: "current_project" | "all";
	role?: "user" | "assistant" | "system";
	since?: string;
	limit?: number;
	advancedQuery?: boolean;
}

const CJK_RE = /[\u3040-\u9fff\uac00-\ud7af]/;

function looksCjk(s: string): boolean {
	return CJK_RE.test(s);
}

export function getNexusSessionDbPath(agentDir: string): string {
	return path.join(getNexusRoot(agentDir), "nexus-sessions.db");
}

export async function reindexNexusSessions(agentDir: string): Promise<{ indexed: number; skipped: number }> {
	const db = openNexusSessionDb(getNexusSessionDbPath(agentDir));
	try {
		const sessionsRoot = getSessionsDir(agentDir);
		const files = await Array.fromAsync(new Bun.Glob("*/*.jsonl").scan(sessionsRoot), file =>
			path.join(sessionsRoot, file),
		);
		let indexed = 0;
		let skipped = 0;
		for (const file of files) {
			const changed = await indexNexusSessionFile(file, db);
			if (changed) indexed += 1;
			else skipped += 1;
		}
		return { indexed, skipped };
	} finally {
		db.close(false);
	}
}

export async function indexCurrentNexusSession(
	agentDir: string,
	sessionFile: string | null | undefined,
): Promise<boolean> {
	if (!sessionFile) return false;
	const db = openNexusSessionDb(getNexusSessionDbPath(agentDir));
	try {
		return await indexNexusSessionFile(sessionFile, db);
	} finally {
		db.close(false);
	}
}

export function searchNexusSessionAnchors(
	agentDir: string,
	cwd: string,
	settings: Settings,
	query: string,
	options: NexusSessionSearchOptions = {},
): { anchors: NexusSessionAnchor[]; text: string } {
	const db = openNexusSessionDb(getNexusSessionDbPath(agentDir));
	try {
		const trimmed = query.trim();
		if (!trimmed) return { anchors: [], text: "count: 0" };
		const useTrigram = looksCjk(trimmed);
		const ftsTable = useTrigram ? "nexus_session_fts_trigram" : "nexus_session_fts";
		const configuredMax = settings.get("nexus.sessionSearchMaxAnchors") ?? 8;
		const limit = Math.max(1, Math.min(options.limit ?? configuredMax, 20));
		if (useTrigram) {
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const allShort = tokens.every(t => t.length < 3);
			if (allShort) {
				const likeConditions: string[] = ["m.content LIKE ?"];
				const likeParams: Array<string | number> = [`%${trimmed}%`];
				if (options.scope !== "all") {
					likeConditions.push("s.scope_key = ?");
					likeParams.push(resolveNexusProjectScope(cwd).key ?? "");
				}
				if (options.role) {
					likeConditions.push("m.role = ?");
					likeParams.push(options.role);
				}
				if (options.since) {
					likeConditions.push("m.timestamp >= ?");
					likeParams.push(options.since);
				}
				likeParams.push(limit);
				const rows = db
					.prepare(`
						SELECT m.id, m.session_id, m.line_no, m.role, m.content, m.timestamp, s.session_file, s.display_name
						FROM nexus_session_messages m
						JOIN nexus_sessions s ON s.session_id = m.session_id
						WHERE ${likeConditions.join(" AND ")}
						ORDER BY m.timestamp DESC, m.id DESC
						LIMIT ?
					`)
					.all(...likeParams) as IndexedMessageRow[];
				return buildResultFromRows(db, rows, settings);
			}
		}
		const params: Array<string | number> = [escapeFts5Query(trimmed, { advanced: options.advancedQuery === true })];
		const conditions = [`m.rowid IN (SELECT rowid FROM ${ftsTable} WHERE ${ftsTable} MATCH ?)`];
		if (options.scope !== "all") {
			conditions.push("s.scope_key = ?");
			params.push(resolveNexusProjectScope(cwd).key ?? "");
		}
		if (options.role) {
			conditions.push("m.role = ?");
			params.push(options.role);
		}
		if (options.since) {
			conditions.push("m.timestamp >= ?");
			params.push(options.since);
		}
		params.push(limit);
		const rows = db
			.prepare(`
				SELECT
					m.id,
					m.session_id,
					m.line_no,
					m.role,
					m.content,
					m.timestamp,
					s.session_file,
					s.display_name
				FROM nexus_session_messages m
				JOIN nexus_sessions s ON s.session_id = m.session_id
				WHERE ${conditions.join(" AND ")}
				ORDER BY m.timestamp DESC, m.id DESC
				LIMIT ?
			`)
			.all(...params) as IndexedMessageRow[];
		return buildResultFromRows(db, rows, settings);
	} catch (error) {
		try {
			const errDb = openNexusDb(getNexusDbPath(agentDir));
			try {
				recordRuntimeEvent(errDb, { kind: "session_search_failure", severity: "warn", message: String(error) });
			} finally {
				errDb.close(false);
			}
		} catch {}
		return { anchors: [], text: "count: 0" };
	} finally {
		db.close(false);
	}
}

export function renderNexusSessionAnchors(anchors: NexusSessionAnchor[], settings: Settings): string {
	const maxAnchors = Math.max(1, settings.get("nexus.sessionSearchMaxAnchors") ?? 8);
	const maxChars = Math.max(256, settings.get("nexus.sessionSearchMaxPreviewChars") ?? 1600);
	const bounded = anchors.slice(0, maxAnchors);
	const lines = [`count: ${anchors.length}`];
	if (bounded.length > 0) lines.push("anchors:");
	for (const anchor of bounded) {
		const start = anchor.prevLine ?? anchor.startLine;
		const end = anchor.nextLine ?? anchor.endLine;
		const reason = truncateText(anchor.reason.replace(/\s+/g, " ").trim(), 180);
		lines.push(`- ${anchor.path}:${start}-${end} — ${reason}`);
	}
	if (anchors.length > bounded.length) lines.push(`- ... ${anchors.length - bounded.length} more anchors omitted`);
	const text = lines.join("\n");
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 24))}\n...[truncated]...`;
}

function buildResultFromRows(
	db: Database,
	rows: IndexedMessageRow[],
	settings: Settings,
): { anchors: NexusSessionAnchor[]; text: string } {
	const sessionIds = [...new Set(rows.map(r => r.session_id))];
	const siblingsBySession = new Map<string, number[]>();
	for (const sid of sessionIds) {
		const lines = (
			db
				.prepare("SELECT line_no FROM nexus_session_messages WHERE session_id = ? ORDER BY line_no")
				.all(sid) as Array<{
				line_no: number;
			}>
		).map(r => r.line_no);
		siblingsBySession.set(sid, lines);
	}
	const anchors = rows.map(row => {
		const lines = siblingsBySession.get(row.session_id) ?? [];
		const idx = lines.indexOf(row.line_no);
		return {
			path: row.session_file,
			startLine: row.line_no,
			endLine: row.line_no,
			prevLine: idx > 0 ? lines[idx - 1] : undefined,
			nextLine: idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : undefined,
			reason: `[${row.display_name} ${row.role}] ${truncateReason(row.content)}`,
		};
	});
	return { anchors, text: renderNexusSessionAnchors(anchors, settings) };
}

function openNexusSessionDb(dbPath: string): Database {
	fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath, { create: true });
	db.exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA busy_timeout=5000;

		CREATE TABLE IF NOT EXISTS nexus_sessions (
			session_id TEXT PRIMARY KEY,
			session_file TEXT NOT NULL,
			cwd TEXT NOT NULL,
			scope_key TEXT NOT NULL,
			display_name TEXT NOT NULL,
			started_at TEXT NOT NULL,
			indexed_at TEXT NOT NULL,
			file_mtime_ms INTEGER NOT NULL,
			file_size INTEGER NOT NULL,
			message_count INTEGER NOT NULL,
			content_hash TEXT
		);

		CREATE TABLE IF NOT EXISTS nexus_session_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL REFERENCES nexus_sessions(session_id) ON DELETE CASCADE,
			line_no INTEGER NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
			content TEXT NOT NULL,
			timestamp TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_nexus_session_messages_session_id ON nexus_session_messages(session_id);
		CREATE INDEX IF NOT EXISTS idx_nexus_session_messages_timestamp ON nexus_session_messages(timestamp);
		CREATE INDEX IF NOT EXISTS idx_nexus_sessions_scope ON nexus_sessions(scope_key);

		CREATE VIRTUAL TABLE IF NOT EXISTS nexus_session_fts USING fts5(
			content,
			content='nexus_session_messages',
			content_rowid='id'
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS nexus_session_fts_trigram USING fts5(
			content,
			content='nexus_session_messages',
			content_rowid='id',
			tokenize='trigram'
		);

		CREATE TRIGGER IF NOT EXISTS nexus_session_messages_ai AFTER INSERT ON nexus_session_messages BEGIN
			INSERT INTO nexus_session_fts(rowid, content) VALUES (new.id, new.content);
			INSERT INTO nexus_session_fts_trigram(rowid, content) VALUES (new.id, new.content);
		END;

		CREATE TRIGGER IF NOT EXISTS nexus_session_messages_ad AFTER DELETE ON nexus_session_messages BEGIN
			INSERT INTO nexus_session_fts(nexus_session_fts, rowid, content) VALUES ('delete', old.id, old.content);
			INSERT INTO nexus_session_fts_trigram(nexus_session_fts_trigram, rowid, content) VALUES ('delete', old.id, old.content);
		END;

		CREATE TRIGGER IF NOT EXISTS nexus_session_messages_au AFTER UPDATE ON nexus_session_messages BEGIN
			INSERT INTO nexus_session_fts(nexus_session_fts, rowid, content) VALUES ('delete', old.id, old.content);
			INSERT INTO nexus_session_fts(rowid, content) VALUES (new.id, new.content);
			INSERT INTO nexus_session_fts_trigram(nexus_session_fts_trigram, rowid, content) VALUES ('delete', old.id, old.content);
			INSERT INTO nexus_session_fts_trigram(rowid, content) VALUES (new.id, new.content);
		END;
	`);
	ensureNexusSessionsContentHashColumn(db);
	ensureTrigramBackfill(db);
	return db;
}

function ensureNexusSessionsContentHashColumn(db: Database): void {
	const columns = db.prepare("PRAGMA table_info(nexus_sessions)").all() as Array<{ name: string }>;
	if (columns.some(column => column.name === "content_hash")) return;
	db.exec("ALTER TABLE nexus_sessions ADD COLUMN content_hash TEXT;");
}

function ensureTrigramBackfill(db: Database): void {
	try {
		db.exec(`
			INSERT INTO nexus_session_fts_trigram(rowid, content)
			SELECT m.id, m.content
			FROM nexus_session_messages m
			LEFT JOIN nexus_session_fts_trigram f ON f.rowid = m.id
			WHERE f.rowid IS NULL;
		`);
	} catch {}
}

async function indexNexusSessionFile(sessionFile: string, db: Database): Promise<boolean> {
	const stat = await fs.stat(sessionFile);
	const bytes = await Bun.file(sessionFile).bytes();
	const contentHash = new CryptoHasher("sha256").update(bytes).digest("hex");
	const current = db.prepare("SELECT * FROM nexus_sessions WHERE session_file = ?").get(sessionFile) as
		| IndexedSessionRow
		| undefined;
	if (current?.content_hash && current.file_size === stat.size && current.content_hash === contentHash) return false;
	const parsed = parseSessionFile(new TextDecoder().decode(bytes));
	if (!parsed) return false;
	const scope = resolveNexusProjectScope(parsed.cwd);
	const now = new Date().toISOString();
	const tx = db.transaction(() => {
		const oldMessageRows = db
			.prepare("SELECT id, content FROM nexus_session_messages WHERE session_id = ?")
			.all(parsed.sessionId) as Array<{ id: number; content: string }>;
		for (const oldMessage of oldMessageRows) {
			db.prepare("INSERT INTO nexus_session_fts(nexus_session_fts, rowid, content) VALUES ('delete', ?, ?)").run(
				oldMessage.id,
				oldMessage.content,
			);
			db.prepare(
				"INSERT INTO nexus_session_fts_trigram(nexus_session_fts_trigram, rowid, content) VALUES ('delete', ?, ?)",
			).run(oldMessage.id, oldMessage.content);
		}
		db.prepare("DELETE FROM nexus_sessions WHERE session_id = ? OR session_file = ?").run(
			parsed.sessionId,
			sessionFile,
		);
		db.prepare(
			`INSERT INTO nexus_sessions (
				session_id, session_file, cwd, scope_key, display_name, started_at, indexed_at, file_mtime_ms, file_size, message_count, content_hash
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			parsed.sessionId,
			sessionFile,
			parsed.cwd,
			scope.key ?? "",
			scope.displayName,
			parsed.startedAt,
			now,
			Math.trunc(stat.mtimeMs),
			stat.size,
			parsed.messages.length,
			contentHash,
		);
		const insert = db.prepare(
			"INSERT INTO nexus_session_messages (session_id, line_no, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
		);
		for (const message of parsed.messages) {
			insert.run(parsed.sessionId, message.lineNo, message.role, message.content, message.timestamp);
		}
	});
	tx();
	return true;
}

function parseSessionFile(text: string): ParsedSessionFile | null {
	const rows = parseJsonlLenient<Record<string, unknown>>(text);
	if (rows.length === 0) return null;
	let sessionId: string | undefined;
	let cwd: string | undefined;
	let startedAt: string | undefined;
	const lineMap = text.split("\n");
	const messages: ParsedSessionMessage[] = [];
	for (let index = 0; index < lineMap.length; index += 1) {
		const line = lineMap[index];
		if (!line.trim()) continue;
		let parsed: Record<string, unknown> | undefined;
		try {
			parsed = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (parsed.type === "session") {
			sessionId = typeof parsed.id === "string" ? parsed.id : sessionId;
			cwd = typeof parsed.cwd === "string" ? parsed.cwd : cwd;
			startedAt = typeof parsed.timestamp === "string" ? parsed.timestamp : startedAt;
			continue;
		}
		if (parsed.type !== "message") continue;
		const message = parsed.message;
		if (!message || typeof message !== "object") continue;
		const role =
			typeof (message as { role?: unknown }).role === "string"
				? ((message as { role: string }).role as ParsedSessionMessage["role"])
				: undefined;
		if (role !== "user" && role !== "assistant" && role !== "system") continue;
		const content = extractMessageText((message as { content?: unknown }).content, role);
		if (!content) continue;
		messages.push({
			role,
			content,
			timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : (startedAt ?? new Date(0).toISOString()),
			lineNo: index + 1,
		});
	}
	if (!sessionId || !cwd || !startedAt) return null;
	return { sessionId, cwd, startedAt, messages };
}

function extractMessageText(content: unknown, role: ParsedSessionMessage["role"]): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const maybeText = block as { type?: unknown; text?: unknown };
		if (maybeText.type === "text" && typeof maybeText.text === "string") parts.push(maybeText.text);
		if (role === "assistant") continue;
	}
	return parts.join("\n").trim();
}

function truncateReason(text: string): string {
	return text.length <= 180 ? text : `${text.slice(0, 177)}...`;
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 16) return text.slice(0, maxChars);
	return `${text.slice(0, maxChars - 16)}...[truncated]`;
}
