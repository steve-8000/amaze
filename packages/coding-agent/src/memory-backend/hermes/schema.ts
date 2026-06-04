export const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS memories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project TEXT,
		target TEXT NOT NULL CHECK (target IN ('memory', 'user', 'failure')),
		category TEXT CHECK (category IN ('failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk', 'turn_sync', 'checkpoint')),
		content TEXT NOT NULL,
		failure_reason TEXT,
		tool_state TEXT,
		corrected_to TEXT,
		created DATE NOT NULL,
		last_referenced DATE NOT NULL
	);

	CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
		content,
		content='memories',
		content_rowid='id'
	);

	CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
		INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
	END;

	CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
		INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
	END;

	CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
		INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
		INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
	END;

	CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
	CREATE INDEX IF NOT EXISTS idx_memories_target ON memories(target);
	CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
`;
