export type RockeyMemoryTarget = "memory" | "user" | "project" | "failure";
export type RockeyStoredTarget = "memory" | "user" | "failure";

export type RockeyMemoryCategory = "failure" | "correction" | "insight" | "preference" | "convention" | "tool-quirk";

export interface RockeyScope {
	kind: "global" | "project";
	key: string | null;
	displayName: string;
	cwd: string | null;
}

export interface RockeyMemoryEntry {
	id: number;
	scopeKind: "global" | "project";
	scopeKey: string | null;
	displayName: string;
	cwd: string | null;
	target: RockeyStoredTarget;
	category: RockeyMemoryCategory | null;
	content: string;
	failureReason: string | null;
	toolState: string | null;
	correctedTo: string | null;
	createdAt: string;
	updatedAt: string;
	lastReferencedAt: string;
}

export interface RockeyMutationResult {
	success: boolean;
	error?: string;
	message?: string;
	entry?: RockeyMemoryEntry;
	entries?: RockeyMemoryEntry[];
	target?: RockeyMemoryTarget;
}
