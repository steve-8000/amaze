import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { getNexusSessionDbPath } from "./session-search";
import { getNexusDbPath, getNexusKnowledgeDbPath, openNexusDb } from "./store";

export interface MemoryPlaneAliases {
	knowledge: boolean;
	sessions: boolean;
}

export interface MemoryPlaneContext {
	db: Database;
	aliases: MemoryPlaneAliases;
}

/**
 * Read-only ATTACH-at-query-time bridge across the three Nexus SQLite files.
 * Always opens the canonical `nexus.db` (creating an empty one if missing so callers
 * never crash on a fresh agentDir). Attempts to ATTACH `nexus-knowledge.db` and
 * `nexus-sessions.db` ONLY when they already exist on disk so we never accidentally
 * materialize empty sibling files on a read.
 *
 * Inside the callback you can reference:
 *   - main schema tables directly: `memory_items`, `memory_scopes`, ...
 *   - knowledge alias when `aliases.knowledge`: `knowledge.knowledge_documents`, `knowledge.knowledge_chunks`, ...
 *   - sessions alias when `aliases.sessions`: `sessions.nexus_sessions`, `sessions.nexus_session_messages`, ...
 */
export function withMemoryPlane<T>(agentDir: string, fn: (ctx: MemoryPlaneContext) => T): T {
	// Open canonical nexus.db via existing helper to inherit schema init + PRAGMAs.
	const db = openNexusDb(getNexusDbPath(agentDir));
	try {
		const aliases: MemoryPlaneAliases = { knowledge: false, sessions: false };
		const knowledgePath = getNexusKnowledgeDbPath(agentDir);
		if (fs.existsSync(knowledgePath)) {
			db.exec(`ATTACH DATABASE '${knowledgePath.replace(/'/g, "''")}' AS knowledge`);
			aliases.knowledge = true;
		}
		const sessionsPath = getNexusSessionDbPath(agentDir);
		if (fs.existsSync(sessionsPath)) {
			db.exec(`ATTACH DATABASE '${sessionsPath.replace(/'/g, "''")}' AS sessions`);
			aliases.sessions = true;
		}
		try {
			return fn({ db, aliases });
		} finally {
			if (aliases.sessions) {
				try {
					db.exec("DETACH DATABASE sessions");
				} catch {}
			}
			if (aliases.knowledge) {
				try {
					db.exec("DETACH DATABASE knowledge");
				} catch {}
			}
		}
	} finally {
		db.close(false);
	}
}
