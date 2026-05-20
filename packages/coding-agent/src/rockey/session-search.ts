import { Database } from "bun:sqlite";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSessionsDir, parseJsonlLenient } from "@amaze/utils";
import type { Settings } from "../config/settings";
import { type RockeySessionAnchor, renderRockeySessionAnchors } from "./admission";
import { getRockeyDbPath, resolveRockeyScope } from "./store";

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

export interface RockeySessionSearchOptions {
	scope?: "current_project" | "all";
	role?: "user" | "assistant" | "system";
	since?: string;
	limit?: number;
}

export async function reindexRockeySessions(agentDir: string): Promise<{ indexed: number; skipped: number }> {
	const db = openRockeySessionDb(getRockeyDbPath(agentDir));
	try {
		const sessionsRoot = getSessionsDir(agentDir);
		const files = await Array.fromAsync(new Bun.Glob("*/*.jsonl").scan(sessionsRoot), file =>
			path.join(sessionsRoot, file),
		);
		let indexed = 0;
		let skipped = 0;
		for (const file of files) {
			const changed = await indexRockeySessionFile(agentDir, file, db);
			if (changed) indexed += 1;
			else skipped += 1;
		}
		return { indexed, skipped };
	} finally {
		db.close(false);
	}
}

export async function indexCurrentRockeySession(
	agentDir: string,
	sessionFile: string | null | undefined,
): Promise<boolean> {
	if (!sessionFile) return false;
	const db = openRockeySessionDb(getRockeyDbPath(agentDir));
	try {
		return await indexRockeySessionFile(agentDir, sessionFile, db);
	} finally {
		db.close(false);
	}
}

export function searchRockeySessionAnchors(
	agentDir: string,
	cwd: string,
	settings: Settings,
	query: string,
	options: RockeySessionSearchOptions = {},
): { anchors: RockeySessionAnchor[]; text: string } {
	const db = openRockeySessionDb(getRockeyDbPath(agentDir));
	try {
		const trimmed = query.trim();
		if (!trimmed) return { anchors: [], text: "count: 0" };
		const limit = Math.max(1, Math.min(options.limit ?? settings.get("rockey.sessionSearchMaxAnchors") ?? 8, 20));
		const params: Array<string | number> = [escapeFts5Query(trimmed)];
		const conditions = ["m.rowid IN (SELECT rowid FROM rockey_session_fts WHERE rockey_session_fts MATCH ?)"];
		if (options.scope !== "all") {
			conditions.push("s.scope_key = ?");
			params.push(resolveRockeyScope(cwd).key ?? "");
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
				FROM rockey_session_messages m
				JOIN rockey_sessions s ON s.session_id = m.session_id
				WHERE ${conditions.join(" AND ")}
				ORDER BY m.timestamp DESC, m.id DESC
				LIMIT ?
			`)
			.all(...params) as IndexedMessageRow[];
		const anchors = rows.map(row => ({
			path: row.session_file,
			startLine: row.line_no,
			endLine: row.line_no,
			reason: `[${row.display_name} ${row.role}] ${truncateReason(row.content)}`,
		}));
		return { anchors, text: renderRockeySessionAnchors(anchors, settings) };
	} catch {
		return { anchors: [], text: "count: 0" };
	} finally {
		db.close(false);
	}
}

function openRockeySessionDb(dbPath: string): Database {
	fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath, { create: true });
	db.exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA busy_timeout=5000;

		CREATE TABLE IF NOT EXISTS rockey_sessions (
			session_id TEXT PRIMARY KEY,
			session_file TEXT NOT NULL,
			cwd TEXT NOT NULL,
			scope_key TEXT NOT NULL,
			display_name TEXT NOT NULL,
			started_at TEXT NOT NULL,
			indexed_at TEXT NOT NULL,
			file_mtime_ms INTEGER NOT NULL,
			file_size INTEGER NOT NULL,
			message_count INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS rockey_session_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL REFERENCES rockey_sessions(session_id) ON DELETE CASCADE,
			line_no INTEGER NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
			content TEXT NOT NULL,
			timestamp TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_rockey_session_messages_session_id ON rockey_session_messages(session_id);
		CREATE INDEX IF NOT EXISTS idx_rockey_session_messages_timestamp ON rockey_session_messages(timestamp);
		CREATE INDEX IF NOT EXISTS idx_rockey_sessions_scope ON rockey_sessions(scope_key);

		CREATE VIRTUAL TABLE IF NOT EXISTS rockey_session_fts USING fts5(
			content,
			content='rockey_session_messages',
			content_rowid='id'
		);

		CREATE TRIGGER IF NOT EXISTS rockey_session_messages_ai AFTER INSERT ON rockey_session_messages BEGIN
			INSERT INTO rockey_session_fts(rowid, content) VALUES (new.id, new.content);
		END;

		CREATE TRIGGER IF NOT EXISTS rockey_session_messages_ad AFTER DELETE ON rockey_session_messages BEGIN
			INSERT INTO rockey_session_fts(rockey_session_fts, rowid, content) VALUES ('delete', old.id, old.content);
		END;

		CREATE TRIGGER IF NOT EXISTS rockey_session_messages_au AFTER UPDATE ON rockey_session_messages BEGIN
			INSERT INTO rockey_session_fts(rockey_session_fts, rowid, content) VALUES ('delete', old.id, old.content);
			INSERT INTO rockey_session_fts(rowid, content) VALUES (new.id, new.content);
		END;
	`);
	return db;
}

async function indexRockeySessionFile(_agentDir: string, sessionFile: string, db: Database): Promise<boolean> {
	const stat = await fs.stat(sessionFile);
	const current = db.prepare("SELECT * FROM rockey_sessions WHERE session_file = ?").get(sessionFile) as
		| IndexedSessionRow
		| undefined;
	if (current && current.file_mtime_ms === stat.mtimeMs && current.file_size === stat.size) return false;
	const parsed = parseSessionFile(await Bun.file(sessionFile).text());
	if (!parsed) return false;
	const scope = resolveRockeyScope(parsed.cwd);
	const now = new Date().toISOString();
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM rockey_sessions WHERE session_id = ? OR session_file = ?").run(
			parsed.sessionId,
			sessionFile,
		);
		db.prepare(
			`INSERT INTO rockey_sessions (
				session_id, session_file, cwd, scope_key, display_name, started_at, indexed_at, file_mtime_ms, file_size, message_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
		);
		const insert = db.prepare(
			"INSERT INTO rockey_session_messages (session_id, line_no, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
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

function escapeFts5Query(query: string): string {
	if (/\b(OR|AND|NOT|NEAR)\b/.test(query)) return query;
	return `"${query.replace(/"/g, '""')}"`;
}
