/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { PathContract } from "./path-contract.ts";
import { registerPathSpecialistsForContracts } from "./path-registry.ts";

export interface PlannedPathContract extends PathContract {
	contract_id: string;
	mission_id: string;
	goal?: string;
	context_packet_id?: string;
	evidence_packet_id?: string;
	scan_id?: string;
}

export interface ContractDagRecord {
	mission_id: string;
	created_at: string;
	updated_at: string;
	evidence_packet_id?: string;
	scan_id?: string;
	contracts: PlannedPathContract[];
	edges: Array<{ from: string; to: string }>;
	ready_contracts: string[];
}

export interface PlanContractDagInput {
	mission_id: string;
	evidence_packet_id?: string;
	scan_id?: string;
	contracts: Array<PathContract & {
		contract_id: string;
		goal?: string;
		context_packet_id?: string;
		evidence_packet_id?: string;
		scan_id?: string;
	}>;
}

export interface ChangeRequestInput {
	change_request_id?: string;
	mission_id: string;
	from_contract?: string;
	from_worker?: string;
	target_path: string;
	target_worker?: string;
	reason: string;
	requested_behavior?: string[];
	blocking?: boolean;
	evidence?: string[];
}

export interface ChangeRequestRecord extends ChangeRequestInput {
	change_request_id: string;
	created_at: string;
	generated_contract_id: string;
}

export interface ContractLeaseRecord {
	lease_id: string;
	mission_id: string;
	contract_id: string;
	worker_id: string;
	claimed_at: string;
	expires_at: string;
	attempt: number;
}

export interface ClaimContractLeaseOptions {
	workerId: string;
	leaseMs?: number;
	now?: () => number;
}

export interface RecoverExpiredLeasesResult {
	recovered: ContractLeaseRecord[];
}

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function stateRoot(cwd: string): string {
	return path.join(cwd, ".harness", "state");
}

function ensureStateDirs(root: string): void {
	for (const dir of ["dags", "queues", "events", "change-requests", "leases"]) {
		fs.mkdirSync(path.join(root, dir), { recursive: true });
	}
}

function queuePath(root: string, queue: "pending" | "running" | "completed" | "failed"): string {
	return path.join(root, "queues", `${queue}.json`);
}

function readJson<T>(filePath: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch {
		return fallback;
	}
}

function readQueue(root: string, queue: "pending" | "running" | "completed" | "failed"): string[] {
	const parsed = readJson<unknown>(queuePath(root, queue), []);
	return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function writeQueue(root: string, queue: "pending" | "running" | "completed" | "failed", values: string[]): void {
	fs.writeFileSync(queuePath(root, queue), `${JSON.stringify([...new Set(values)].sort(), null, 2)}\n`, { mode: 0o600 });
}

function appendPending(root: string, contractIds: string[]): void {
	const pending = readQueue(root, "pending");
	const running = new Set(readQueue(root, "running"));
	const completed = new Set(readQueue(root, "completed"));
	const failed = new Set(readQueue(root, "failed"));
	const next = [
		...pending,
		...contractIds.filter((id) => !running.has(id) && !completed.has(id) && !failed.has(id)),
	];
	writeQueue(root, "pending", next);
	for (const queue of ["running", "completed", "failed"] as const) {
		const current = readQueue(root, queue).filter((id) => !contractIds.includes(id));
		writeQueue(root, queue, current);
	}
}

function appendEvent(root: string, event: Record<string, unknown>): void {
	fs.appendFileSync(path.join(root, "events", "events.jsonl"), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function dagPath(root: string, missionId: string): string {
	return path.join(root, "dags", `${safeId(missionId)}.json`);
}

function leasePath(root: string, contractId: string): string {
	return path.join(root, "leases", `${safeId(contractId)}.json`);
}

function moveQueue(root: string, contractId: string, target: "pending" | "running" | "completed" | "failed"): void {
	for (const queue of ["pending", "running", "completed", "failed"] as const) {
		const current = readQueue(root, queue).filter((id) => id !== contractId);
		if (queue === target) current.push(contractId);
		writeQueue(root, queue, current);
	}
}

function leaseAttempt(root: string, contractId: string): number {
	const existing = readJson<ContractLeaseRecord | undefined>(leasePath(root, contractId), undefined);
	return (existing?.attempt ?? 0) + 1;
}

function normalizeContract(input: PlanContractDagInput["contracts"][number], missionId: string): PlannedPathContract {
	const contract: PlannedPathContract = {
		...input,
		contract_id: input.contract_id,
		mission_id: input.mission_id ?? missionId,
		depends_on: input.depends_on ?? [],
		evidence_packet_id: input.evidence_packet_id,
		scan_id: input.scan_id,
	};
	if (!contract.write_allowed_paths?.length && contract.owned_paths?.length) {
		contract.write_allowed_paths = contract.owned_paths;
	}
	if (!contract.write_allowed_paths?.length && contract.assigned_path) {
		contract.write_allowed_paths = [`${contract.assigned_path.replace(/\/$/, "")}/**`];
	}
	return contract;
}

function validateContracts(contracts: PlannedPathContract[]): void {
	const ids = new Set<string>();
	for (const contract of contracts) {
		if (ids.has(contract.contract_id)) throw new Error(`Duplicate contract_id: ${contract.contract_id}`);
		ids.add(contract.contract_id);
	}
	for (const contract of contracts) {
		for (const dep of contract.depends_on ?? []) {
			if (!ids.has(dep)) throw new Error(`Contract ${contract.contract_id} depends on missing contract ${dep}`);
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byId = new Map(contracts.map((contract) => [contract.contract_id, contract]));
	const visit = (id: string, stack: string[]): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) throw new Error(`Contract dependency cycle: ${[...stack, id].join(" -> ")}`);
		visiting.add(id);
		const contract = byId.get(id);
		for (const dep of contract?.depends_on ?? []) visit(dep, [...stack, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const contract of contracts) visit(contract.contract_id, []);
}

function buildEdges(contracts: PlannedPathContract[]): Array<{ from: string; to: string }> {
	return contracts.flatMap((contract) => (contract.depends_on ?? []).map((dep) => ({ from: dep, to: contract.contract_id })));
}

function computeReadyContracts(root: string, contracts: PlannedPathContract[]): string[] {
	const pending = new Set(readQueue(root, "pending"));
	const running = new Set(readQueue(root, "running"));
	const completed = new Set(readQueue(root, "completed"));
	const failed = new Set(readQueue(root, "failed"));
	return contracts
		.filter((contract) => pending.has(contract.contract_id))
		.filter((contract) => !running.has(contract.contract_id) && !completed.has(contract.contract_id) && !failed.has(contract.contract_id))
		.filter((contract) => (contract.depends_on ?? []).every((dep) => completed.has(dep)))
		.map((contract) => contract.contract_id)
		.sort();
}

export function planContractDag(input: PlanContractDagInput, cwd = process.cwd(), now = Date.now): ContractDagRecord {
	const root = stateRoot(cwd);
	ensureStateDirs(root);
	const timestamp = new Date(now()).toISOString();
	const contracts = input.contracts.map((contract) => normalizeContract(contract, input.mission_id));
	validateContracts(contracts);
	appendPending(root, contracts.map((contract) => contract.contract_id));
	registerPathSpecialistsForContracts(contracts.map((contract) => ({
		...contract,
		evidence_packet_id: contract.evidence_packet_id ?? input.evidence_packet_id,
		scan_id: contract.scan_id ?? input.scan_id,
	})), cwd, now, "planner");
	const record: ContractDagRecord = {
		mission_id: input.mission_id,
		created_at: timestamp,
		updated_at: timestamp,
		evidence_packet_id: input.evidence_packet_id,
		scan_id: input.scan_id,
		contracts,
		edges: buildEdges(contracts),
		ready_contracts: computeReadyContracts(root, contracts),
	};
	fs.writeFileSync(dagPath(root, input.mission_id), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
	appendEvent(root, {
		event_id: safeId(`${timestamp}-ContractDAGCreated-${input.mission_id}`),
		type: "ContractDAGCreated",
		timestamp,
		mission_id: input.mission_id,
		contracts: contracts.map((contract) => contract.contract_id),
	});
	return record;
}

export function getReadyContracts(missionId: string, cwd = process.cwd()): string[] {
	const root = stateRoot(cwd);
	const record = readJson<ContractDagRecord | undefined>(dagPath(root, missionId), undefined);
	if (!record) return [];
	return computeReadyContracts(root, record.contracts);
}

export function claimReadyContractLease(
	missionId: string,
	cwd = process.cwd(),
	options: ClaimContractLeaseOptions,
): ContractLeaseRecord | undefined {
	const root = stateRoot(cwd);
	ensureStateDirs(root);
	recoverExpiredContractLeases(missionId, cwd, options.now ?? Date.now);
	const ready = getReadyContracts(missionId, cwd);
	const contractId = ready[0];
	if (!contractId) return undefined;
	const nowMs = (options.now ?? Date.now)();
	const leaseMs = options.leaseMs ?? 5 * 60_000;
	const lease: ContractLeaseRecord = {
		lease_id: safeId(`${missionId}-${contractId}-${options.workerId}-${nowMs}`),
		mission_id: missionId,
		contract_id: contractId,
		worker_id: options.workerId,
		claimed_at: new Date(nowMs).toISOString(),
		expires_at: new Date(nowMs + leaseMs).toISOString(),
		attempt: leaseAttempt(root, contractId),
	};
	moveQueue(root, contractId, "running");
	fs.writeFileSync(leasePath(root, contractId), `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600 });
	appendEvent(root, { type: "ContractLeaseClaimed", timestamp: lease.claimed_at, mission_id: missionId, contract_id: contractId, lease_id: lease.lease_id, worker_id: options.workerId });
	return lease;
}

export function recoverExpiredContractLeases(missionId: string, cwd = process.cwd(), now = Date.now): RecoverExpiredLeasesResult {
	const root = stateRoot(cwd);
	ensureStateDirs(root);
	const leasesDir = path.join(root, "leases");
	const recovered: ContractLeaseRecord[] = [];
	for (const file of fs.existsSync(leasesDir) ? fs.readdirSync(leasesDir) : []) {
		if (!file.endsWith(".json")) continue;
		const leaseFile = path.join(leasesDir, file);
		const lease = readJson<ContractLeaseRecord | undefined>(leaseFile, undefined);
		if (!lease || lease.mission_id !== missionId) continue;
		if (Date.parse(lease.expires_at) > now()) continue;
		moveQueue(root, lease.contract_id, "pending");
		try { fs.unlinkSync(leaseFile); } catch { /* best effort */ }
		recovered.push(lease);
		appendEvent(root, { type: "ContractLeaseRecovered", timestamp: new Date(now()).toISOString(), mission_id: missionId, contract_id: lease.contract_id, lease_id: lease.lease_id, worker_id: lease.worker_id });
	}
	return { recovered };
}

export function completeContractLease(
	lease: ContractLeaseRecord,
	cwd = process.cwd(),
	outcome: "completed" | "failed" = "completed",
	now = Date.now,
): void {
	const root = stateRoot(cwd);
	ensureStateDirs(root);
	moveQueue(root, lease.contract_id, outcome);
	try { fs.unlinkSync(leasePath(root, lease.contract_id)); } catch { /* best effort */ }
	appendEvent(root, {
		type: outcome === "completed" ? "ContractLeaseCompleted" : "ContractLeaseFailed",
		timestamp: new Date(now()).toISOString(),
		mission_id: lease.mission_id,
		contract_id: lease.contract_id,
		lease_id: lease.lease_id,
		worker_id: lease.worker_id,
	});
}

function pathIdFromFolder(folderPath: string): string {
	return `folder.${folderPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\//g, ".").replace(/-/g, "_")}`;
}

export function routeChangeRequest(request: ChangeRequestInput, cwd = process.cwd(), now = Date.now): {
	change_request: ChangeRequestRecord;
	contract: PlannedPathContract;
	dag: ContractDagRecord;
} {
	const root = stateRoot(cwd);
	ensureStateDirs(root);
	const timestamp = new Date(now()).toISOString();
	const changeRequestId = request.change_request_id ?? safeId(`cr-${request.from_contract ?? "root"}-to-${request.target_path}`);
	const generatedContractId = safeId(`${changeRequestId}-contract`);
	const targetWorker = request.target_worker ?? pathIdFromFolder(request.target_path);
	const changeRequest: ChangeRequestRecord = {
		...request,
		change_request_id: changeRequestId,
		target_worker: targetWorker,
		created_at: timestamp,
		generated_contract_id: generatedContractId,
	};
	const crPath = path.join(root, "change-requests", `${safeId(changeRequestId)}.json`);
	fs.writeFileSync(crPath, `${JSON.stringify(changeRequest, null, 2)}\n`, { mode: 0o600 });

	const existing = readJson<ContractDagRecord | undefined>(dagPath(root, request.mission_id), undefined);
	const existingContracts = existing?.contracts ?? [];
	const contract: PlannedPathContract = {
		contract_id: generatedContractId,
		mission_id: request.mission_id,
		assigned_path: request.target_path,
		assigned_worker: targetWorker,
		depends_on: request.blocking && request.from_contract ? [request.from_contract] : [],
		evidence_packet_id: existing?.evidence_packet_id,
		scan_id: existing?.scan_id,
		goal: request.reason,
		write_allowed_paths: [`${request.target_path.replace(/\/$/, "")}/**`],
	};
	const dag = planContractDag({
		mission_id: request.mission_id,
		evidence_packet_id: existing?.evidence_packet_id,
		scan_id: existing?.scan_id,
		contracts: [...existingContracts.filter((item) => item.contract_id !== contract.contract_id), contract],
	}, cwd, now);
	registerPathSpecialistsForContracts([contract], cwd, now, "change_request");
	appendEvent(root, {
		event_id: safeId(`${timestamp}-ChangeRequestCreated-${changeRequestId}`),
		type: "ChangeRequestCreated",
		timestamp,
		mission_id: request.mission_id,
		change_request_id: changeRequestId,
		contract_id: generatedContractId,
		from_contract: request.from_contract,
		target_worker: targetWorker,
	});
	return { change_request: changeRequest, contract, dag };
}
