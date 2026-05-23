import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withMemoryPlane } from "../../src/nexus/memory-plane";
import { getNexusSessionDbPath } from "../../src/nexus/session-search";
import { getNexusDbPath, getNexusKnowledgeDbPath, openNexusDb } from "../../src/nexus/store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-memory-plane-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function seedMainDb(agentDir: string): void {
	const db = openNexusDb(getNexusDbPath(agentDir));
	try {
		db.prepare(`
			INSERT INTO memory_scopes (
				id, scope_kind, scope_key, display_name, cwd, git_origin, repo_root, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"scope-1",
			"project",
			"project-1",
			"Project 1",
			agentDir,
			null,
			agentDir,
			"2026-05-23T00:00:00.000Z",
			"2026-05-23T00:00:00.000Z",
		);
		db.prepare(`
			INSERT INTO memory_items (
				id, scope_id, source_id, target, category, memory_type, content, provenance,
				confidence, staleness, status, usage_count, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"memory-1",
			"scope-1",
			null,
			"memory",
			"insight",
			"fact",
			"Remember bridge coverage",
			"test",
			"high",
			"fresh",
			"active",
			0,
			"2026-05-23T00:00:00.000Z",
			"2026-05-23T00:00:00.000Z",
		);
	} finally {
		db.close(false);
	}
}

function seedKnowledgeDb(agentDir: string): void {
	fsSync.mkdirSync(path.dirname(getNexusKnowledgeDbPath(agentDir)), { recursive: true });
	const db = new Database(getNexusKnowledgeDbPath(agentDir), { create: true });
	try {
		db.exec(`
			CREATE TABLE knowledge_documents (
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
			CREATE TABLE knowledge_chunks (
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
		`);
		db.prepare(`
			INSERT INTO knowledge_documents (
				id, repo_root, path, absolute_path, kind, language, content_hash, size_bytes, indexed_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"doc-1",
			agentDir,
			"README.md",
			path.join(agentDir, "README.md"),
			"text",
			null,
			"hash-doc-1",
			12,
			"2026-05-23T00:00:00.000Z",
			"2026-05-23T00:00:00.000Z",
		);
		db.prepare(`
			INSERT INTO knowledge_chunks (
				id, document_id, path, chunk_index, start_line, end_line, content, content_hash
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run("chunk-1", "doc-1", "README.md", 0, 1, 1, "Knowledge bridge coverage", "hash-chunk-1");
	} finally {
		db.close(false);
	}
}

function seedSessionDb(agentDir: string): void {
	fsSync.mkdirSync(path.dirname(getNexusSessionDbPath(agentDir)), { recursive: true });
	const db = new Database(getNexusSessionDbPath(agentDir), { create: true });
	try {
		db.exec(`
			CREATE TABLE nexus_sessions (
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
			CREATE TABLE nexus_session_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL REFERENCES nexus_sessions(session_id) ON DELETE CASCADE,
				line_no INTEGER NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
				content TEXT NOT NULL,
				timestamp TEXT NOT NULL
			);
		`);
		db.prepare(`
			INSERT INTO nexus_sessions (
				session_id, session_file, cwd, scope_key, display_name, started_at,
				indexed_at, file_mtime_ms, file_size, message_count, content_hash
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"session-1",
			path.join(agentDir, "sessions", "s.jsonl"),
			agentDir,
			"project-1",
			"Project 1",
			"2026-05-23T00:00:00.000Z",
			"2026-05-23T00:00:00.000Z",
			0,
			0,
			1,
			"hash-session-1",
		);
		db.prepare(`
			INSERT INTO nexus_session_messages (session_id, line_no, role, content, timestamp)
			VALUES (?, ?, ?, ?, ?)
		`).run("session-1", 1, "user", "Session bridge coverage", "2026-05-23T00:01:00.000Z");
	} finally {
		db.close(false);
	}
}

describe("withMemoryPlane", () => {
	it("joins across memory, knowledge, and sessions when all files exist", async () => {
		await withTempDir(async agentDir => {
			seedMainDb(agentDir);
			seedKnowledgeDb(agentDir);
			seedSessionDb(agentDir);

			const result = withMemoryPlane(agentDir, ({ db, aliases }) => {
				const row = db
					.prepare(`
						SELECT
							(SELECT COUNT(*) FROM memory_items) AS m,
							(SELECT COUNT(*) FROM knowledge.knowledge_documents) AS k,
							(SELECT COUNT(*) FROM sessions.nexus_session_messages) AS s
					`)
					.get() as { m: number; k: number; s: number };
				return { aliases, row };
			});

			expect(result.aliases).toEqual({ knowledge: true, sessions: true });
			expect(result.row).toEqual({ m: 1, k: 1, s: 1 });
		});
	});

	it("works when sibling files are missing and does not create them", async () => {
		await withTempDir(async agentDir => {
			seedMainDb(agentDir);

			const result = withMemoryPlane(agentDir, ({ db, aliases }) => {
				const row = db.prepare("SELECT COUNT(*) AS count FROM memory_items").get() as { count: number };
				return { aliases, count: row.count };
			});

			expect(result.aliases).toEqual({ knowledge: false, sessions: false });
			expect(result.count).toBe(1);
			expect(fsSync.existsSync(getNexusKnowledgeDbPath(agentDir))).toBe(false);
			expect(fsSync.existsSync(getNexusSessionDbPath(agentDir))).toBe(false);
		});
	});
});
