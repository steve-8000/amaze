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
	action: "migrate-legacy" | "doctor" | "search" | "mark-superseded" | "quarantine";
	from?: LegacyOrigin;
	query?: string;
	id?: string;
	dryRun?: boolean;
	advanced?: boolean;
	scope?: "current_project" | "global" | "knowledge" | "failure" | "session" | "all";
	limit?: number;
	json?: boolean;
	reason?: string;
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
	if (args.action === "search") {
		runMemorySearchCommand({
			query: args.query ?? "",
			advanced: args.advanced,
			scope: args.scope,
			limit: args.limit,
			json: args.json,
		});
		return;
	}
	if (args.action === "mark-superseded" || args.action === "quarantine") {
		if (!args.id) throw new Error(`memory ${args.action} requires an id`);
		runMemoryTransitionCommand({ action: args.action, id: args.id, reason: args.reason, json: args.json });
		return;
	}
	if (args.action !== "migrate-legacy") {
		throw new Error(`Unknown memory action: ${String(args.action)}`);
	}
	if (!args.from) throw new Error("memory migrate-legacy requires an origin");
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

export function runMemorySearchCommand(args: {
	query: string;
	advanced?: boolean;
	scope?: "current_project" | "global" | "knowledge" | "failure" | "session" | "all";
	limit?: number;
	json?: boolean;
}): void {
	const query = args.query.trim();
	if (!query) throw new Error("memory search requires a query");
	const store = new NexusStore({ agentDir: getAgentDir(), cwd: getProjectDir() });
	try {
		const entries = store.search({
			query,
			scope: args.scope ?? "current_project",
			limit: args.limit ?? 8,
			advancedQuery: args.advanced === true,
		});
		const rows = entries.map(entry => ({
			id: entry.id,
			status: entry.status,
			content: entry.content,
			provenance: entry.provenance,
			source: entry.scopeKind,
		}));
		if (args.json) {
			process.stdout.write(`${JSON.stringify(rows)}\n`);
			return;
		}
		if (rows.length === 0) {
			process.stdout.write("No Nexus memory results.\n");
			return;
		}
		process.stdout.write(
			[
				"ID\tSTATUS\tSOURCE\tPROVENANCE\tCONTENT",
				...rows.map(row =>
					[row.id, row.status, row.source, row.provenance, truncateContent(row.content, 120)].join("\t"),
				),
				"",
			].join("\n"),
		);
	} finally {
		store.close();
	}
}

export function runMemoryTransitionCommand(args: {
	action: "mark-superseded" | "quarantine";
	id: string;
	reason?: string;
	json?: boolean;
}): void {
	const store = new NexusStore({ agentDir: getAgentDir(), cwd: getProjectDir() });
	try {
		process.exitCode = 0;
		const result =
			args.action === "mark-superseded"
				? store.markSuperseded(args.id, args.reason)
				: store.quarantine(args.id, args.reason);
		if (!result.success || !result.entry) {
			process.stderr.write(`${result.error ?? `No memory found for id '${args.id}'.`}\n`);
			process.exitCode = 1;
			return;
		}
		const output = {
			id: result.entry.id,
			status: result.entry.status,
			prevStatus: result.prevStatus,
			reason: result.reason,
		};
		if (args.json) {
			process.stdout.write(`${JSON.stringify(output)}\n`);
			return;
		}
		process.stdout.write(`${output.id}\t${output.prevStatus}->${output.status}\n`);
	} finally {
		store.close();
	}
}

function truncateContent(content: string, maxLength: number): string {
	const normalized = content.replace(/\s+/g, " ").trim();
	return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
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
