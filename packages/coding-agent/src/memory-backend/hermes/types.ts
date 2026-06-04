import type { Settings } from "../../config/settings";

export type MemoryTarget = "memory" | "user" | "failure";
export type MemoryOverflowStrategy = "reject" | "fifo-evict";
export type MemoryMode = "policy-only" | "legacy-inject";
export type MemoryPolicyStyle = "full" | "compact" | "custom" | "none";

export type MemoryCategory =
	| "failure"
	| "correction"
	| "insight"
	| "preference"
	| "convention"
	| "tool-quirk"
	| "turn_sync"
	| "checkpoint";

export interface HermesMemoryConfig {
	memoryDir: string;
	cwd: string;
	memoryMode: MemoryMode;
	memoryPolicyStyle: MemoryPolicyStyle;
	memoryPolicyCustomText?: string;
	memoryCharLimit: number;
	userCharLimit: number;
	failureInjectionEnabled: boolean;
	failureInjectionMaxAgeDays: number;
	failureInjectionMaxEntries: number;
	memoryOverflowStrategy: MemoryOverflowStrategy;
}

export interface CreateHermesMemoryConfigOptions {
	settings?: Settings;
	agentDir: string;
	cwd: string;
	memoryDir?: string;
}

export interface MemoryResult {
	success: boolean;
	error?: string;
	message?: string;
	target?: MemoryTarget;
	usage?: string;
	entry_count?: number;
	evicted_entries?: string[];
	evicted_count?: number;
	matches?: string[];
}

export interface MemorySnapshot {
	memory: string;
	user: string;
}

export interface AddFailureOptions {
	category: MemoryCategory;
	failureReason?: string;
	toolState?: string;
	correctedTo?: string;
	project?: string;
}

export interface HermesMemoryEntry {
	id: number;
	project: string | null;
	target: MemoryTarget;
	category: MemoryCategory | null;
	content: string;
	failureReason: string | null;
	toolState: string | null;
	correctedTo: string | null;
	created: string;
	lastReferenced: string;
}

export interface HermesMemorySearchOptions {
	target?: MemoryTarget;
	project?: string | null;
	category?: MemoryCategory;
	limit?: number;
}

export interface HermesProfile {
	memory: string[];
	user: string[];
	failures: string[];
}
