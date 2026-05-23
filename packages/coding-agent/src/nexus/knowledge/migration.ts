import { Database } from "bun:sqlite";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { logger } from "@amaze/utils";
import { getNexusDbPath, getNexusKnowledgeDbPath, getNexusRoot, recordRuntimeEvent } from "../store";

const KNOWLEDGE_TABLES = [
	"knowledge_documents",
	"knowledge_chunks",
	"knowledge_chunks_fts",
	"knowledge_symbols",
] as const;

const MIGRATION_MARKER_FILE = "knowledge-db.migrated.json";

export function migrateKnowledgeIntoSeparateDb(agentDir: string): {
	migrated: number;
	skipped: boolean;
	reason?: string;
} {
	const operationalPath = getNexusDbPath(agentDir);
	if (!fsSync.existsSync(operationalPath)) return { migrated: 0, skipped: true, reason: "no_operational_db" };

	const markerPath = path.join(getNexusRoot(agentDir), MIGRATION_MARKER_FILE);
	if (fsSync.existsSync(markerPath)) return { migrated: 0, skipped: true, reason: "marker_present" };

	const operational = new Database(operationalPath, { create: false, readwrite: true });
	try {
		const found = (
			operational
				.prepare(
					`SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name IN (${KNOWLEDGE_TABLES.map(() => "?").join(",")})`,
				)
				.all(...KNOWLEDGE_TABLES) as Array<{ name: string }>
		).map(row => row.name);

		if (found.length === 0) {
			writeMarker(markerPath, { migratedAt: new Date().toISOString(), migratedRows: 0 });
			return { migrated: 0, skipped: true, reason: "no_knowledge_in_operational" };
		}

		const knowledgePath = getNexusKnowledgeDbPath(agentDir);
		const knowledge = new Database(knowledgePath, { create: true });
		try {
			knowledge.exec(`ATTACH DATABASE '${operationalPath.replace(/'/g, "''")}' AS legacy`);
			ensureKnowledgeSchema(knowledge);
			try {
				let totalRows = 0;
				knowledge.transaction(() => {
					if (found.includes("knowledge_documents")) {
						const rows = (
							knowledge.prepare("SELECT COUNT(*) AS c FROM legacy.knowledge_documents").get() as { c: number }
						).c;
						if (rows > 0) {
							knowledge.exec(
								"INSERT OR IGNORE INTO knowledge_documents SELECT * FROM legacy.knowledge_documents",
							);
							totalRows += rows;
						}
					}
					if (found.includes("knowledge_chunks")) {
						const rows = (
							knowledge.prepare("SELECT COUNT(*) AS c FROM legacy.knowledge_chunks").get() as { c: number }
						).c;
						if (rows > 0) {
							knowledge.exec("INSERT OR IGNORE INTO knowledge_chunks SELECT * FROM legacy.knowledge_chunks");
							totalRows += rows;
						}
					}
					if (found.includes("knowledge_symbols")) {
						const rows = (
							knowledge.prepare("SELECT COUNT(*) AS c FROM legacy.knowledge_symbols").get() as { c: number }
						).c;
						if (rows > 0) {
							knowledge.exec("INSERT OR IGNORE INTO knowledge_symbols SELECT * FROM legacy.knowledge_symbols");
							totalRows += rows;
						}
					}
				})();

				try {
					knowledge.exec("DELETE FROM knowledge_chunks_fts");
					knowledge.exec(
						"INSERT INTO knowledge_chunks_fts (content, path, document_id, chunk_id) SELECT content, path, document_id, id FROM knowledge_chunks",
					);
				} catch (error) {
					logger.debug("knowledge_chunks_fts rebuild skipped", { error: String(error) });
				}

				operational.transaction(() => {
					for (const name of [...found].reverse()) {
						try {
							operational.exec(`DROP TABLE IF EXISTS ${name}`);
						} catch (error) {
							logger.debug(`drop ${name} failed`, { error: String(error) });
						}
					}
				})();

				writeMarker(markerPath, {
					migratedAt: new Date().toISOString(),
					migratedTables: found,
					migratedRows: totalRows,
				});

				try {
					recordRuntimeEvent(operational, {
						kind: "knowledge_db_migrated",
						severity: "info",
						message: `Migrated ${totalRows} knowledge row(s) to separate db`,
						context: { tables: found },
					});
				} catch {}

				return { migrated: totalRows, skipped: false };
			} finally {
				knowledge.exec("DETACH DATABASE legacy");
				knowledge.close();
			}
		} catch (error) {
			knowledge.close();
			throw error;
		}
	} finally {
		operational.close();
	}
}

function ensureKnowledgeSchema(db: Database): void {
	db.exec(`
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
	ensureColumn(db, "knowledge_symbols", "end_line", "INTEGER");
	ensureColumn(db, "knowledge_symbols", "parent_symbol", "TEXT");
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
	const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
	if (rows.some(row => row.name === column)) return;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function writeMarker(markerPath: string, payload: Record<string, unknown>): void {
	try {
		fsSync.mkdirSync(path.dirname(markerPath), { recursive: true });
		fsSync.writeFileSync(markerPath, JSON.stringify(payload, null, 2));
	} catch (error) {
		logger.debug("Knowledge migration marker write failed", { error: String(error) });
	}
}
