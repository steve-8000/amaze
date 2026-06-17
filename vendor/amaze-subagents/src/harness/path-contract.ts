/// <reference types="node" />

import * as path from "node:path";

export const PATH_CONTRACT_ENV = "PI_SUBAGENT_PATH_CONTRACT";

export interface PathContract {
	contract_id?: string;
	mission_id?: string;
	assigned_worker?: string;
	assigned_path?: string;
	depends_on?: string[];
	parallel_group?: string;
	owned_paths?: string[];
	read_allowed_paths?: string[];
	write_allowed_paths?: string[];
	write_denied_paths?: string[];
	activity_budget?: ActivityBudget;
}

export interface ActivityBudget {
	max_tool_uses?: number;
	max_tokens?: number;
	max_elapsed_ms?: number;
}

export interface ActivityBudgetState {
	started_at_ms: number;
	tool_uses: number;
	tokens: number;
}

export interface ToolBoundaryDecision {
	allowed: boolean;
	reason?: string;
	paths: string[];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function hasActivityBudget(budget: ActivityBudget | undefined): boolean {
	return typeof budget?.max_tool_uses === "number"
		|| typeof budget?.max_tokens === "number"
		|| typeof budget?.max_elapsed_ms === "number";
}

function parseBudgetNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseActivityBudget(value: unknown): ActivityBudget | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const budget: ActivityBudget = {
		max_tool_uses: parseBudgetNumber(object.max_tool_uses ?? object.maxToolUses),
		max_tokens: parseBudgetNumber(object.max_tokens ?? object.maxTokens),
		max_elapsed_ms: parseBudgetNumber(object.max_elapsed_ms ?? object.maxElapsedMs),
	};
	return hasActivityBudget(budget) ? budget : undefined;
}

export function parsePathContract(value: unknown): PathContract | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const contract: PathContract = {
		contract_id: typeof object.contract_id === "string" ? object.contract_id : undefined,
		mission_id: typeof object.mission_id === "string" ? object.mission_id : undefined,
		assigned_worker: typeof object.assigned_worker === "string" ? object.assigned_worker : undefined,
		assigned_path: typeof object.assigned_path === "string" ? object.assigned_path : undefined,
		depends_on: asStringArray(object.depends_on ?? object.dependsOn),
		parallel_group: typeof object.parallel_group === "string" ? object.parallel_group : undefined,
		owned_paths: asStringArray(object.owned_paths ?? object.ownedPaths),
		read_allowed_paths: asStringArray(object.read_allowed_paths ?? object.readAllowedPaths),
		write_allowed_paths: asStringArray(object.write_allowed_paths ?? object.writeAllowedPaths),
		write_denied_paths: asStringArray(object.write_denied_paths ?? object.writeDeniedPaths),
		activity_budget: parseActivityBudget(object.activity_budget ?? object.activityBudget),
	};
	if (!contract.write_allowed_paths?.length && contract.owned_paths?.length) {
		contract.write_allowed_paths = contract.owned_paths;
	}
	if (!contract.write_allowed_paths?.length && contract.assigned_path) {
		contract.write_allowed_paths = [`${contract.assigned_path.replace(/\/$/, "")}/**`];
	}
	return contract.write_allowed_paths?.length || contract.read_allowed_paths?.length || hasActivityBudget(contract.activity_budget)
		? contract
		: undefined;
}

export function renderPathContract(contract: PathContract): string {
	return [
		"# Path Execution Contract",
		"",
		"Tools may read only inside `read_allowed_paths` / `owned_paths` when read boundaries are declared.",
		"Mutating tools may write only inside `write_allowed_paths` / `owned_paths`.",
		"Tool calls outside the boundary or activity budget are blocked before execution.",
		"",
		"```json",
		JSON.stringify(contract, null, 2),
		"```",
	].join("\n");
}

function normalizeRelativePath(cwd: string, candidate: string): string {
	const withoutFileUrl = candidate.startsWith("file://") ? new URL(candidate).pathname : candidate;
	const absolute = path.isAbsolute(withoutFileUrl) ? path.resolve(withoutFileUrl) : path.resolve(cwd, withoutFileUrl);
	return path.relative(path.resolve(cwd), absolute).replace(/\\/g, "/").replace(/^$/, ".");
}

function escapeRegex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
	const normalized = glob.replace(/\\/g, "/").replace(/^\.?\//, "");
	let pattern = "";
	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		const next = normalized[i + 1];
		if (char === "*" && next === "*") {
			pattern += ".*";
			i++;
			continue;
		}
		if (char === "*") {
			pattern += "[^/]*";
			continue;
		}
		pattern += escapeRegex(char);
	}
	return new RegExp(`^${pattern}$`);
}

function matchesGlob(relativePath: string, glob: string): boolean {
	const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "");
	const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
	if (normalizedGlob.endsWith("/**")) {
		const base = normalizedGlob.slice(0, -3);
		return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
	}
	return globToRegex(normalizedGlob).test(normalizedPath);
}

function isPathAllowed(cwd: string, candidate: string, contract: PathContract): boolean {
	const relative = normalizeRelativePath(cwd, candidate);
	const denied = contract.write_denied_paths?.some((glob) => matchesGlob(relative, glob)) ?? false;
	if (denied) return false;
	return (contract.write_allowed_paths ?? []).some((glob) => matchesGlob(relative, glob));
}

function stringFromKeys(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function stringsFromKeys(input: Record<string, unknown>, keys: string[]): string[] {
	const values: string[] = [];
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) {
			values.push(value.trim());
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === "string" && item.trim()) values.push(item.trim());
			}
		}
	}
	return values;
}

function normalizeToolName(toolName: string): string {
	const lowerName = toolName.toLowerCase();
	return lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".") + 1) : lowerName;
}

function extractApplyPatchPaths(patch: string): string[] {
	const paths: string[] = [];
	for (const line of patch.split(/\r?\n/)) {
		const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
		if (match?.[1]) paths.push(match[1].trim());
		const move = line.match(/^\*\*\* Move to: (.+)$/);
		if (move?.[1]) paths.push(move[1].trim());
	}
	return paths;
}

function extractBashWritePaths(command: string): string[] {
	const paths: string[] = [];
	const redirectRegex = /(?:^|\s)(?:>>?|2>|&>)\s*(['"]?)([^'"\s;&|]+)\1/g;
	for (const match of command.matchAll(redirectRegex)) {
		if (match[2]) paths.push(match[2]);
	}
	const writeCommands = /\b(?:touch|mkdir|rm|mv|cp)\s+(?:-[^\s]+\s+)*(['"]?)([^'"\s;&|]+)\1/g;
	for (const match of command.matchAll(writeCommands)) {
		if (match[2]) paths.push(match[2]);
	}
	return paths;
}

function extractBashReadPaths(command: string): string[] {
	const paths: string[] = [];
	const readCommands = /\b(?:cat|less|more|head|tail|sed|awk|grep|rg|find|ls|wc)\s+(?:-[^\s]+\s+)*(?![;&|])(['"]?)([^'"\s;&|]+)\1/g;
	for (const match of command.matchAll(readCommands)) {
		if (match[2] && !match[2].startsWith("-")) paths.push(match[2]);
	}
	return paths;
}

export function extractMutatingToolPaths(toolName: string, input: unknown): string[] {
	const object = asObject(input);
	if (!object) return [];
	const lowerName = normalizeToolName(toolName);
	if (lowerName === "edit" || lowerName === "write" || lowerName === "multi_edit" || lowerName === "multiedit") {
		const direct = stringFromKeys(object, ["filePath", "path", "file_path", "targetPath", "target_path"]);
		return direct ? [direct] : [];
	}
	if (lowerName === "apply_patch") {
		const patch = stringFromKeys(object, ["patch", "input", "content", "text"]);
		return patch ? extractApplyPatchPaths(patch) : [];
	}
	if (lowerName === "bash") {
		const command = stringFromKeys(object, ["command", "cmd", "script"]);
		return command ? extractBashWritePaths(command) : [];
	}
	return [];
}

export function extractReadingToolPaths(toolName: string, input: unknown): string[] {
	const object = asObject(input);
	if (!object) return [];
	const lowerName = normalizeToolName(toolName);
	if (lowerName === "read" || lowerName === "open" || lowerName === "view") {
		return stringsFromKeys(object, ["filePath", "path", "file_path", "targetPath", "target_path"]);
	}
	if (lowerName === "grep" || lowerName === "search" || lowerName === "glob" || lowerName === "ls" || lowerName === "list") {
		return stringsFromKeys(object, ["path", "paths", "cwd", "directory", "directories", "root", "roots"]);
	}
	if (lowerName === "bash") {
		const command = stringFromKeys(object, ["command", "cmd", "script"]);
		return command ? extractBashReadPaths(command) : [];
	}
	return [];
}

function readAllowedPatterns(contract: PathContract): string[] {
	return [
		...(contract.read_allowed_paths ?? []),
		...(contract.owned_paths ?? []),
		...(contract.write_allowed_paths ?? []),
	];
}

function isReadPathAllowed(cwd: string, candidate: string, contract: PathContract): boolean {
	const allowed = readAllowedPatterns(contract);
	if (allowed.length === 0) return true;
	const relative = normalizeRelativePath(cwd, candidate);
	return allowed.some((glob) => matchesGlob(relative, glob));
}

export function evaluateReadBoundary(
	contract: PathContract | undefined,
	toolName: string,
	input: unknown,
	cwd = process.cwd(),
): ToolBoundaryDecision {
	if (!contract) return { allowed: true, paths: [] };
	const paths = extractReadingToolPaths(toolName, input);
	if (paths.length === 0) return { allowed: true, paths: [] };
	const blocked = paths.filter((candidate) => !isReadPathAllowed(cwd, candidate, contract));
	if (blocked.length === 0) return { allowed: true, paths };
	return {
		allowed: false,
		paths,
		reason: `Path contract ${contract.contract_id ?? "(unnamed)"} blocks reads outside allowed paths: ${blocked.join(", ")}`,
	};
}

export function createActivityBudgetState(now = Date.now()): ActivityBudgetState {
	return {
		started_at_ms: now,
		tool_uses: 0,
		tokens: 0,
	};
}

function tokenCountFromEvent(event: unknown): number {
	const object = asObject(event);
	if (!object) return 0;
	for (const key of ["tokens", "token_count", "tokenCount"]) {
		const value = object[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	}
	const usage = asObject(object.usage) ?? asObject(object.tokenUsage) ?? asObject(object.token_usage);
	if (!usage) return 0;
	return ["total_tokens", "totalTokens", "input_tokens", "inputTokens", "output_tokens", "outputTokens"]
		.reduce((sum, key) => {
			const value = usage[key];
			return sum + (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
		}, 0);
}

export function evaluateActivityBudget(
	contract: PathContract | undefined,
	state: ActivityBudgetState,
	event: unknown,
	now = Date.now(),
): ToolBoundaryDecision {
	const budget = contract?.activity_budget;
	if (!budget) return { allowed: true, paths: [] };
	const nextToolUses = state.tool_uses + 1;
	const nextTokens = state.tokens + tokenCountFromEvent(event);
	const elapsedMs = Math.max(0, now - state.started_at_ms);
	if (typeof budget.max_tool_uses === "number" && nextToolUses > budget.max_tool_uses) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_tool_uses=${budget.max_tool_uses}`,
		};
	}
	if (typeof budget.max_tokens === "number" && nextTokens > budget.max_tokens) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_tokens=${budget.max_tokens}`,
		};
	}
	if (typeof budget.max_elapsed_ms === "number" && elapsedMs > budget.max_elapsed_ms) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_elapsed_ms=${budget.max_elapsed_ms}`,
		};
	}
	state.tool_uses = nextToolUses;
	state.tokens = nextTokens;
	return { allowed: true, paths: [] };
}

export function evaluateActivityBudgetSnapshot(
	contract: PathContract | undefined,
	snapshot: { tool_uses?: number; tokens?: number; elapsed_ms?: number },
): ToolBoundaryDecision {
	const budget = contract?.activity_budget;
	if (!budget) return { allowed: true, paths: [] };
	if (typeof budget.max_tool_uses === "number" && (snapshot.tool_uses ?? 0) > budget.max_tool_uses) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_tool_uses=${budget.max_tool_uses}`,
		};
	}
	if (typeof budget.max_tokens === "number" && (snapshot.tokens ?? 0) > budget.max_tokens) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_tokens=${budget.max_tokens}`,
		};
	}
	if (typeof budget.max_elapsed_ms === "number" && (snapshot.elapsed_ms ?? 0) > budget.max_elapsed_ms) {
		return {
			allowed: false,
			paths: [],
			reason: `Path contract ${contract.contract_id ?? "(unnamed)"} exceeded activity budget max_elapsed_ms=${budget.max_elapsed_ms}`,
		};
	}
	return { allowed: true, paths: [] };
}

export function evaluateToolBoundary(
	contract: PathContract | undefined,
	toolName: string,
	input: unknown,
	cwd = process.cwd(),
): ToolBoundaryDecision {
	if (!contract) return { allowed: true, paths: [] };
	const paths = extractMutatingToolPaths(toolName, input);
	if (paths.length === 0) return { allowed: true, paths: [] };
	const blocked = paths.filter((candidate) => !isPathAllowed(cwd, candidate, contract));
	if (blocked.length === 0) return { allowed: true, paths };
	return {
		allowed: false,
		paths,
		reason: `Path contract ${contract.contract_id ?? "(unnamed)"} blocks writes outside allowed paths: ${blocked.join(", ")}`,
	};
}
