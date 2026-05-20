import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@amaze/utils";
import type { RockeyStore } from "./store";
import type { RockeyMemoryCategory, RockeyMemoryTarget } from "./types";

const ENTRY_DELIMITER = "\n§\n";

export async function importPiHermesMemoryOnce(store: RockeyStore): Promise<void> {
	const sentinelDir = path.dirname(store.dbPath);
	const globalSentinel = path.join(sentinelDir, ".pi-hermes-imported-global");
	const projectSentinel = path.join(sentinelDir, `.pi-hermes-imported-${store.scope.key ?? "global"}`);
	const needsGlobal = !(await sentinelExists(globalSentinel));
	const needsProject = store.scope.kind === "project" && !(await sentinelExists(projectSentinel));
	if (!needsGlobal && !needsProject) return;

	const agentRoot = path.join(os.homedir(), ".pi", "agent");
	const candidates = [path.join(agentRoot, "pi-hermes-memory"), path.join(agentRoot, "memory")];

	try {
		for (const dir of candidates) {
			if (needsGlobal) {
				await importMarkdownFile(store, path.join(dir, "MEMORY.md"), "memory");
				await importMarkdownFile(store, path.join(dir, "USER.md"), "user");
				await importMarkdownFile(store, path.join(dir, "failures.md"), "failure");
			}
			await importSqliteMemories(store, path.join(dir, "sessions.db"), {
				includeGlobal: needsGlobal,
				includeProject: needsProject,
			});
		}
		if (needsProject) {
			await importProjectMarkdownMemories(agentRoot, store);
		}
		await fs.mkdir(sentinelDir, { recursive: true });
		if (needsGlobal) await Bun.write(globalSentinel, `${new Date().toISOString()}\n`);
		if (needsProject) await Bun.write(projectSentinel, `${new Date().toISOString()}\n`);
		await store.renderArtifacts();
	} catch (err) {
		logger.debug("Rockey pi-hermes-memory import failed", { error: String(err) });
	}
}

async function importMarkdownFile(store: RockeyStore, filePath: string, target: RockeyMemoryTarget): Promise<void> {
	let raw: string;
	try {
		raw = await Bun.file(filePath).text();
	} catch (err) {
		if (isEnoent(err)) return;
		throw err;
	}
	for (const entry of parseEntries(raw)) {
		store.add({ target, content: stripMetadata(entry) });
	}
}

async function importProjectMarkdownMemories(agentRoot: string, store: RockeyStore): Promise<void> {
	const projectName = store.scope.displayName;
	if (!projectName) return;
	const candidates = [path.join(agentRoot, "projects-memory", projectName), path.join(agentRoot, projectName)];
	for (const dir of candidates) {
		await importMarkdownFile(store, path.join(dir, "MEMORY.md"), "project");
		await importMarkdownFile(store, path.join(dir, "failures.md"), "failure");
	}
}

interface LegacyMemoryRow {
	project: string | null;
	target: string;
	category: string | null;
	content: string;
	failure_reason: string | null;
	tool_state: string | null;
	corrected_to: string | null;
}

async function sentinelExists(filePath: string): Promise<boolean> {
	try {
		await Bun.file(filePath).text();
		return true;
	} catch (err) {
		return !isEnoent(err);
	}
}

async function importSqliteMemories(
	store: RockeyStore,
	dbPath: string,
	options: { includeGlobal: boolean; includeProject: boolean },
): Promise<void> {
	try {
		await fs.stat(dbPath);
	} catch (err) {
		if (isEnoent(err)) return;
		throw err;
	}

	const db = new Database(dbPath, { readonly: true });
	try {
		const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get() as
			| { name: string }
			| undefined;
		if (!table) return;

		const rows = db
			.prepare(
				"SELECT project, target, category, content, failure_reason, tool_state, corrected_to FROM memories ORDER BY id ASC",
			)
			.all() as LegacyMemoryRow[];
		for (const row of rows) {
			const content = row.content.trim();
			if (!content) continue;
			const project = row.project?.trim();
			const target = legacyTargetFor(row.target, project, store.scope.displayName, options);
			if (!target) continue;
			store.add({
				target,
				content,
				category: legacyCategoryFor(row.category),
				failureReason: row.failure_reason,
				toolState: row.tool_state,
				correctedTo: row.corrected_to,
			});
		}
	} finally {
		db.close(false);
	}
}

function legacyTargetFor(
	target: string,
	project: string | undefined,
	currentProject: string,
	options: { includeGlobal: boolean; includeProject: boolean },
): RockeyMemoryTarget | null {
	if (!project)
		return options.includeGlobal && (target === "memory" || target === "user" || target === "failure")
			? target
			: null;
	if (project === currentProject && target === "memory") return options.includeProject ? "project" : null;
	if (project === currentProject && target === "failure") return options.includeProject ? "failure" : null;
	return null;
}

function legacyCategoryFor(category: string | null): RockeyMemoryCategory | null {
	switch (category) {
		case "failure":
		case "correction":
		case "insight":
		case "preference":
		case "convention":
		case "tool-quirk":
			return category;
		default:
			return null;
	}
}

function parseEntries(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	if (trimmed.includes(ENTRY_DELIMITER))
		return trimmed
			.split(ENTRY_DELIMITER)
			.map(entry => entry.trim())
			.filter(Boolean);
	return trimmed
		.split("\n")
		.map(line => line.replace(/^[-*]\s+/, "").trim())
		.filter(line => line.length > 0 && !line.startsWith("#") && !line.startsWith("_No entries"));
}

function stripMetadata(entry: string): string {
	return entry.replace(/\s*<!--\s*[^>]*-->\s*$/, "").trim();
}
