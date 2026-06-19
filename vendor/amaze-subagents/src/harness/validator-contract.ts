import type { FreshBootContract, HarnessOutputRequired } from "./fresh-boot-contract.ts";
import { xenoniteNamespaceFromPath } from "./path-memory.ts";

export interface HarnessValidatorContract {
	contract_id: string;
	assigned_specialist: string;
	assigned_path: string;
	checks: {
		fresh_boot: true;
		parent_context_disabled: true;
		path_boundaries: {
			read_allowed_paths: string[];
			write_allowed_paths: string[];
			write_denied_paths: string[];
		};
		activity_budget: {
			max_tool_uses: number;
			max_tokens: number;
			max_elapsed_ms: number;
		};
		output_required: HarnessOutputRequired[];
		memory_updates: {
			read_only_attachments: boolean;
			commit_after_validation: true;
			attachment_count: number;
			xenonite_namespace: string;
		};
		acceptance: {
			must_change: string[];
			must_not_change: string[];
			validation_commands: string[];
		};
		tool_policy: {
			xenonite_first: true;
			core_tools_available: true;
			skills_available: true;
			parent_tool_inheritance: false;
		};
		coordination: {
			irc_required: true;
			orchestrator_contact: "intercom";
			goal_updates_allowed: true;
		};
	};
}

export interface HarnessValidationReport {
	status: "valid" | "invalid";
	validator_contract: HarnessValidatorContract;
	errors: string[];
	warnings: string[];
}

function hasItems(values: string[] | undefined): values is string[] {
	return Array.isArray(values) && values.length > 0;
}

function allFalse(parent: FreshBootContract["parent_context"]): boolean {
	return parent.inherit_conversation === false
		&& parent.inherit_system_prompt === false
		&& parent.inherit_tools === false
		&& parent.inherit_skills === false;
}

export function deriveHarnessValidatorContract(contract: FreshBootContract): HarnessValidatorContract {
	return {
		contract_id: contract.contract_id,
		assigned_specialist: contract.execution_contract.assigned_specialist,
		assigned_path: contract.execution_contract.assigned_path,
		checks: {
			fresh_boot: true,
			parent_context_disabled: true,
			path_boundaries: {
				read_allowed_paths: contract.execution_contract.read_allowed_paths,
				write_allowed_paths: contract.execution_contract.write_allowed_paths,
				write_denied_paths: contract.execution_contract.write_denied_paths,
			},
			activity_budget: contract.execution_contract.activity_budget,
			output_required: contract.execution_contract.output_required,
			memory_updates: {
				read_only_attachments: contract.memory_attachments.every((attachment) => attachment.mode === "read_only"),
				commit_after_validation: true,
				attachment_count: contract.memory_attachments.length,
				xenonite_namespace: xenoniteNamespaceFromPath(contract.execution_contract.assigned_path),
			},
			acceptance: contract.execution_contract.acceptance,
			tool_policy: contract.execution_contract.tool_policy,
			coordination: contract.execution_contract.coordination,
		},
	};
}

export function validateHarnessValidatorContract(contract: FreshBootContract): HarnessValidationReport {
	const errors: string[] = [];
	const warnings: string[] = [];
	const validatorContract = deriveHarnessValidatorContract(contract);

	if (contract.boot_mode !== "fresh") errors.push("boot_mode must be fresh.");
	if (!allFalse(contract.parent_context)) errors.push("parent_context inheritance must be fully disabled.");
	if (contract.execution_contract.contract_id !== contract.contract_id) {
		errors.push("execution_contract.contract_id must match FreshBootContract.contract_id.");
	}
	if (contract.execution_contract.assigned_specialist !== contract.specialist.path_id) {
		errors.push("execution_contract.assigned_specialist must match specialist.path_id.");
	}
	if (contract.execution_contract.assigned_path !== contract.specialist.owned_path) {
		errors.push("execution_contract.assigned_path must match specialist.owned_path.");
	}
	if (!hasItems(contract.execution_contract.owned_paths)) errors.push("execution_contract.owned_paths must not be empty.");
	if (!hasItems(contract.execution_contract.write_allowed_paths)) errors.push("execution_contract.write_allowed_paths must not be empty.");
	if (!hasItems(contract.execution_contract.read_allowed_paths)) warnings.push("execution_contract.read_allowed_paths is empty; reads are limited to owned/write paths only.");
	if (!hasItems(contract.execution_contract.write_denied_paths)) warnings.push("execution_contract.write_denied_paths is empty; no explicit deny list is declared.");
	if (contract.execution_contract.activity_budget.max_tool_uses <= 0) errors.push("activity_budget.max_tool_uses must be greater than zero.");
	if (contract.execution_contract.activity_budget.max_tokens <= 0) errors.push("activity_budget.max_tokens must be greater than zero.");
	if (contract.execution_contract.activity_budget.max_elapsed_ms <= 0) errors.push("activity_budget.max_elapsed_ms must be greater than zero.");
	if (!hasItems(contract.execution_contract.output_required)) errors.push("execution_contract.output_required must not be empty.");
	if (!contract.execution_contract.output_required.includes("memory_updates")) {
		warnings.push("output_required does not include memory_updates; path memory commit proposals will be unavailable.");
	}
	if (!contract.execution_contract.tool_policy.xenonite_first) errors.push("tool_policy.xenonite_first must be true.");
	if (!contract.execution_contract.tool_policy.core_tools_available) errors.push("tool_policy.core_tools_available must be true.");
	if (!contract.execution_contract.tool_policy.skills_available) errors.push("tool_policy.skills_available must be true.");
	if (contract.execution_contract.tool_policy.parent_tool_inheritance) errors.push("tool_policy.parent_tool_inheritance must be false.");
	if (!contract.execution_contract.coordination.irc_required) errors.push("coordination.irc_required must be true.");
	if (contract.execution_contract.coordination.orchestrator_contact !== "intercom") errors.push("coordination.orchestrator_contact must be intercom.");
	if (!contract.execution_contract.coordination.goal_updates_allowed) errors.push("coordination.goal_updates_allowed must be true.");
	if (contract.memory_attachments.length === 0) errors.push("memory_attachments must include at least one read-only path attachment.");
	const expectedXenoniteNamespace = xenoniteNamespaceFromPath(contract.execution_contract.assigned_path);
	for (const [index, attachment] of contract.memory_attachments.entries()) {
		if (attachment.mode !== "read_only") errors.push(`memory_attachments[${index}].mode must be read_only.`);
		if (attachment.path_id !== contract.specialist.path_id) {
			errors.push(`memory_attachments[${index}].path_id must match specialist.path_id.`);
		}
		if (attachment.memory_path !== contract.specialist.memory_path) {
			errors.push(`memory_attachments[${index}].memory_path must match specialist.memory_path.`);
		}
		const xenoniteNamespace = (attachment as { xenonite_namespace?: unknown; xenoniteNamespace?: unknown }).xenonite_namespace
			?? (attachment as { xenonite_namespace?: unknown; xenoniteNamespace?: unknown }).xenoniteNamespace;
		if (typeof xenoniteNamespace === "string" && xenoniteNamespace !== expectedXenoniteNamespace) {
			errors.push(`memory_attachments[${index}].xenonite_namespace must match '${expectedXenoniteNamespace}'.`);
		}
	}
	if (!hasItems(contract.execution_contract.acceptance.validation_commands)) {
		warnings.push("acceptance.validation_commands is empty; validator has no command-level evidence gate.");
	}

	return {
		status: errors.length === 0 ? "valid" : "invalid",
		validator_contract: validatorContract,
		errors,
		warnings,
	};
}
