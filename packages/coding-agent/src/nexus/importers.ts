import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@amaze/utils";
import { getMemoryRoot } from "../memories";
import { loadHindsightConfig, type HindsightConfig, isHindsightConfigured } from "../hindsight/config";
import { HindsightApi } from "../hindsight/client";
import { getRockeyDbPath, RockeyStore } from "../rockey/store";
import type { Settings } from "../config/settings";
import { scopeForTarget, staticNexusScope } from "./scope";
import { NexusStore } from "./store";

interface ImportStats {
	rockey: number;
	local: number;
	hindsight: number;
}

export async function importLegacyMemorySources(
	store: NexusStore,
	settings: Settings,
	options: { rockey: boolean; local: boolean; hindsight: boolean },
): Promise<ImportStats> {
	const stats: ImportStats = { rockey: 0, local: 0, hindsight: 0 };
	if (options.rockey) stats.rockey = await importRockeyMemory(store);
	if (options.local) stats.local = await importLocalMemory(store, settings);
	if (options.hindsight) stats.hindsight = await importHindsightMemory(store, loadHindsightConfig(settings));
	return stats;
}

async function importRockeyMemory(store: NexusStore): Promise<number> {
	const rockeyDbPath = getRockeyDbPath(store.options.agentDir);
	try {
		await fs.access(rockeyDbPath);
	} catch {
		return 0;
	}
	const rockey = new RockeyStore({ agentDir: store.options.agentDir, cwd: store.options.cwd });
	try {
		const entries = rockey.list({ scope: undefined, includeGlobal: true, limit: 5000 });
		let imported = 0;
		for (const entry of entries) {
			const target =
				entry.target === "memory" ? (entry.scopeKind === "project" ? "project" : "memory") : entry.target;
			const scope =
				entry.scopeKind === "project" && entry.cwd
					? scopeForTarget("project", entry.cwd)
					: target === "user"
						? staticNexusScope("user")
						: target === "failure"
							? staticNexusScope("failure")
							: target === "memory"
								? staticNexusScope("global")
								: staticNexusScope("knowledge");
			const result = store.add({
				target,
				content: entry.content,
				category: entry.category,
				confidence: "imported_unverified",
				provenance: `old_rockey:${entry.id}`,
				sourceKind: "old_rockey",
				sourcePath: rockeyDbPath,
				sourceRecordId: String(entry.id),
				scope,
			});
			if (result.success) imported += 1;
		}
		return imported;
	} finally {
		rockey.close();
	}
}

async function importLocalMemory(store: NexusStore, settings: Settings): Promise<number> {
	const memoryRoot = getMemoryRoot(store.options.agentDir, settings.getCwd());
	const candidates = [
		path.join(memoryRoot, "MEMORY.md"),
		path.join(memoryRoot, "memory_summary.md"),
		path.join(memoryRoot, "raw_memories.md"),
	];
	let imported = 0;
	for (const file of candidates) {
		const text = await Bun.file(file)
			.text()
			.catch(() => "");
		if (!text.trim()) continue;
		const target = file.endsWith("memory_summary.md") ? "knowledge" : "project";
		const result = store.add({
			target,
			content: text.trim(),
			confidence: "imported_unverified",
			provenance: `old_local:${path.basename(file)}`,
			sourceKind: "old_local",
			sourcePath: file,
			scope: target === "project" ? scopeForTarget("project", store.options.cwd) : staticNexusScope("knowledge"),
		});
		if (result.success) imported += 1;
	}
	const rolloutDir = path.join(memoryRoot, "rollout_summaries");
	const rolloutFiles = await fs.readdir(rolloutDir).catch(() => [] as string[]);
	for (const name of rolloutFiles) {
		if (!name.endsWith(".md")) continue;
		const file = path.join(rolloutDir, name);
		const text = await Bun.file(file)
			.text()
			.catch(() => "");
		if (!text.trim()) continue;
		const result = store.add({
			target: "project",
			content: text.trim(),
			memoryType: "workflow",
			confidence: "imported_unverified",
			provenance: `old_local_rollout:${name}`,
			sourceKind: "old_local",
			sourcePath: file,
			scope: scopeForTarget("project", store.options.cwd),
		});
		if (result.success) imported += 1;
	}
	const skillsDir = path.join(memoryRoot, "skills");
	const skills = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as Awaited<ReturnType<typeof fs.readdir>>);
	for (const dirent of skills) {
		if (!dirent.isDirectory()) continue;
		const dirName = dirent.name.toString();
		const file = path.join(skillsDir, dirName, "SKILL.md");
		const text = await Bun.file(file)
			.text()
			.catch(() => "");
		if (!text.trim()) continue;
		const result = store.add({
			target: "project",
			content: text.trim(),
			memoryType: "skill_candidate",
			confidence: "imported_unverified",
			provenance: `old_local_skill:${dirName}`,
			sourceKind: "old_local",
			sourcePath: file,
			scope: scopeForTarget("project", store.options.cwd),
		});
		if (result.success) imported += 1;
	}
	return imported;
}

async function importHindsightMemory(store: NexusStore, config: HindsightConfig): Promise<number> {
	if (!isHindsightConfigured(config) || !config.bankId) return 0;
	try {
		const client = new HindsightApi({ baseUrl: config.hindsightApiUrl, apiKey: config.hindsightApiToken ?? undefined });
		const response = await client.listMemories(config.bankId, { limit: 100, offset: 0 });
		const results = Array.isArray(response?.results) ? response.results : [];
		let imported = 0;
		for (const item of results) {
			const text = typeof item.text === "string" ? item.text.trim() : "";
			if (!text) continue;
			const scope = config.scoping === "global" ? staticNexusScope("global") : scopeForTarget("project", store.options.cwd);
			const target = config.scoping === "global" ? "memory" : "project";
			const result = store.add({
				target,
				content: text,
				confidence: "imported_unverified",
				provenance: `old_hindsight:${String(item.id ?? "memory")}`,
				sourceKind: "old_hindsight",
				sourcePath: config.hindsightApiUrl,
				sourceRecordId: typeof item.id === "string" ? item.id : undefined,
				scope,
			});
			if (result.success) imported += 1;
		}
		return imported;
	} catch (error) {
		logger.debug("Nexus Hindsight import skipped", { error: String(error) });
		return 0;
	}
}
