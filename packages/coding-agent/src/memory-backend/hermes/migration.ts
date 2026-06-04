import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Settings } from "../../config/settings";
import { FAILURE_FILE, MEMORY_FILE, USER_FILE } from "./constants";
import { createHermesMemoryConfig, HermesMemoryRuntime } from "./index";
import type { MemoryTarget } from "./types";

const LEGACY_RELATIVE_DIRS = [".pi/agent/pi-hermes-memory", ".pi/agent/memory", ".pi/agent/projects-memory"] as const;
const LEGACY_FILE_TARGETS: ReadonlyArray<{ names: readonly string[]; target: MemoryTarget }> = [
	{ names: [MEMORY_FILE, "memory.md", "MEMORY", "memory"], target: "memory" },
	{ names: [USER_FILE, "user.md", "USER", "user"], target: "user" },
	{ names: [FAILURE_FILE, "FAILURES.md", "failures", "failure.md", "FAILURE.md"], target: "failure" },
];

export interface HermesMigrationSource {
	path: string;
	exists: boolean;
}

export interface HermesMigrationEntry {
	sourcePath: string;
	target: MemoryTarget;
	content: string;
}

export interface HermesMigrationPlan {
	from: "pi-hermes";
	legacyDirs: HermesMigrationSource[];
	destinationDir: string;
	entries: HermesMigrationEntry[];
}

export interface HermesMigrationResult extends HermesMigrationPlan {
	applied: boolean;
	added: number;
	duplicates: number;
	failed: Array<{ sourcePath: string; error: string }>;
}

export interface HermesSyncResult {
	backend: "hermes";
	destinationDir: string;
	before: number;
	after: number;
	added: number;
}

function legacyDirs(homeDir = process.env.AMAZE_HERMES_LEGACY_HOME ?? os.homedir()): string[] {
	return LEGACY_RELATIVE_DIRS.map(relative => path.join(homeDir, relative));
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(entryPath)));
		else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(entryPath);
	}
	return files;
}

function targetForFile(filePath: string): MemoryTarget {
	const base = path.basename(filePath);
	for (const candidate of LEGACY_FILE_TARGETS) {
		if (candidate.names.includes(base)) return candidate.target;
	}
	return "memory";
}

function splitEntries(raw: string): string[] {
	const normalized = raw.trim();
	if (!normalized) return [];
	if (normalized.includes("\n§\n"))
		return normalized
			.split("\n§\n")
			.map(entry => entry.trim())
			.filter(Boolean);
	const bulletLines = normalized
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);
	if (bulletLines.length > 1 && bulletLines.every(line => /^[-*•]\s+/.test(line))) {
		return bulletLines.map(line => line.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
	}
	return [normalized];
}

export async function buildPiHermesMigrationPlan(options: {
	agentDir: string;
	settings: Settings;
	homeDir?: string;
}): Promise<HermesMigrationPlan> {
	const config = createHermesMemoryConfig({
		settings: options.settings,
		agentDir: options.agentDir,
		cwd: process.cwd(),
	});
	const dirs = legacyDirs(options.homeDir);
	const legacyDirEntries = await Promise.all(dirs.map(async dir => ({ path: dir, exists: await exists(dir) })));
	const entries: HermesMigrationEntry[] = [];
	const seen = new Set<string>();
	for (const dir of legacyDirEntries) {
		if (!dir.exists) continue;
		for (const filePath of await collectMarkdownFiles(dir.path)) {
			const target = targetForFile(filePath);
			const raw = await fs.readFile(filePath, "utf-8");
			for (const content of splitEntries(raw)) {
				const key = `${target}\0${content}`;
				if (seen.has(key)) continue;
				seen.add(key);
				entries.push({ sourcePath: filePath, target, content });
			}
		}
	}
	return { from: "pi-hermes", legacyDirs: legacyDirEntries, destinationDir: config.memoryDir, entries };
}

export async function applyPiHermesMigration(options: {
	agentDir: string;
	settings: Settings;
	homeDir?: string;
	dryRun: boolean;
}): Promise<HermesMigrationResult> {
	const plan = await buildPiHermesMigrationPlan(options);
	if (options.dryRun) return { ...plan, applied: false, added: 0, duplicates: 0, failed: [] };
	const runtime = new HermesMemoryRuntime(
		createHermesMemoryConfig({ settings: options.settings, agentDir: options.agentDir, cwd: process.cwd() }),
	);
	try {
		await runtime.load();
		let added = 0;
		let duplicates = 0;
		const failed: HermesMigrationResult["failed"] = [];
		for (const entry of plan.entries) {
			const before = runtime.profile()[entry.target === "failure" ? "failures" : entry.target].length;
			const result = await runtime.add(entry.target, entry.content);
			if (!result.success) {
				failed.push({
					sourcePath: entry.sourcePath,
					error: result.error ?? "Unknown Hermes memory write failure.",
				});
				continue;
			}
			const after = runtime.profile()[entry.target === "failure" ? "failures" : entry.target].length;
			if (after > before) added += 1;
			else duplicates += 1;
		}
		return { ...plan, applied: true, added, duplicates, failed };
	} finally {
		runtime.close();
	}
}

export async function syncHermesMarkdownToSqlite(options: {
	agentDir: string;
	settings: Settings;
	cwd?: string;
}): Promise<HermesSyncResult> {
	const runtime = new HermesMemoryRuntime(
		createHermesMemoryConfig({
			settings: options.settings,
			agentDir: options.agentDir,
			cwd: options.cwd ?? process.cwd(),
		}),
	);
	try {
		await runtime.store.load();
		const before = runtime.db.getDb().prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
		await runtime.sync();
		const after = runtime.db.getDb().prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number };
		return {
			backend: "hermes",
			destinationDir: runtime.config.memoryDir,
			before: before.count,
			after: after.count,
			added: Math.max(0, after.count - before.count),
		};
	} finally {
		runtime.close();
	}
}
