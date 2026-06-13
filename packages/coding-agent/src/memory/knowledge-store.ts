/**
 * KnowledgeStore — local durable knowledge ledger (L1–L3 of the memory plane).
 *
 * SQLite-backed, same autonomy database family as MissionStore/ResearchStore.
 * Three invariants the store enforces rather than trusts:
 *
 * 1. Provenance required — items without `sourceRefs` are rejected.
 * 2. Supersession is explicit — replacing a claim links the revision chain in
 *    both directions; superseded items are excluded from active retrieval.
 * 3. Staleness is detectable — repo-scoped items carry the backing file's
 *    content hash; {@link invalidateStale} compares against current hashes and
 *    marks drifted items stale so they can never be cited as fresh truth.
 */

import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	KNOWLEDGE_CONFIDENCES,
	KNOWLEDGE_SCOPES,
	type KnowledgeItem,
	type KnowledgeQuery,
	type KnowledgeScope,
	type NewKnowledgeItem,
} from "./types";

export const DEFAULT_DB_PATH = path.join(os.homedir(), ".amaze", "autonomy", "autonomy.db");

const VALID_SCOPES = new Set<string>(KNOWLEDGE_SCOPES);
const VALID_CONFIDENCES = new Set<string>(KNOWLEDGE_CONFIDENCES);

type KnowledgeItemRow = {
	id: string;
	scope: KnowledgeScope;
	claim: string;
	source_refs: string;
	confidence: KnowledgeItem["confidence"];
	file_path: string | null;
	content_hash: string | null;
	supersedes: string | null;
	superseded_by: string | null;
	stale_at: number | null;
	created_at: number;
	updated_at: number;
};

/** SHA-256 hex of a file's current content; null when the file is unreadable. */
export function hashFileContent(filePath: string): string | null {
	try {
		return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
	} catch {
		return null;
	}
}

export class KnowledgeStore {
	readonly dbPath: string;
	readonly #db: Database;

	constructor(dbPath = DEFAULT_DB_PATH) {
		this.dbPath = dbPath;
		if (dbPath !== ":memory:") {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		}
		this.#db = new Database(dbPath, { create: true, strict: true });
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#init();
	}

	close(): void {
		this.#db.close();
	}

	record(input: NewKnowledgeItem): KnowledgeItem {
		if (!VALID_SCOPES.has(input.scope)) throw new Error(`Invalid knowledge scope: ${input.scope}`);
		if (!VALID_CONFIDENCES.has(input.confidence)) {
			throw new Error(`Invalid knowledge confidence: ${input.confidence}`);
		}
		if (input.sourceRefs.length === 0) {
			throw new Error("Knowledge item requires at least one source ref (provenance)");
		}
		if (input.supersedes && !this.get(input.supersedes)) {
			throw new Error(`Superseded knowledge item not found: ${input.supersedes}`);
		}
		const now = Date.now();
		const item: KnowledgeItem = {
			...input,
			id: input.id ?? `know-${now}-${randomBytes(4).toString("hex")}`,
			supersededBy: null,
			staleAt: null,
			createdAt: now,
			updatedAt: now,
		};
		this.#db
			.query(
				`INSERT INTO knowledge_items
					(id, scope, claim, source_refs, confidence, file_path, content_hash, supersedes, superseded_by, stale_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
			)
			.run(
				item.id,
				item.scope,
				item.claim,
				JSON.stringify(item.sourceRefs),
				item.confidence,
				item.filePath,
				item.contentHash,
				item.supersedes,
				item.createdAt,
				item.updatedAt,
			);
		if (item.supersedes) {
			this.#db
				.query("UPDATE knowledge_items SET superseded_by = ?, updated_at = ? WHERE id = ?")
				.run(item.id, now, item.supersedes);
		}
		return item;
	}

	get(id: string): KnowledgeItem | undefined {
		const row = this.#db.query("SELECT * FROM knowledge_items WHERE id = ?").get(id) as KnowledgeItemRow | null;
		return row ? rowToItem(row) : undefined;
	}

	query(opts: KnowledgeQuery = {}): KnowledgeItem[] {
		const clauses: string[] = [];
		const params: Array<string | number> = [];
		if (opts.scope) {
			clauses.push("scope = ?");
			params.push(opts.scope);
		}
		if (opts.claimLike) {
			clauses.push("claim LIKE ?");
			params.push(`%${opts.claimLike}%`);
		}
		if (opts.filePath) {
			clauses.push("file_path = ?");
			params.push(opts.filePath);
		}
		if (opts.activeOnly !== false) {
			clauses.push("superseded_by IS NULL AND stale_at IS NULL");
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.trunc(opts.limit ?? 100));
		const rows = this.#db
			.query(`SELECT * FROM knowledge_items ${where} ORDER BY updated_at DESC, id DESC LIMIT ${limit}`)
			.all(...params) as KnowledgeItemRow[];
		return rows.map(rowToItem);
	}

	/**
	 * Compare repo-anchored items against the current file hashes under `root`
	 * and mark drifted ones stale. Returns the items newly marked stale.
	 */
	invalidateStale(root: string): KnowledgeItem[] {
		const candidates = this.#db
			.query(
				"SELECT * FROM knowledge_items WHERE file_path IS NOT NULL AND content_hash IS NOT NULL AND stale_at IS NULL AND superseded_by IS NULL",
			)
			.all() as KnowledgeItemRow[];
		const now = Date.now();
		const stale: KnowledgeItem[] = [];
		for (const row of candidates) {
			const current = hashFileContent(path.resolve(root, row.file_path as string));
			if (current === row.content_hash) continue;
			this.#db.query("UPDATE knowledge_items SET stale_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
			const updated = this.get(row.id);
			if (updated) stale.push(updated);
		}
		return stale;
	}

	#init(): void {
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS knowledge_items (
				id TEXT PRIMARY KEY,
				scope TEXT NOT NULL,
				claim TEXT NOT NULL,
				source_refs TEXT NOT NULL,
				confidence TEXT NOT NULL,
				file_path TEXT,
				content_hash TEXT,
				supersedes TEXT,
				superseded_by TEXT,
				stale_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS knowledge_items_scope_idx ON knowledge_items(scope);
			CREATE INDEX IF NOT EXISTS knowledge_items_file_idx ON knowledge_items(file_path);
		`);
	}
}

function rowToItem(row: KnowledgeItemRow): KnowledgeItem {
	return {
		id: row.id,
		scope: row.scope,
		claim: row.claim,
		sourceRefs: JSON.parse(row.source_refs) as string[],
		confidence: row.confidence,
		filePath: row.file_path,
		contentHash: row.content_hash,
		supersedes: row.supersedes,
		supersededBy: row.superseded_by,
		staleAt: row.stale_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
