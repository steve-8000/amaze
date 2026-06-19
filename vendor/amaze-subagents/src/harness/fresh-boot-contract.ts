import type { PathContract } from "./path-contract.ts";
import { xenoniteNamespaceFromPath } from "./path-memory.ts";
import type {
	PathMemoryAttachment,
	PathMemoryBudget,
	PathMemoryInclude,
	PathMemoryPacketInput,
	PathMemoryScope,
} from "./path-memory.ts";

export const FRESH_BOOT_CONTRACT_ENV = "PI_SUBAGENT_FRESH_BOOT_CONTRACT";

export interface FreshBootParentContext {
	inherit_conversation: false;
	inherit_system_prompt: false;
	inherit_tools: false;
	inherit_skills: false;
}

export interface FreshBootSpecialist {
	path_id: string;
	owned_path: string;
	memory_path: string;
}

export interface ContextPacket {
	packet_id: string;
	path: string;
}

export interface MemoryAttachment extends PathMemoryAttachment {
	attachment_id: string;
	path_id: string;
	memory_path: string;
	xenonite_namespace?: string;
	include: PathMemoryInclude;
	mode: "read_only";
	budget: PathMemoryBudget;
}

export interface ActivityBudget {
	max_tool_uses: number;
	max_tokens: number;
	max_elapsed_ms: number;
}

export interface HarnessAcceptanceContract {
	must_change: string[];
	must_not_change: string[];
	validation_commands: string[];
}

export interface ToolPolicy {
	xenonite_first: true;
	core_tools_available: true;
	skills_available: true;
	parent_tool_inheritance: false;
}

export interface CoordinationPolicy {
	irc_required: true;
	orchestrator_contact: "intercom";
	goal_updates_allowed: true;
}

export type HarnessOutputRequired =
	| "summary"
	| "files_changed"
	| "tests_run"
	| "risks"
	| "change_requests"
	| "memory_updates";

export interface HarnessExecutionContract {
	contract_id: string;
	assigned_path: string;
	assigned_specialist: string;
	goal: string;
	owned_paths: string[];
	read_allowed_paths: string[];
	write_allowed_paths: string[];
	write_denied_paths: string[];
	activity_budget: ActivityBudget;
	acceptance: HarnessAcceptanceContract;
	tool_policy: ToolPolicy;
	coordination: CoordinationPolicy;
	output_required: HarnessOutputRequired[];
}

export interface FreshBootContract {
	boot_id: string;
	mission_id: string;
	contract_id: string;
	boot_mode: "fresh";
	parent_context: FreshBootParentContext;
	specialist: FreshBootSpecialist;
	context_packet: ContextPacket;
	memory_attachments: MemoryAttachment[];
	execution_contract: HarnessExecutionContract;
}

const FRESH_PARENT_CONTEXT: FreshBootParentContext = {
	inherit_conversation: false,
	inherit_system_prompt: false,
	inherit_tools: false,
	inherit_skills: false,
};

const DEFAULT_OUTPUT_REQUIRED: HarnessOutputRequired[] = [
	"summary",
	"files_changed",
	"tests_run",
	"risks",
	"change_requests",
	"memory_updates",
];

const DEFAULT_ACTIVITY_BUDGET: ActivityBudget = {
	max_tool_uses: 40,
	max_tokens: 80_000,
	max_elapsed_ms: 180_000,
};

const DEFAULT_TOOL_POLICY: ToolPolicy = {
	xenonite_first: true,
	core_tools_available: true,
	skills_available: true,
	parent_tool_inheritance: false,
};

const DEFAULT_COORDINATION_POLICY: CoordinationPolicy = {
	irc_required: true,
	orchestrator_contact: "intercom",
	goal_updates_allowed: true,
};

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseParentContext(value: unknown): FreshBootParentContext | undefined {
	const object = asObject(value);
	if (!object) return { ...FRESH_PARENT_CONTEXT };
	for (const key of Object.keys(FRESH_PARENT_CONTEXT) as Array<keyof FreshBootParentContext>) {
		if (object[key] === true) return undefined;
	}
	return { ...FRESH_PARENT_CONTEXT };
}

function parseSpecialist(value: unknown): FreshBootSpecialist | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const pathId = asString(object.path_id);
	const ownedPath = asString(object.owned_path);
	const memoryPath = asString(object.memory_path);
	if (!pathId || !ownedPath || !memoryPath) return undefined;
	return {
		path_id: pathId,
		owned_path: ownedPath,
		memory_path: memoryPath,
	};
}

function parseContextPacket(value: unknown): ContextPacket | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const packetId = asString(object.packet_id);
	const packetPath = asString(object.path);
	if (!packetId || !packetPath) return undefined;
	return {
		packet_id: packetId,
		path: packetPath,
	};
}

function parseActivityBudget(value: unknown): ActivityBudget {
	const object = asObject(value);
	return {
		max_tool_uses: asNumber(object?.max_tool_uses, DEFAULT_ACTIVITY_BUDGET.max_tool_uses),
		max_tokens: asNumber(object?.max_tokens, DEFAULT_ACTIVITY_BUDGET.max_tokens),
		max_elapsed_ms: asNumber(object?.max_elapsed_ms, DEFAULT_ACTIVITY_BUDGET.max_elapsed_ms),
	};
}

function parseAcceptance(value: unknown): HarnessAcceptanceContract {
	const object = asObject(value);
	return {
		must_change: asStringArray(object?.must_change),
		must_not_change: asStringArray(object?.must_not_change),
		validation_commands: asStringArray(object?.validation_commands),
	};
}

function parseToolPolicy(value: unknown): ToolPolicy {
	const object = asObject(value);
	return {
		xenonite_first: object?.xenonite_first === false ? true : DEFAULT_TOOL_POLICY.xenonite_first,
		core_tools_available: object?.core_tools_available === false ? true : DEFAULT_TOOL_POLICY.core_tools_available,
		skills_available: object?.skills_available === false ? true : DEFAULT_TOOL_POLICY.skills_available,
		parent_tool_inheritance: false,
	};
}

function parseCoordinationPolicy(value: unknown): CoordinationPolicy {
	const object = asObject(value);
	return {
		irc_required: object?.irc_required === false ? true : DEFAULT_COORDINATION_POLICY.irc_required,
		orchestrator_contact: "intercom",
		goal_updates_allowed: object?.goal_updates_allowed === false ? true : DEFAULT_COORDINATION_POLICY.goal_updates_allowed,
	};
}

function parseOutputRequired(value: unknown): HarnessOutputRequired[] {
	const values = asStringArray(value).filter((item): item is HarnessOutputRequired =>
		(DEFAULT_OUTPUT_REQUIRED as string[]).includes(item)
	);
	return values.length ? values : [...DEFAULT_OUTPUT_REQUIRED];
}

function parseExecutionContract(value: unknown, fallbackContractId: string | undefined): HarnessExecutionContract | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const contractId = asString(object.contract_id) ?? fallbackContractId;
	const assignedPath = asString(object.assigned_path);
	const assignedSpecialist = asString(object.assigned_specialist);
	const goal = asString(object.goal);
	if (!contractId || !assignedPath || !assignedSpecialist || !goal) return undefined;
	const ownedPaths = asStringArray(object.owned_paths);
	const writeAllowedPaths = asStringArray(object.write_allowed_paths);
	return {
		contract_id: contractId,
		assigned_path: assignedPath,
		assigned_specialist: assignedSpecialist,
		goal,
		owned_paths: ownedPaths.length ? ownedPaths : [`${assignedPath.replace(/\/$/, "")}/**`],
		read_allowed_paths: asStringArray(object.read_allowed_paths),
		write_allowed_paths: writeAllowedPaths.length
			? writeAllowedPaths
			: ownedPaths.length
				? ownedPaths
				: [`${assignedPath.replace(/\/$/, "")}/**`],
		write_denied_paths: asStringArray(object.write_denied_paths),
		activity_budget: parseActivityBudget(object.activity_budget),
		acceptance: parseAcceptance(object.acceptance),
		tool_policy: parseToolPolicy(object.tool_policy),
		coordination: parseCoordinationPolicy(object.coordination),
		output_required: parseOutputRequired(object.output_required),
	};
}

function parseAttachment(value: unknown): MemoryAttachment | undefined {
	const object = asObject(value);
	if (!object) return undefined;
	const pathId = asString(object.path_id);
	const memoryPath = asString(object.memory_path);
	if (!pathId || !memoryPath || (object.mode !== undefined && object.mode !== "read_only")) return undefined;
	return {
		attachment_id: asString(object.attachment_id) ?? `${pathId}:attachment`,
		path_id: pathId,
		memory_path: memoryPath,
		xenonite_namespace: asString(object.xenonite_namespace),
		include: asObject(object.include) as PathMemoryInclude | undefined ?? {},
		mode: "read_only",
		budget: asObject(object.budget) as PathMemoryBudget | undefined ?? {},
	};
}

function parseAttachments(value: unknown, specialist: FreshBootSpecialist): MemoryAttachment[] {
	const parsed = Array.isArray(value)
		? value.map(parseAttachment).filter((attachment): attachment is MemoryAttachment => Boolean(attachment))
		: [];
	if (parsed.length) return parsed;
	return [{
		attachment_id: `${specialist.path_id}:default`,
		path_id: specialist.path_id,
		memory_path: specialist.memory_path,
		include: {},
		mode: "read_only",
		budget: {},
	}];
}

export function parseFreshBootContract(value: unknown): FreshBootContract | undefined {
	const object = asObject(value);
	if (!object || object.boot_mode !== "fresh") return undefined;
	const bootId = asString(object.boot_id);
	const missionId = asString(object.mission_id);
	const contractId = asString(object.contract_id);
	const parentContext = parseParentContext(object.parent_context);
	const specialist = parseSpecialist(object.specialist);
	const contextPacket = parseContextPacket(object.context_packet);
	if (!bootId || !missionId || !contractId || !parentContext || !specialist || !contextPacket) return undefined;
	const executionContract = parseExecutionContract(object.execution_contract, contractId);
	if (!executionContract) return undefined;
	return {
		boot_id: bootId,
		mission_id: missionId,
		contract_id: contractId,
		boot_mode: "fresh",
		parent_context: parentContext,
		specialist,
		context_packet: contextPacket,
		memory_attachments: parseAttachments(object.memory_attachments, specialist),
		execution_contract: executionContract,
	};
}

export function renderFreshBootContract(contract: FreshBootContract): string {
	return [
		"# Harness Fresh Boot Contract",
		"",
		"This child runtime must boot fresh. Parent conversation, system prompt, tools, and skills are not inherited.",
		"All authority comes from the execution contract, context packet, and read-only path memory attachments.",
		"",
		"```json",
		JSON.stringify(contract, null, 2),
		"```",
	].join("\n");
}

export function freshBootContractToPathMemoryPacket(contract: FreshBootContract): PathMemoryPacketInput {
	const memoryScope: PathMemoryScope = {
		type: "path",
		path_id: contract.specialist.path_id,
		agent_id: contract.execution_contract.assigned_specialist,
		memory_path: contract.specialist.memory_path,
		xenonite_namespace: xenoniteNamespaceFromPath(contract.execution_contract.assigned_path),
	};
	return {
		packet_id: contract.context_packet.packet_id,
		contract_id: contract.contract_id,
		memory_scope: memoryScope,
		memory_attachments: contract.memory_attachments,
		apply_updates_after_validation_pass: true,
	};
}

export function freshBootContractToPathContract(contract: FreshBootContract): PathContract {
	return {
		contract_id: contract.execution_contract.contract_id,
		mission_id: contract.mission_id,
		assigned_worker: contract.execution_contract.assigned_specialist,
		assigned_path: contract.execution_contract.assigned_path,
		owned_paths: contract.execution_contract.owned_paths,
		read_allowed_paths: contract.execution_contract.read_allowed_paths,
		write_allowed_paths: contract.execution_contract.write_allowed_paths,
		write_denied_paths: contract.execution_contract.write_denied_paths,
		activity_budget: contract.execution_contract.activity_budget,
	};
}
