/// <reference types="node" />

import * as fs from "node:fs";
import * as path from "node:path";
import type { MissionOrchestratorRecord, MissionOrchestratorStatus } from "./types.ts";

const ALLOWED_TRANSITIONS: Record<MissionOrchestratorStatus, MissionOrchestratorStatus[]> = {
	NEW: ["NORMALIZED", "FAILED"],
	NORMALIZED: ["CLASSIFIED", "FAILED"],
	CLASSIFIED: ["PRE_ROUTED", "FAILED"],
	PRE_ROUTED: ["EVIDENCE_COLLECTED", "FINAL_ROUTED", "FAILED"],
	EVIDENCE_COLLECTED: ["FINAL_ROUTED", "FAILED"],
	FINAL_ROUTED: ["POLICY_COMPILED", "FAILED"],
	POLICY_COMPILED: ["PLANNED", "QUEUED", "FAILED"],
	PLANNED: ["QUEUED", "FAILED"],
	QUEUED: ["RUNNING", "FAILED"],
	RUNNING: ["VALIDATING", "CHECKPOINTED", "FAILED"],
	VALIDATING: ["CHECKPOINTED", "FAILED"],
	CHECKPOINTED: ["FINAL_ROUTED", "RUNNING", "COMPLETED", "FAILED"],
	COMPLETED: [],
	FAILED: ["PRE_ROUTED", "FINAL_ROUTED"],
};

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "mission";
}

function stateRoot(cwd: string): string {
	return path.join(cwd, ".harness", "state", "orchestrator");
}

export function missionStatePath(cwd: string, missionId: string): string {
	return path.join(stateRoot(cwd), `${safeId(missionId)}.json`);
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function appendEvent(cwd: string, event: Record<string, unknown>): void {
	const eventPath = path.join(stateRoot(cwd), "events.jsonl");
	fs.mkdirSync(path.dirname(eventPath), { recursive: true });
	fs.appendFileSync(eventPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

export function createMissionState(
	missionId: string,
	rawRequest: string,
	cwd = process.cwd(),
	now = Date.now,
): MissionOrchestratorRecord {
	const timestamp = new Date(now()).toISOString();
	const record: MissionOrchestratorRecord = {
		mission_id: missionId,
		status: "NEW",
		created_at: timestamp,
		updated_at: timestamp,
		route_changes: 0,
		raw_request: rawRequest,
	};
	writeMissionState(record, cwd);
	appendEvent(cwd, {
		type: "MissionCreated",
		timestamp,
		mission_id: missionId,
	});
	return record;
}

export function readMissionState(missionId: string, cwd = process.cwd()): MissionOrchestratorRecord | undefined {
	try {
		return JSON.parse(fs.readFileSync(missionStatePath(cwd, missionId), "utf-8")) as MissionOrchestratorRecord;
	} catch {
		return undefined;
	}
}

export function writeMissionState(record: MissionOrchestratorRecord, cwd = process.cwd()): void {
	writeJson(missionStatePath(cwd, record.mission_id), record);
}

export function transitionMissionState(
	record: MissionOrchestratorRecord,
	nextStatus: MissionOrchestratorStatus,
	updates: Partial<Omit<MissionOrchestratorRecord, "mission_id" | "created_at" | "status">> = {},
	cwd = process.cwd(),
	now = Date.now,
): MissionOrchestratorRecord {
	if (record.status !== nextStatus && !ALLOWED_TRANSITIONS[record.status].includes(nextStatus)) {
		throw new Error(`Invalid orchestrator state transition: ${record.status} -> ${nextStatus}`);
	}
	const timestamp = new Date(now()).toISOString();
	const next: MissionOrchestratorRecord = {
		...record,
		...updates,
		status: nextStatus,
		updated_at: timestamp,
	};
	writeMissionState(next, cwd);
	appendEvent(cwd, {
		type: "MissionStateTransition",
		timestamp,
		mission_id: next.mission_id,
		from: record.status,
		to: nextStatus,
	});
	return next;
}
