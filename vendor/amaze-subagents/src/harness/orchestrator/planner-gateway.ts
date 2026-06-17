/// <reference types="node" />

import { planContractDag, type ContractDagRecord } from "../contract-dag.ts";
import type { ExecutionPolicy } from "./types.ts";
import type { PlanContractDagInput } from "../contract-dag.ts";

export interface PlannerGatewayResult {
	dag: ContractDagRecord;
	warnings: string[];
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function hasWriteScope(contract: PlanContractDagInput["contracts"][number]): boolean {
	return Boolean(
		isNonEmptyString(contract.assigned_path)
			|| contract.owned_paths?.some(isNonEmptyString)
			|| contract.write_allowed_paths?.some(isNonEmptyString),
	);
}

function normalizedContract(input: PlanContractDagInput["contracts"][number], missionId: string): PlanContractDagInput["contracts"][number] {
	const assignedPath = input.assigned_path?.replace(/\/$/, "");
	const ownedPaths = input.owned_paths?.length
		? [...input.owned_paths]
		: assignedPath
			? [`${assignedPath}/**`]
			: [];
	const writeAllowedPaths = input.write_allowed_paths?.length ? [...input.write_allowed_paths] : ownedPaths;
	return {
		...input,
		mission_id: input.mission_id ?? missionId,
		owned_paths: ownedPaths,
		write_allowed_paths: writeAllowedPaths,
	};
}

export function validatePlannerOutput(policy: ExecutionPolicy, input: PlanContractDagInput): string[] {
	if (input.mission_id !== policy.missionId) {
		throw new Error(`Planner mission_id ${input.mission_id} does not match policy mission ${policy.missionId}`);
	}
	if (!Array.isArray(input.contracts)) {
		throw new Error("Planner output must include contracts array");
	}
	if (input.contracts.length > policy.plannerPolicy.maxInitialContracts) {
		throw new Error(`Planner emitted ${input.contracts.length} contract(s), above maxInitialContracts=${policy.plannerPolicy.maxInitialContracts}`);
	}
	const warnings: string[] = [];
	for (const contract of input.contracts) {
		if (!isNonEmptyString(contract.contract_id)) throw new Error("Planner contract is missing contract_id");
		if (!hasWriteScope(contract)) throw new Error(`Planner contract ${contract.contract_id} is missing assigned_path or write scope`);
		if (policy.agentPolicy.writeScope === "owned_path_only" && !contract.write_allowed_paths?.length && !contract.owned_paths?.length && !contract.assigned_path) {
			throw new Error(`Planner contract ${contract.contract_id} lacks owned write boundary`);
		}
		if (policy.plannerPolicy.requireChangeRequestsForCrossPath && (contract.write_allowed_paths?.length ?? 0) > 3) {
			warnings.push(`Contract ${contract.contract_id} has broad write scope; prefer change requests for cross-path expansion.`);
		}
	}
	return warnings;
}

export function createContractDagFromPlanner(
	policy: ExecutionPolicy,
	input: PlanContractDagInput,
	cwd = process.cwd(),
	now = Date.now,
): PlannerGatewayResult {
	const warnings = validatePlannerOutput(policy, input);
	const normalized: PlanContractDagInput = {
		...input,
		contracts: input.contracts.map((contract) => normalizedContract(contract, policy.missionId)),
	};
	const dag = planContractDag(normalized, cwd, now);
	return { dag, warnings };
}
