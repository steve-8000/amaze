import path from "node:path";
import type { PathContract } from "./path-contract.ts";
import type { PathMemoryPacketInput } from "./path-memory.ts";

export interface MemoryUpdateValidationResult {
	updates: unknown[];
	skipped: number;
	warnings: string[];
}

const ALLOWED_UPDATE_TYPES = new Set([
	"decision",
	"incident",
	"known_failure",
	"known_failures",
	"failure",
	"contract",
	"summary",
]);

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function stringFromKeys(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)
		? value.map((item) => item.trim())
		: undefined;
}

function normalizeType(value: unknown): string {
	return (typeof value === "string" && value.trim() ? value : "decision").toLowerCase().replace(/-/g, "_");
}

function normalizeRelativePath(cwd: string, candidate: string): string {
	const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
	return path.relative(cwd, absolute).replace(/\\/g, "/");
}

function escapeRegex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
	const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
	let source = "";
	for (let index = 0; index < normalized.length; index++) {
		const char = normalized[index]!;
		if (char === "*") {
			if (normalized[index + 1] === "*") {
				source += ".*";
				index++;
			} else {
				source += "[^/]*";
			}
		} else {
			source += escapeRegex(char);
		}
	}
	return new RegExp(`^${source}$`);
}

function boundaryPatterns(contract: PathContract | undefined): string[] {
	if (!contract) return [];
	const assignedPath = contract.assigned_path ? [`${contract.assigned_path.replace(/\/$/, "")}/**`] : [];
	return [
		...(contract.owned_paths ?? []),
		...(contract.write_allowed_paths ?? []),
		...(contract.read_allowed_paths ?? []),
		...assignedPath,
	];
}

function relatedFilesAllowed(cwd: string, files: string[] | undefined, contract: PathContract | undefined): boolean {
	if (!files?.length) return true;
	const patterns = boundaryPatterns(contract);
	if (patterns.length === 0) return true;
	return files.every((file) => {
		const relative = normalizeRelativePath(cwd, file);
		return patterns.some((pattern) => globToRegex(pattern).test(relative));
	});
}

function memoryScope(input: PathMemoryPacketInput | undefined): { pathId?: string; memoryPath?: string; contractId?: string; xenoniteNamespace?: string } {
	const scope = input?.memory_scope ?? input?.memoryScope ?? input?.scope;
	return {
		pathId: scope?.path_id,
		memoryPath: scope?.memory_path,
		contractId: input?.contract_id,
		xenoniteNamespace: scope?.xenonite_namespace,
	};
}

function updateHasContent(update: Record<string, unknown>): boolean {
	return ["summary", "decision", "lesson"].some((key) => {
		const value = update[key];
		return typeof value === "string" && value.trim().length > 0;
	});
}

export function validatePathMemoryUpdates(
	input: PathMemoryPacketInput | undefined,
	updates: unknown[],
	options: { cwd?: string; pathContract?: PathContract } = {},
): MemoryUpdateValidationResult {
	const warnings: string[] = [];
	const accepted: unknown[] = [];
	const scope = memoryScope(input);
	const cwd = options.cwd ?? process.cwd();
	for (const [index, value] of updates.entries()) {
		const update = asObject(value);
		if (!update) {
			warnings.push(`memory_updates[${index}] skipped: update must be an object.`);
			continue;
		}
		if (!updateHasContent(update)) {
			warnings.push(`memory_updates[${index}] skipped: summary, decision, or lesson is required.`);
			continue;
		}
		const type = normalizeType(update.type);
		if (!ALLOWED_UPDATE_TYPES.has(type)) {
			warnings.push(`memory_updates[${index}] skipped: unsupported memory update type '${String(update.type)}'.`);
			continue;
		}
		const pathId = stringFromKeys(update, ["path_id", "pathId"]);
		if (scope.pathId && pathId && pathId !== scope.pathId) {
			warnings.push(`memory_updates[${index}] skipped: path_id '${pathId}' does not match '${scope.pathId}'.`);
			continue;
		}
		const memoryPath = stringFromKeys(update, ["memory_path", "memoryPath"]);
		if (scope.memoryPath && memoryPath && memoryPath.replace(/\\/g, "/") !== scope.memoryPath.replace(/\\/g, "/")) {
			warnings.push(`memory_updates[${index}] skipped: memory_path '${memoryPath}' does not match '${scope.memoryPath}'.`);
			continue;
		}
		const xenoniteNamespace = stringFromKeys(update, ["xenonite_namespace", "xenoniteNamespace"]);
		if (scope.xenoniteNamespace && xenoniteNamespace && xenoniteNamespace !== scope.xenoniteNamespace) {
			warnings.push(`memory_updates[${index}] skipped: xenonite_namespace '${xenoniteNamespace}' does not match '${scope.xenoniteNamespace}'.`);
			continue;
		}
		const contractId = stringFromKeys(update, ["contract_id", "contractId", "source_contract_id", "sourceContractId"]);
		if (scope.contractId && contractId && contractId !== scope.contractId) {
			warnings.push(`memory_updates[${index}] skipped: contract_id '${contractId}' does not match '${scope.contractId}'.`);
			continue;
		}
		const relatedFiles = stringArray(update.related_files ?? update.relatedFiles);
		if (relatedFiles === undefined && (update.related_files !== undefined || update.relatedFiles !== undefined)) {
			warnings.push(`memory_updates[${index}] skipped: related_files must be an array of strings.`);
			continue;
		}
		if (!relatedFilesAllowed(cwd, relatedFiles, options.pathContract)) {
			warnings.push(`memory_updates[${index}] skipped: related_files must stay within the execution contract boundary.`);
			continue;
		}
		accepted.push(update);
	}
	return {
		updates: accepted,
		skipped: updates.length - accepted.length,
		warnings,
	};
}
