import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, getProjectDir } from "@amaze/utils";
import { type NexusDegradationStatus, nexusBackend } from "../memory-backend/nexus-backend";
import { NexusStore } from "../nexus/store";

type LegacyOrigin = "rockey" | "hindsight";

export interface MemoryMigrateLegacyArgs {
	from: LegacyOrigin;
	dryRun?: boolean;
}

export interface MemoryCommandArgs {
	action: "migrate-legacy" | "doctor";
	from: LegacyOrigin;
	dryRun?: boolean;
}

export interface MemoryDoctorReport {
	status: "ok" | "degraded";
	degradation: NexusDegradationStatus;
	text: string;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}

async function listDbFiles(dir: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter(entry => entry.isFile() && entry.name.endsWith(".db"))
			.map(entry => path.join(dir, entry.name))
			.sort();
	} catch {
		return [];
	}
}

async function findLegacyDbs(origin: LegacyOrigin): Promise<string[]> {
	const home = process.env.HOME ?? os.homedir();
	const candidates =
		origin === "rockey"
			? [path.join(home, ".rockey"), path.join(home, ".amaze", "rockey")]
			: [path.join(home, ".amaze", "hindsight"), path.join(home, ".hindsight")];
	const files = new Set<string>();
	for (const dir of candidates) {
		for (const file of await listDbFiles(dir)) {
			files.add(file);
		}
	}
	return [...files].filter(fileExists);
}

interface LegacyRow {
	id: string;
	content: string;
}

function getTableNames(db: Database): string[] {
	return db
		.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all()
		.map(row => String((row as { name: unknown }).name));
}

function getColumnNames(db: Database, table: string): string[] {
	return db
		.query(`PRAGMA table_info(${JSON.stringify(table)})`)
		.all()
		.map(row => String((row as { name: unknown }).name));
}

function quoteIdent(identifier: string): string {
	return JSON.stringify(identifier);
}

function extractLegacyRows(dbPath: string): LegacyRow[] {
	const db = new Database(dbPath, { readonly: true, strict: true });
	try {
		const rows: LegacyRow[] = [];
		for (const table of getTableNames(db)) {
			const columns = getColumnNames(db, table);
			const contentColumn = ["content", "text", "memory", "value"].find(column => columns.includes(column));
			if (!contentColumn) continue;
			const idColumn = ["id", "key", "uuid"].find(column => columns.includes(column));
			const sql = idColumn
				? `SELECT ${quoteIdent(idColumn)} AS id, ${quoteIdent(contentColumn)} AS content FROM ${quoteIdent(table)}`
				: `SELECT rowid AS id, ${quoteIdent(contentColumn)} AS content FROM ${quoteIdent(table)}`;
			for (const row of db.query(sql).all() as Array<{ id: unknown; content: unknown }>) {
				if (typeof row.content !== "string") continue;
				const content = row.content.trim();
				if (!content) continue;
				rows.push({ id: `${table}:${String(row.id)}`, content });
			}
		}
		return rows;
	} finally {
		db.close(false);
	}
}

export async function runMemoryCommand(args: MemoryCommandArgs): Promise<void> {
	if (args.action === "doctor") {
		runMemoryDoctorCommand();
		return;
	}
	if (args.action !== "migrate-legacy") {
		throw new Error(`Unknown memory action: ${String(args.action)}`);
	}
	await runMemoryMigrateLegacyCommand({ from: args.from, dryRun: args.dryRun });
}

export function getMemoryDoctorReport(): MemoryDoctorReport {
	const degradation = nexusBackend.getDegradationStatus();
	const status = Object.values(degradation).some(Boolean) ? "degraded" : "ok";
	const lineFor = (label: string, value: string | undefined) => `- ${label}: ${value || "ok"}`;
	const text = [
		`Nexus status: ${status}`,
		lineFor("maintenance", degradation.maintenance),
		lineFor("session-reindex", degradation.sessionReindex),
		lineFor("knowledge-migration", degradation.knowledgeMigration),
	].join("\n");
	return { status, degradation, text };
}

export function runMemoryDoctorCommand(): void {
	process.stdout.write(`${getMemoryDoctorReport().text}\n`);
}

export async function runMemoryMigrateLegacyCommand(args: MemoryMigrateLegacyArgs): Promise<void> {
	const dbPaths = await findLegacyDbs(args.from);
	if (dbPaths.length === 0) {
		process.stdout.write(`no legacy data found for ${args.from}\n`);
		return;
	}

	const rowsByDb = dbPaths.map(dbPath => ({ dbPath, rows: extractLegacyRows(dbPath) }));
	const total = rowsByDb.reduce((sum, item) => sum + item.rows.length, 0);
	if (total === 0) {
		process.stdout.write(`no legacy data found for ${args.from}\n`);
		return;
	}
	if (args.dryRun) {
		process.stdout.write(`would import ${total} legacy ${args.from} item(s) from ${dbPaths.length} database(s)\n`);
		return;
	}

	const store = new NexusStore({ agentDir: getAgentDir(), cwd: getProjectDir() });
	try {
		let imported = 0;
		for (const { dbPath, rows } of rowsByDb) {
			for (const row of rows) {
				const result = store.add({
					target: "memory",
					content: row.content,
					memoryType: "imported",
					confidence: "imported_unverified",
					sourceKind: args.from === "rockey" ? "old_rockey" : "old_hindsight",
					sourcePath: dbPath,
					sourceRecordId: row.id,
					provenance: `source:${JSON.stringify({ kind: "imported_legacy", origin: args.from })}`,
				});
				if (result.success) imported++;
			}
		}
		process.stdout.write(`imported ${imported} legacy ${args.from} item(s)\n`);
	} finally {
		store.close();
	}
}
