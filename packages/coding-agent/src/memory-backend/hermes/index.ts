import * as path from "node:path";
import {
	DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
	DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
	DEFAULT_MEMORY_CHAR_LIMIT,
	DEFAULT_USER_CHAR_LIMIT,
	MEMORY_POLICY_PROMPT,
	MEMORY_POLICY_PROMPT_COMPACT,
} from "./constants";
import { DatabaseManager } from "./db";
import { MemoryStore } from "./memory-store";
import {
	addMemory,
	getMemories,
	parseMarkdownMemoryEntry,
	removeExactSyncedMemories,
	searchMemories,
	syncMemoryEntry,
	touchMemory,
} from "./sqlite-memory-store";
import type {
	AddFailureOptions,
	CreateHermesMemoryConfigOptions,
	HermesMemoryConfig,
	HermesMemoryEntry,
	HermesMemorySearchOptions,
	HermesProfile,
	MemoryCategory,
	MemoryResult,
	MemoryTarget,
} from "./types";

export * from "./constants";
export * from "./content-scanner";
export * from "./db";
export * from "./fts-query";
export * from "./memory-store";
export * from "./migration";
export * from "./sqlite-memory-store";
export * from "./types";

function settingNumber(settings: CreateHermesMemoryConfigOptions["settings"], key: string, fallback: number): number {
	try {
		const value = settings?.get(key as never) as number | undefined;
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
	} catch {
		return fallback;
	}
}

function settingString(
	settings: CreateHermesMemoryConfigOptions["settings"],
	key: string,
	fallback?: string,
): string | undefined {
	try {
		const value = settings?.get(key as never) as string | undefined;
		return typeof value === "string" && value.trim() ? value : fallback;
	} catch {
		return fallback;
	}
}

export function createHermesMemoryConfig(options: CreateHermesMemoryConfigOptions): HermesMemoryConfig {
	const settings = options.settings;
	return {
		memoryDir: path.resolve(options.memoryDir ?? path.join(options.agentDir, "hermes-memory")),
		cwd: path.resolve(options.cwd),
		memoryMode:
			settingString(settings, "memory.hermes.mode", "policy-only") === "legacy-inject"
				? "legacy-inject"
				: "policy-only",
		memoryPolicyStyle:
			(settingString(settings, "memory.hermes.policyStyle", "full") as HermesMemoryConfig["memoryPolicyStyle"]) ??
			"full",
		memoryPolicyCustomText: settingString(settings, "memory.hermes.policyCustomText"),
		memoryCharLimit: settingNumber(settings, "memory.hermes.memoryCharLimit", DEFAULT_MEMORY_CHAR_LIMIT),
		userCharLimit: settingNumber(settings, "memory.hermes.userCharLimit", DEFAULT_USER_CHAR_LIMIT),
		failureInjectionEnabled: true,
		failureInjectionMaxAgeDays: settingNumber(
			settings,
			"memory.hermes.failureInjectionMaxAgeDays",
			DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
		),
		failureInjectionMaxEntries: settingNumber(
			settings,
			"memory.hermes.failureInjectionMaxEntries",
			DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
		),
		memoryOverflowStrategy:
			settingString(settings, "memory.hermes.overflowStrategy", "reject") === "fifo-evict" ? "fifo-evict" : "reject",
	};
}

export function resolveMemoryPolicyPrompt(
	config: Pick<HermesMemoryConfig, "memoryPolicyStyle" | "memoryPolicyCustomText">,
): string {
	switch (config.memoryPolicyStyle ?? "full") {
		case "compact":
			return MEMORY_POLICY_PROMPT_COMPACT;
		case "custom":
			return config.memoryPolicyCustomText?.trim() || MEMORY_POLICY_PROMPT_COMPACT;
		case "none":
			return "";
		default:
			return MEMORY_POLICY_PROMPT;
	}
}

export class HermesMemoryRuntime {
	readonly store: MemoryStore;
	readonly db: DatabaseManager;

	constructor(readonly config: HermesMemoryConfig) {
		this.store = new MemoryStore(config);
		this.db = new DatabaseManager(config.memoryDir);
	}

	async load(): Promise<void> {
		await this.store.load();
		await this.sync();
	}

	async clear(): Promise<void> {
		await this.store.clear();
		this.db.clear();
	}

	async add(target: MemoryTarget, content: string): Promise<MemoryResult> {
		const before = this.store.getEntries(target);
		const result = await this.store.add(target, content);
		if (result.success) {
			const after = new Set(this.store.getEntries(target));
			for (const entry of before) if (!after.has(entry)) removeExactSyncedMemories(this.db, entry, { target });
			await this.syncTarget(target);
		}
		return result;
	}

	async addFailure(content: string, options: AddFailureOptions): Promise<MemoryResult> {
		const result = await this.store.addFailure(content, options);
		if (result.success) await this.syncTarget("failure");
		return result;
	}

	async replace(target: MemoryTarget, oldText: string, newContent: string): Promise<MemoryResult> {
		const result = await this.store.replace(target, oldText, newContent);
		if (result.success) await this.sync();
		return result;
	}

	async remove(target: MemoryTarget, oldText: string): Promise<MemoryResult> {
		const before = this.store.getEntries(target);
		const result = await this.store.remove(target, oldText);
		if (result.success) {
			const after = new Set(this.store.getEntries(target));
			for (const entry of before) if (!after.has(entry)) removeExactSyncedMemories(this.db, entry, { target });
			await this.syncTarget(target);
		}
		return result;
	}

	search(query: string, options: HermesMemorySearchOptions = {}): HermesMemoryEntry[] {
		const results = searchMemories(this.db, query, options);
		for (const result of results) touchMemory(this.db, result.id);
		return results;
	}

	profile(): HermesProfile {
		return {
			memory: this.store.getEntries("memory"),
			user: this.store.getEntries("user"),
			failures: this.store.getEntries("failure"),
		};
	}

	async sync(): Promise<void> {
		await Promise.all([this.syncTarget("memory"), this.syncTarget("user"), this.syncTarget("failure")]);
	}

	buildPromptContext(): string {
		if (this.config.memoryMode === "policy-only") return resolveMemoryPolicyPrompt(this.config);
		return this.store.formatForSystemPrompt();
	}

	async checkpoint(content: string, target: MemoryTarget = "memory"): Promise<MemoryResult> {
		return this.add(target, content);
	}

	async addLocalEntry(
		content: string,
		options: { category: MemoryCategory; project?: string | null; target?: MemoryTarget },
	): Promise<MemoryResult> {
		const trimmed = content.trim();
		const target = options.target ?? "memory";
		if (!trimmed) return { success: false, error: "Content cannot be empty." };
		const existingCount = getMemories(this.db, {
			target,
			project: options.project ?? this.config.cwd,
			category: options.category,
		}).length;
		const entry = addMemory(this.db, {
			content: trimmed,
			target,
			project: options.project ?? this.config.cwd,
			category: options.category,
		});
		return { success: true, target: entry.target, entry_count: existingCount + 1, message: "Local entry added." };
	}

	close(): void {
		this.db.close();
	}

	private async syncTarget(target: MemoryTarget): Promise<void> {
		for (const rawEntry of this.store.getEntries(target, true))
			syncMemoryEntry(this.db, parseMarkdownMemoryEntry(rawEntry, target));
	}
}

export function getHermesMemories(
	runtime: HermesMemoryRuntime,
	options: HermesMemorySearchOptions = {},
): HermesMemoryEntry[] {
	return getMemories(runtime.db, options);
}
