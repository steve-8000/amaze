/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { PathContract } from "./path-contract.ts";
import { routeValidationFailure } from "./validation-routing.ts";

export interface PathLockRecord {
	lock_id: string;
	contract_id: string;
	lock_path: string;
	created_at: string;
	pid: number;
	run_id?: string;
	agent?: string;
}

export interface ContractStateRecord {
	contract_id: string;
	mission_id?: string;
	status: "running" | "completed" | "failed";
	created_at: string;
	updated_at: string;
	run_id?: string;
	agent?: string;
	task?: string;
	path_contract: PathContract;
	locks: PathLockRecord[];
	depends_on?: string[];
	parallel_group?: string;
	exit_code?: number;
	error?: string;
}

export interface PathContractRun {
	stateRoot: string;
	contractId: string;
	missionId?: string;
	contractStatePath: string;
	locks: PathLockRecord[];
}

export interface MissionStateRecord {
	mission_id: string;
	status: "running" | "completed" | "failed";
	created_at: string;
	updated_at: string;
	contracts: Record<string, "pending" | "running" | "completed" | "failed">;
}

export interface HarnessEventRecord {
	event_id: string;
	type: "ContractAssigned" | "ValidationPassed" | "ValidationFailed";
	timestamp: string;
	mission_id?: string;
	contract_id: string;
	status?: "running" | "completed" | "failed";
}

export interface BeginPathContractRunOptions {
	runId?: string;
	agent?: string;
	task?: string;
	staleLockMs?: number;
	now?: () => number;
}

export class PathLockConflictError extends Error {
	readonly conflict: PathLockRecord;

	constructor(message: string, conflict: PathLockRecord) {
		super(message);
		this.name = "PathLockConflictError";
		this.conflict = conflict;
	}
}

const DEFAULT_STALE_LOCK_MS = 6 * 60 * 60 * 1000;

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "contract";
}

function contractId(contract: PathContract): string {
	return contract.contract_id
		?? contract.assigned_worker
		?? contract.assigned_path?.replace(/[/\\]+/g, ".")
		?? "path-contract";
}

function normalizeLockPath(value: string): string {
	const normalized = value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "");
	const wildcardIndex = normalized.search(/[*{[]/);
	const base = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
	return base.replace(/\/$/, "") || ".";
}

export function lockPathsForContract(contract: PathContract): string[] {
	const paths = contract.write_allowed_paths?.length
		? contract.write_allowed_paths
		: contract.owned_paths?.length
			? contract.owned_paths
			: contract.assigned_path
				? [`${contract.assigned_path.replace(/\/$/, "")}/**`]
				: [];
	return [...new Set(paths.map(normalizeLockPath))].sort();
}

function pathsConflict(a: string, b: string): boolean {
	if (a === "." || b === ".") return true;
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function ensureStateDirs(stateRoot: string): { locksDir: string; contractsDir: string } {
	const locksDir = path.join(stateRoot, "locks");
	const contractsDir = path.join(stateRoot, "contracts");
	fs.mkdirSync(path.join(stateRoot, "missions"), { recursive: true });
	fs.mkdirSync(path.join(stateRoot, "queues"), { recursive: true });
	fs.mkdirSync(path.join(stateRoot, "events"), { recursive: true });
	fs.mkdirSync(locksDir, { recursive: true });
	fs.mkdirSync(contractsDir, { recursive: true });
	return { locksDir, contractsDir };
}

function queuePath(stateRoot: string, queue: "pending" | "running" | "completed" | "failed"): string {
	return path.join(stateRoot, "queues", `${queue}.json`);
}

function readQueue(stateRoot: string, queue: "pending" | "running" | "completed" | "failed"): string[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(queuePath(stateRoot, queue), "utf-8")) as unknown;
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function writeQueue(stateRoot: string, queue: "pending" | "running" | "completed" | "failed", values: string[]): void {
	fs.writeFileSync(queuePath(stateRoot, queue), `${JSON.stringify([...new Set(values)].sort(), null, 2)}\n`, { mode: 0o600 });
}

function moveContractQueue(stateRoot: string, contractId: string, target: "pending" | "running" | "completed" | "failed"): void {
	for (const queue of ["pending", "running", "completed", "failed"] as const) {
		const next = readQueue(stateRoot, queue).filter((id) => id !== contractId);
		if (queue === target) next.push(contractId);
		writeQueue(stateRoot, queue, next);
	}
}

function missionPath(stateRoot: string, missionId: string): string {
	return path.join(stateRoot, "missions", `${safeId(missionId)}.json`);
}

function readMission(stateRoot: string, missionId: string, timestamp: string): MissionStateRecord {
	try {
		return JSON.parse(fs.readFileSync(missionPath(stateRoot, missionId), "utf-8")) as MissionStateRecord;
	} catch {
		return {
			mission_id: missionId,
			status: "running",
			created_at: timestamp,
			updated_at: timestamp,
			contracts: {},
		};
	}
}

function updateMissionContract(
	stateRoot: string,
	missionId: string | undefined,
	contractId: string,
	status: "running" | "completed" | "failed",
	timestamp: string,
): void {
	if (!missionId) return;
	const mission = readMission(stateRoot, missionId, timestamp);
	mission.contracts[contractId] = status;
	mission.updated_at = timestamp;
	mission.status = Object.values(mission.contracts).some((contractStatus) => contractStatus === "failed")
		? "failed"
		: Object.values(mission.contracts).length > 0 && Object.values(mission.contracts).every((contractStatus) => contractStatus === "completed")
			? "completed"
			: "running";
	fs.writeFileSync(missionPath(stateRoot, missionId), `${JSON.stringify(mission, null, 2)}\n`, { mode: 0o600 });
}

function appendHarnessEvent(stateRoot: string, event: HarnessEventRecord): void {
	fs.appendFileSync(path.join(stateRoot, "events", "events.jsonl"), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function transitionContractState(
	stateRoot: string,
	missionId: string | undefined,
	contractId: string,
	status: "running" | "completed" | "failed",
	timestamp: string,
	eventType: HarnessEventRecord["type"],
): void {
	moveContractQueue(stateRoot, contractId, status);
	updateMissionContract(stateRoot, missionId, contractId, status, timestamp);
	appendHarnessEvent(stateRoot, {
		event_id: safeId(`${timestamp}-${eventType}-${contractId}`),
		type: eventType,
		timestamp,
		mission_id: missionId,
		contract_id: contractId,
		status,
	});
}

function readLock(filePath: string): PathLockRecord | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PathLockRecord;
	} catch {
		return undefined;
	}
}

function removeStaleLocks(locksDir: string, staleLockMs: number, now: number): void {
	for (const file of fs.readdirSync(locksDir)) {
		if (!file.endsWith(".json")) continue;
		const filePath = path.join(locksDir, file);
		const lock = readLock(filePath);
		if (!lock) continue;
		const created = Date.parse(lock.created_at);
		if (Number.isFinite(created) && now - created > staleLockMs) {
			fs.rmSync(filePath, { force: true });
		}
	}
}

function existingConflictingLock(locksDir: string, desiredPath: string, ownContractId: string): PathLockRecord | undefined {
	for (const file of fs.readdirSync(locksDir)) {
		if (!file.endsWith(".json")) continue;
		const lock = readLock(path.join(locksDir, file));
		if (!lock || lock.contract_id === ownContractId) continue;
		if (pathsConflict(lock.lock_path, desiredPath)) return lock;
	}
	return undefined;
}

export function beginPathContractRun(
	contract: PathContract | undefined,
	cwd: string,
	options: BeginPathContractRunOptions = {},
): PathContractRun | undefined {
	if (!contract) return undefined;
	const id = contractId(contract);
	const missionId = contract.mission_id;
	const now = options.now?.() ?? Date.now();
	const timestamp = new Date(now).toISOString();
	const stateRoot = path.join(cwd, ".harness", "state");
	const { locksDir, contractsDir } = ensureStateDirs(stateRoot);
	const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
	removeStaleLocks(locksDir, staleLockMs, now);

	const lockPaths = lockPathsForContract(contract);
	const createdLocks: { filePath: string; lock: PathLockRecord }[] = [];
	try {
		for (const lockPath of lockPaths) {
			const conflict = existingConflictingLock(locksDir, lockPath, id);
			if (conflict) {
				throw new PathLockConflictError(
					`Path lock conflict for ${lockPath}: held by ${conflict.contract_id}`,
					conflict,
				);
			}
			const lock: PathLockRecord = {
				lock_id: safeId(`${id}-${lockPath}`),
				contract_id: id,
				lock_path: lockPath,
				created_at: timestamp,
				pid: process.pid,
				run_id: options.runId,
				agent: options.agent,
			};
			const filePath = path.join(locksDir, `${safeId(lock.lock_id)}.json`);
			fs.writeFileSync(filePath, JSON.stringify(lock, null, 2), { flag: "wx", mode: 0o600 });
			createdLocks.push({ filePath, lock });
		}
	} catch (error) {
		for (const created of createdLocks) fs.rmSync(created.filePath, { force: true });
		throw error;
	}

	const contractStatePath = path.join(contractsDir, `${safeId(id)}.json`);
	const state: ContractStateRecord = {
		contract_id: id,
		mission_id: missionId,
		status: "running",
		created_at: timestamp,
		updated_at: timestamp,
		run_id: options.runId,
		agent: options.agent,
		task: options.task,
		path_contract: contract,
		locks: createdLocks.map((entry) => entry.lock),
		depends_on: contract.depends_on,
		parallel_group: contract.parallel_group,
	};
	fs.writeFileSync(contractStatePath, JSON.stringify(state, null, 2), { mode: 0o600 });
	transitionContractState(stateRoot, missionId, id, "running", timestamp, "ContractAssigned");
	return { stateRoot, contractId: id, missionId, contractStatePath, locks: createdLocks.map((entry) => entry.lock) };
}

export function finalizePathContractRun(
	run: PathContractRun | undefined,
	status: "completed" | "failed",
	result: { exitCode?: number; error?: string } = {},
	now = Date.now,
): void {
	if (!run) return;
	let state: ContractStateRecord | undefined;
	try {
		state = JSON.parse(fs.readFileSync(run.contractStatePath, "utf-8")) as ContractStateRecord;
	} catch {
		state = undefined;
	}
	if (state) {
		state.status = status;
		state.updated_at = new Date(now()).toISOString();
		if (result.exitCode !== undefined) state.exit_code = result.exitCode;
		if (result.error) state.error = result.error;
		fs.writeFileSync(run.contractStatePath, JSON.stringify(state, null, 2), { mode: 0o600 });
		transitionContractState(
			run.stateRoot,
			run.missionId ?? state.mission_id,
			run.contractId,
			status,
			state.updated_at,
			status === "completed" ? "ValidationPassed" : "ValidationFailed",
		);
		if (status === "failed") {
			routeValidationFailure(run.stateRoot, state);
		}
	}
	const locksDir = path.join(run.stateRoot, "locks");
	for (const lock of run.locks) {
		fs.rmSync(path.join(locksDir, `${safeId(lock.lock_id)}.json`), { force: true });
	}
}
