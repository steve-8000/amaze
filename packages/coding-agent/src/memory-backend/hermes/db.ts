import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { SQLITE_FILE } from "./constants";
import { SCHEMA_SQL } from "./schema";

type BunDatabase = InstanceType<typeof Database>;

export class DatabaseManager {
	private db: BunDatabase | null = null;
	private readonly dbPath: string;

	constructor(memoryDir: string) {
		this.dbPath = path.join(memoryDir, SQLITE_FILE);
	}

	getDb(): BunDatabase {
		if (!this.db) this.db = this.open();
		return this.db;
	}

	private open(): BunDatabase {
		fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
		const db = new Database(this.dbPath);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(SCHEMA_SQL);
		try {
			db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
		} catch {
			// Best effort: empty or freshly-created FTS tables may not need rebuilding.
		}
		return db;
	}

	close(): void {
		if (!this.db) return;
		try {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		} catch {
			// best effort
		}
		this.db.close();
		this.db = null;
	}

	getPath(): string {
		return this.dbPath;
	}

	exists(): boolean {
		return fs.existsSync(this.dbPath);
	}

	clear(): void {
		const db = this.getDb();
		db.exec("DELETE FROM memories");
		try {
			db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
		} catch {
			// best effort
		}
	}
}
