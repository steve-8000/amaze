/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { ContractStateRecord } from "./path-state.ts";

export interface ValidationRoutingPolicy {
	max_retries?: number;
}

export interface ValidationRoutingResult {
	type: "return_to_same_worker" | "replan";
	contract_id: string;
	mission_id?: string;
	retry_contract_id?: string;
	replan_request_id?: string;
	attempt: number;
	reason?: string;
}

const DEFAULT_MAX_RETRIES = 1;

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
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
	fs.mkdirSync(path.dirname(queuePath(stateRoot, queue)), { recursive: true });
	fs.writeFileSync(queuePath(stateRoot, queue), `${JSON.stringify([...new Set(values)].sort(), null, 2)}\n`, { mode: 0o600 });
}

function addPending(stateRoot: string, contractId: string): void {
	writeQueue(stateRoot, "pending", [...readQueue(stateRoot, "pending"), contractId]);
}

function eventPath(stateRoot: string): string {
	return path.join(stateRoot, "events", "events.jsonl");
}

function appendEvent(stateRoot: string, event: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(eventPath(stateRoot)), { recursive: true });
	fs.appendFileSync(eventPath(stateRoot), `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function retryDir(stateRoot: string): string {
	return path.join(stateRoot, "retries");
}

function replanDir(stateRoot: string): string {
	return path.join(stateRoot, "replans");
}

function countExistingRetries(stateRoot: string, contractId: string): number {
	try {
		return fs.readdirSync(retryDir(stateRoot))
			.filter((file) => file.startsWith(`${safeId(contractId)}-retry-`) && file.endsWith(".json"))
			.length;
	} catch {
		return 0;
	}
}

export function routeValidationFailure(
	stateRoot: string,
	state: ContractStateRecord,
	policy: ValidationRoutingPolicy = {},
	now = Date.now,
): ValidationRoutingResult {
	const maxRetries = policy.max_retries ?? DEFAULT_MAX_RETRIES;
	const existingRetries = countExistingRetries(stateRoot, state.contract_id);
	const attempt = existingRetries + 1;
	const timestamp = new Date(now()).toISOString();
	const reason = state.error ?? `Contract ${state.contract_id} failed validation.`;

	if (existingRetries < maxRetries) {
		fs.mkdirSync(retryDir(stateRoot), { recursive: true });
		const retryContractId = `${state.contract_id}-retry-${attempt}`;
		const retryRecord = {
			type: "return_to_same_worker",
			created_at: timestamp,
			source_contract_id: state.contract_id,
			retry_contract_id: retryContractId,
			mission_id: state.mission_id,
			assigned_worker: state.path_contract.assigned_worker,
			assigned_path: state.path_contract.assigned_path,
			reason,
			path_contract: {
				...state.path_contract,
				contract_id: retryContractId,
				depends_on: [state.contract_id],
			},
		};
		fs.writeFileSync(path.join(retryDir(stateRoot), `${safeId(retryContractId)}.json`), `${JSON.stringify(retryRecord, null, 2)}\n`, { mode: 0o600 });
		addPending(stateRoot, retryContractId);
		appendEvent(stateRoot, {
			event_id: safeId(`${timestamp}-ValidationRetryRequested-${retryContractId}`),
			type: "ValidationRetryRequested",
			timestamp,
			mission_id: state.mission_id,
			contract_id: state.contract_id,
			retry_contract_id: retryContractId,
			reason,
		});
		return {
			type: "return_to_same_worker",
			contract_id: state.contract_id,
			mission_id: state.mission_id,
			retry_contract_id: retryContractId,
			attempt,
			reason,
		};
	}

	fs.mkdirSync(replanDir(stateRoot), { recursive: true });
	const replanRequestId = `${state.contract_id}-replan-${attempt}`;
	const replanRecord = {
		type: "replan",
		created_at: timestamp,
		replan_request_id: replanRequestId,
		source_contract_id: state.contract_id,
		mission_id: state.mission_id,
		reason,
		path_contract: state.path_contract,
	};
	fs.writeFileSync(path.join(replanDir(stateRoot), `${safeId(replanRequestId)}.json`), `${JSON.stringify(replanRecord, null, 2)}\n`, { mode: 0o600 });
	appendEvent(stateRoot, {
		event_id: safeId(`${timestamp}-ReplanRequested-${replanRequestId}`),
		type: "ReplanRequested",
		timestamp,
		mission_id: state.mission_id,
		contract_id: state.contract_id,
		replan_request_id: replanRequestId,
		reason,
	});
	return {
		type: "replan",
		contract_id: state.contract_id,
		mission_id: state.mission_id,
		replan_request_id: replanRequestId,
		attempt,
		reason,
	};
}
