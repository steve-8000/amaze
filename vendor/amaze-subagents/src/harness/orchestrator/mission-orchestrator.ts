/// <reference types="node" />

import { createHash } from "node:crypto";
import type { PlanContractDagInput } from "../contract-dag.ts";
import { MAX_RUNTIME_ROUTE_CHANGES } from "./profile-catalog.ts";
import { compileExecutionPolicy } from "./policy-compiler.ts";
import { createContractDagFromPlanner, type PlannerGatewayResult } from "./planner-gateway.ts";
import { normalizeRequest } from "./request-normalizer.ts";
import { routeProfiles } from "./profile-router.ts";
import { createMissionState, transitionMissionState } from "./mission-state-store.ts";
import { classifyMission } from "./task-classifier.ts";
import type {
	ExecutionPolicy,
	MissionClassification,
	MissionOrchestratorRecord,
	NormalizedRequest,
	ProfileRoute,
} from "./types.ts";

export interface MissionPolicyCompileResult {
	missionId: string;
	normalized: NormalizedRequest;
	classification: MissionClassification;
	route: ProfileRoute;
	policy: ExecutionPolicy;
}

export interface StartMissionOptions {
	missionId?: string;
	cwd?: string;
	now?: () => number;
}

export interface StartMissionResult extends MissionPolicyCompileResult {
	record: MissionOrchestratorRecord;
}

export interface AcceptPlannerOutputOptions {
	cwd?: string;
	now?: () => number;
}

export interface RerouteMissionOptions {
	reason: string;
	rawRequest?: string;
	cwd?: string;
	now?: () => number;
}

function safeMissionId(rawRequest: string): string {
	const digest = createHash("sha256").update(rawRequest).digest("hex").slice(0, 12);
	return `mission-${digest}`;
}

export function compileMissionPolicy(rawRequest: string, missionId = safeMissionId(rawRequest)): MissionPolicyCompileResult {
	const normalized = normalizeRequest(rawRequest);
	const classification = classifyMission(normalized, missionId);
	const route = routeProfiles(classification, normalized);
	const policy = compileExecutionPolicy(route, classification);
	return {
		missionId,
		normalized,
		classification,
		route,
		policy,
	};
}

function sameRoute(left: ProfileRoute | undefined, right: ProfileRoute): boolean {
	return Boolean(left)
		&& left?.baseRuntime === right.baseRuntime
		&& left.workPattern === right.workPattern
		&& left.validatorPack === right.validatorPack
		&& left.domainOverlays.length === right.domainOverlays.length
		&& left.domainOverlays.every((overlay, index) => overlay === right.domainOverlays[index]);
}

function policiesMatch(left: ExecutionPolicy, right: ExecutionPolicy): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function startMission(rawRequest: string, options: StartMissionOptions = {}): StartMissionResult {
	const cwd = options.cwd ?? process.cwd();
	const now = options.now ?? Date.now;
	const missionId = options.missionId ?? safeMissionId(rawRequest);
	let record = createMissionState(missionId, rawRequest, cwd, now);
	const normalized = normalizeRequest(rawRequest);
	record = transitionMissionState(record, "NORMALIZED", { normalized }, cwd, now);
	const classification = classifyMission(normalized, missionId);
	record = transitionMissionState(record, "CLASSIFIED", { classification }, cwd, now);
	const preRoute = routeProfiles(classification, normalized);
	record = transitionMissionState(record, "PRE_ROUTED", { pre_route: preRoute }, cwd, now);
	const finalRoute = preRoute;
	record = transitionMissionState(record, "FINAL_ROUTED", { final_route: finalRoute }, cwd, now);
	const policy = compileExecutionPolicy(finalRoute, classification);
	record = transitionMissionState(record, "POLICY_COMPILED", { execution_policy: policy }, cwd, now);
	return {
		missionId,
		normalized,
		classification,
		route: finalRoute,
		policy,
		record,
	};
}

export function rerouteMissionAtCheckpoint(
	record: MissionOrchestratorRecord,
	options: RerouteMissionOptions,
): StartMissionResult {
	const cwd = options.cwd ?? process.cwd();
	const now = options.now ?? Date.now;
	if (record.status !== "CHECKPOINTED") {
		throw new Error(`Mission reroute is only allowed at CHECKPOINTED, got ${record.status}`);
	}
	const rawRequest = options.rawRequest ?? record.raw_request;
	const normalized = normalizeRequest(rawRequest);
	const classification = classifyMission(normalized, record.mission_id);
	const route = routeProfiles(classification, normalized);
	const routeChanged = !sameRoute(record.final_route, route);
	if (routeChanged && record.route_changes >= MAX_RUNTIME_ROUTE_CHANGES) {
		throw new Error(`Mission ${record.mission_id} exceeded runtime route change budget ${MAX_RUNTIME_ROUTE_CHANGES}`);
	}
	const timestamp = new Date(now()).toISOString();
	const routeChanges = routeChanged ? record.route_changes + 1 : record.route_changes;
	const routedRecord = transitionMissionState(record, "FINAL_ROUTED", {
		normalized,
		classification,
		final_route: route,
		route_changes: routeChanges,
		routing_history: [
			...(record.routing_history ?? []),
			{
				timestamp,
				reason: options.reason,
				from_runtime: record.final_route?.baseRuntime,
				to_runtime: route.baseRuntime,
			},
		],
	}, cwd, now);
	const policy = compileExecutionPolicy(route, classification);
	const policyRecord = transitionMissionState(routedRecord, "POLICY_COMPILED", { execution_policy: policy }, cwd, now);
	return {
		missionId: record.mission_id,
		normalized,
		classification,
		route,
		policy,
		record: policyRecord,
	};
}

export function acceptPlannerOutput(
	record: MissionOrchestratorRecord,
	policy: ExecutionPolicy,
	plannerInput: PlanContractDagInput,
	options: AcceptPlannerOutputOptions = {},
): PlannerGatewayResult & { record: MissionOrchestratorRecord } {
	const cwd = options.cwd ?? process.cwd();
	const now = options.now ?? Date.now;
	if (record.status !== "POLICY_COMPILED") {
		throw new Error(`Planner output can only be accepted after POLICY_COMPILED, got ${record.status}`);
	}
	const recordPolicy = record.execution_policy;
	if (!recordPolicy) {
		throw new Error(`Mission ${record.mission_id} has no persisted execution policy`);
	}
	if (policy.missionId !== record.mission_id || recordPolicy.missionId !== policy.missionId) {
		throw new Error(`Planner policy mission ${policy.missionId} does not match orchestrator record ${record.mission_id}`);
	}
	if (!policiesMatch(recordPolicy, policy)) {
		throw new Error("Planner policy does not match the orchestrator record execution policy");
	}
	const gateway = createContractDagFromPlanner(recordPolicy, plannerInput, cwd, now);
	const nextStatus = gateway.dag.ready_contracts.length > 0 ? "QUEUED" : "PLANNED";
	const nextRecord = transitionMissionState(record, nextStatus, { planner_input: plannerInput }, cwd, now);
	return { ...gateway, record: nextRecord };
}
