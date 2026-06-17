/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { PlannedPathContract } from "./contract-dag.ts";
import type { PathContract } from "./path-contract.ts";

export interface PathRegistryEvidence {
	scan_id?: string;
	contract_id?: string;
	change_request_id?: string;
	reason?: string;
}

export interface PathRegistryEntry {
	path_id: string;
	owned_path: string;
	write_globs: string[];
	memory_path: string;
	status: "active";
	created_from: "planner" | "change_request" | "manual";
	created_at: string;
	updated_at: string;
	evidence?: PathRegistryEvidence;
}

export interface PathRegistryRecord {
	registry_version: number;
	repo_root: string;
	updated_at: string;
	paths: PathRegistryEntry[];
}

export interface RegisterPathSpecialistInput {
	owned_path: string;
	write_globs?: string[];
	created_from?: PathRegistryEntry["created_from"];
	evidence?: PathRegistryEvidence;
}

const MEMORY_FILES = [
	"decisions.jsonl",
	"incidents.jsonl",
	"contracts.jsonl",
	"summaries.jsonl",
	"known-failures.jsonl",
] as const;

function normalizeRepoPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "");
}

export function pathIdFromFolder(folderPath: string): string {
	return `folder.${normalizeRepoPath(folderPath).replace(/\//g, ".").replace(/-/g, "_")}`;
}

function memoryPathForFolder(folderPath: string): string {
	return `.harness/memory/paths/${normalizeRepoPath(folderPath)}`;
}

function registryPath(cwd: string): string {
	return path.join(cwd, ".harness", "knowledge", "path-registry.json");
}

function ensureRegistryDirs(cwd: string): void {
	fs.mkdirSync(path.join(cwd, ".harness", "knowledge"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".harness", "memory", "paths"), { recursive: true });
}

function readRegistry(cwd: string, timestamp: string): PathRegistryRecord {
	try {
		return JSON.parse(fs.readFileSync(registryPath(cwd), "utf-8")) as PathRegistryRecord;
	} catch {
		return {
			registry_version: 1,
			repo_root: ".",
			updated_at: timestamp,
			paths: [],
		};
	}
}

function writeIfMissing(filePath: string, content: string): void {
	if (fs.existsSync(filePath)) return;
	fs.writeFileSync(filePath, content, { mode: 0o600 });
}

function bootstrapPathMemory(cwd: string, entry: PathRegistryEntry): void {
	const memoryRoot = path.join(cwd, entry.memory_path);
	fs.mkdirSync(memoryRoot, { recursive: true });
	writeIfMissing(path.join(memoryRoot, "profile.md"), [
		`# ${entry.path_id}`,
		"",
		`Owned path: \`${entry.owned_path}\``,
		"",
		"This path memory is path-local specialist experience. Append durable lessons only after validation passes.",
		"",
	].join("\n"));
	writeIfMissing(path.join(memoryRoot, "conventions.md"), [
		`# Conventions for ${entry.owned_path}`,
		"",
		"- Keep writes inside this path's contract boundary.",
		"- Record durable decisions in decisions.jsonl after validation passes.",
		"",
	].join("\n"));
	for (const file of MEMORY_FILES) writeIfMissing(path.join(memoryRoot, file), "");
}

function appendContractBootstrapMemory(cwd: string, entry: PathRegistryEntry, contract: PathContract | undefined, timestamp: string): void {
	if (!contract?.contract_id) return;
	const filePath = path.join(cwd, entry.memory_path, "contracts.jsonl");
	const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
	if (existing.includes(`"contract_id":"${contract.contract_id}"`) || existing.includes(`"contract_id": "${contract.contract_id}"`)) return;
	const record = {
		type: "contract_bootstrap",
		timestamp,
		contract_id: contract.contract_id,
		mission_id: contract.mission_id,
		assigned_path: contract.assigned_path,
		assigned_worker: contract.assigned_worker,
	};
	fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export function registerPathSpecialist(
	input: RegisterPathSpecialistInput,
	cwd = process.cwd(),
	now = Date.now,
	contract?: PathContract,
): PathRegistryEntry {
	const timestamp = new Date(now()).toISOString();
	ensureRegistryDirs(cwd);
	const ownedPath = normalizeRepoPath(input.owned_path);
	const pathId = pathIdFromFolder(ownedPath);
	const memoryPath = memoryPathForFolder(ownedPath);
	const writeGlobs = input.write_globs?.length ? input.write_globs.map(normalizeRepoPath) : [`${ownedPath}/**`];
	const registry = readRegistry(cwd, timestamp);
	const existingIndex = registry.paths.findIndex((entry) => entry.path_id === pathId);
	const existing = existingIndex >= 0 ? registry.paths[existingIndex] : undefined;
	const entry: PathRegistryEntry = {
		path_id: pathId,
		owned_path: ownedPath,
		write_globs: [...new Set([...(existing?.write_globs ?? []), ...writeGlobs])].sort(),
		memory_path: existing?.memory_path ?? memoryPath,
		status: "active",
		created_from: existing?.created_from ?? input.created_from ?? "planner",
		created_at: existing?.created_at ?? timestamp,
		updated_at: timestamp,
		evidence: input.evidence ?? existing?.evidence,
	};
	if (existingIndex >= 0) registry.paths[existingIndex] = entry;
	else registry.paths.push(entry);
	registry.paths.sort((a, b) => a.path_id.localeCompare(b.path_id));
	registry.updated_at = timestamp;
	fs.writeFileSync(registryPath(cwd), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
	bootstrapPathMemory(cwd, entry);
	appendContractBootstrapMemory(cwd, entry, contract, timestamp);
	return entry;
}

function pathFromWriteGlob(glob: string): string {
	return normalizeRepoPath(glob).replace(/\/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
}

export function ownedPathFromContract(contract: PathContract): string | undefined {
	if (contract.assigned_path) return normalizeRepoPath(contract.assigned_path);
	const firstWrite = contract.write_allowed_paths?.[0] ?? contract.owned_paths?.[0];
	return firstWrite ? pathFromWriteGlob(firstWrite) : undefined;
}

export function registerPathSpecialistsForContracts(
	contracts: PlannedPathContract[],
	cwd = process.cwd(),
	now = Date.now,
	createdFrom: PathRegistryEntry["created_from"] = "planner",
): PathRegistryEntry[] {
	const entries: PathRegistryEntry[] = [];
	for (const contract of contracts) {
		const ownedPath = ownedPathFromContract(contract);
		if (!ownedPath) continue;
		entries.push(registerPathSpecialist({
			owned_path: ownedPath,
			write_globs: contract.write_allowed_paths ?? contract.owned_paths ?? [`${ownedPath}/**`],
			created_from: createdFrom,
			evidence: {
				scan_id: contract.scan_id ?? contract.evidence_packet_id,
				contract_id: contract.contract_id,
				reason: contract.goal,
			},
		}, cwd, now, contract));
	}
	return entries;
}

export function readPathRegistry(cwd = process.cwd()): PathRegistryRecord | undefined {
	try {
		return JSON.parse(fs.readFileSync(registryPath(cwd), "utf-8")) as PathRegistryRecord;
	} catch {
		return undefined;
	}
}
