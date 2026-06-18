import type { AgentConfig } from "../../agents/agents.ts";
import type { FreshBootContract } from "../../harness/fresh-boot-contract.ts";
import type { PathContract } from "../../harness/path-contract.ts";
import { pathIdFromFolder, xenoniteNamespaceFromPath, type PathMemoryPacketInput } from "../../harness/path-memory.ts";
import type { AcceptanceInput } from "../../shared/types.ts";
import type { ChainStep, DynamicParallelStep, ParallelTaskItem, SequentialStep } from "../../shared/settings.ts";
import { isDynamicParallelStep, isParallelStep } from "../../shared/settings.ts";

const DEFAULT_WRITE_BUDGET = {
	max_tokens: 270_000,
	max_elapsed_ms: 180_000,
} as const;

const DEFAULT_READ_ONLY_BUDGET = {
	max_tokens: 270_000,
	max_elapsed_ms: 240_000,
} as const;

const READ_ONLY_AGENT_NAMES = new Set([
	"scout",
	"researcher",
	"planner",
	"context-builder",
	"reviewer",
	"oracle",
]);

const WRITE_INTENT_PATTERN = /\b(?:fix|implement|update|write|edit|modify|migrate|delete|remove|refactor|patch|change|create|add|apply)\b|고쳐|수정|구현|추가|변경|삭제|작성/i;
const NO_EDIT_PATTERN = /\b(?:read[- ]only|do not edit|don't edit|no edits|without edits|review only|조사만|읽기만)\b/i;
const PATH_PATTERN = /(?:^|\s|`)([A-Za-z0-9_.@~/-]+\/[A-Za-z0-9_.@~/-]*|(?:README|package|tsconfig)\.json|README(?:\.[A-Za-z0-9]+)?|Chart\.yaml|values\.ya?ml)(?=\s|`|$|[,.):])/g;

export interface RuntimeArchitectureTask {
	agent: string;
	task?: string;
	cwd?: string;
	memoryPacket?: PathMemoryPacketInput;
	pathContract?: PathContract;
	bootContract?: FreshBootContract;
	acceptance?: AcceptanceInput;
	output?: string | boolean;
	outputMode?: "inline" | "file-only";
}

export interface RuntimeArchitectureParams {
	agent?: string;
	task?: string;
	cwd?: string;
	memoryPacket?: PathMemoryPacketInput;
	pathContract?: PathContract;
	bootContract?: FreshBootContract;
	acceptance?: AcceptanceInput;
	output?: string | boolean;
	outputMode?: "inline" | "file-only";
	tasks?: RuntimeArchitectureTask[];
	chain?: ChainStep[];
}

export interface RuntimeArchitecturePolicyResult<T extends RuntimeArchitectureParams> {
	params?: T;
	error?: string;
	warnings: string[];
}

function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "contract";
}

function normalizePath(candidate: string): string {
	return candidate.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "");
}

function pathGlob(candidate: string): string {
	const normalized = normalizePath(candidate);
	if (!normalized || normalized === ".") return "**/*";
	if (/[*?[\]{}]/.test(normalized)) return normalized;
	if (/\.[A-Za-z0-9]+$/.test(normalized)) return normalized;
	return `${normalized}/**`;
}

function inferMentionedPath(task: string | undefined, cwd: string | undefined, output: string | boolean | undefined): string | undefined {
	if (typeof output === "string" && output.trim() && output.trim().toLowerCase() !== "false") return normalizePath(output);
	const raw = [task, cwd].filter((value): value is string => Boolean(value?.trim())).join(" ");
	for (const match of raw.matchAll(PATH_PATTERN)) {
		const candidate = match[1]?.trim().replace(/^`|`$/g, "");
		if (candidate) return normalizePath(candidate);
	}
	return undefined;
}

function localAgentName(agentName: string): string {
	return agentName.includes(".") ? agentName.slice(agentName.lastIndexOf(".") + 1) : agentName;
}

function isReadOnlyAgent(agentName: string): boolean {
	return READ_ONLY_AGENT_NAMES.has(localAgentName(agentName));
}

function expectsWrite(task: RuntimeArchitectureTask, agent?: AgentConfig): boolean {
	const text = task.task ?? "";
	if (task.outputMode === "file-only" && !task.output) return false;
	if (typeof task.output === "string" && task.output === "false") return false;
	if (text.trim().toLowerCase() === "write") return false;
	if (NO_EDIT_PATTERN.test(text)) return false;
	if (agent?.tools?.some((tool) => ["edit", "write", "apply_patch"].includes(localAgentName(tool)))) {
		return WRITE_INTENT_PATTERN.test(text);
	}
	return WRITE_INTENT_PATTERN.test(text) && !isReadOnlyAgent(task.agent);
}

function hasWriteAuthority(contract: PathContract | undefined): boolean {
	return Boolean(contract?.write_allowed_paths?.length || contract?.owned_paths?.length || contract?.assigned_path);
}

function bootHasWriteAuthority(contract: FreshBootContract | undefined): boolean {
	return Boolean(contract?.execution_contract.write_allowed_paths.length || contract?.execution_contract.owned_paths.length || contract?.execution_contract.assigned_path);
}

function readOnlyPathContract(task: RuntimeArchitectureTask): PathContract {
	return {
		contract_id: `readonly-${safeId(task.agent)}`,
		assigned_worker: task.agent,
		read_allowed_paths: ["**/*"],
		write_allowed_paths: [],
		write_denied_paths: ["**/*"],
		activity_budget: { ...DEFAULT_READ_ONLY_BUDGET },
	};
}

function writePathContract(task: RuntimeArchitectureTask, assignedPath: string): PathContract {
	const normalized = normalizePath(assignedPath);
	const glob = pathGlob(normalized);
	return {
		contract_id: `contract-${safeId(task.agent)}-${safeId(normalized)}`,
		assigned_worker: task.agent,
		assigned_path: normalized,
		owned_paths: [glob],
		read_allowed_paths: ["**/*"],
		write_allowed_paths: [glob],
		write_denied_paths: [],
		activity_budget: { ...DEFAULT_WRITE_BUDGET },
	};
}

function memoryPathSegment(assignedPath: string | undefined): string {
	const normalized = normalizePath(assignedPath || "project")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	return normalized || "project";
}

function defaultPathMemoryPacket(task: RuntimeArchitectureTask, assignedPath: string | undefined): PathMemoryPacketInput {
	const segment = memoryPathSegment(assignedPath);
	const pathId = pathIdFromFolder(segment);
	const include = {
		profile: true,
		conventions: true,
		recent_decisions: 5,
		known_failures: 3,
		incidents: 3,
		contract_summaries: 5,
	};
	return {
		packet_id: `runtime-${safeId(task.agent)}-${safeId(segment)}`,
		contract_id: `memory-${safeId(task.agent)}-${safeId(segment)}`,
		memory_scope: {
			type: "path",
			path_id: pathId,
			agent_id: task.agent,
			memory_path: `.harness/memory/paths/${segment}`,
			xenonite_namespace: xenoniteNamespaceFromPath(segment),
		},
		memory_attachments: [{
			attachment_id: `memory-${safeId(task.agent)}-${safeId(segment)}`,
			path_id: pathId,
			agent_id: task.agent,
			memory_path: `.harness/memory/paths/${segment}`,
			xenonite_namespace: xenoniteNamespaceFromPath(segment),
			mode: "read_only",
			include,
			budget: { max_bytes: 12_000 },
		}],
		apply_updates_after_validation_pass: true,
	};
}

function withDefaultMemory<T extends RuntimeArchitectureTask>(task: T, assignedPath: string | undefined): T {
	if (task.memoryPacket || task.bootContract) return task;
	return { ...task, memoryPacket: defaultPathMemoryPacket(task, assignedPath) } as T;
}

function requiredAcceptance(write: boolean): AcceptanceInput {
	return write
		? {
			level: "checked",
			evidence: ["changed-files", "commands-run", "validation-output", "residual-risks", "no-staged-files"],
			criteria: [
				{
					id: "runtime-contract",
					must: "Work executed under a path execution contract and reported concrete validation evidence.",
					evidence: ["changed-files", "commands-run", "validation-output"],
				},
			],
		}
		: {
			level: "none",
			evidence: [],
			criteria: [
				{
					id: "read-only-boundary",
					must: "Read-only task did not modify repository paths.",
					evidence: [],
				},
			],
		};
}

function mandatoryAcceptance(current: AcceptanceInput | undefined, write: boolean): AcceptanceInput {
	if (current === undefined || current === false) return requiredAcceptance(write);
	return current;
}

function normalizeTask<T extends RuntimeArchitectureTask>(
	task: T,
	agentsByName: Map<string, AgentConfig>,
	warnings: string[],
): { task?: T; error?: string } {
	if (task.bootContract) {
		if (isReadOnlyAgent(task.agent) && bootHasWriteAuthority(task.bootContract)) {
			return { error: `Runtime architecture policy blocks read-only role '${task.agent}' from receiving a write-capable FreshBootContract.` };
		}
		return { task: { ...task, acceptance: mandatoryAcceptance(task.acceptance, true) } };
	}
	if (task.pathContract) {
		if (isReadOnlyAgent(task.agent) && hasWriteAuthority(task.pathContract)) {
			return { error: `Runtime architecture policy blocks read-only role '${task.agent}' from receiving a write-capable pathContract.` };
		}
		return {
			task: {
				...withDefaultMemory(task, task.pathContract.assigned_path),
				acceptance: mandatoryAcceptance(task.acceptance, hasWriteAuthority(task.pathContract)),
			},
		};
	}
	const agent = agentsByName.get(task.agent);
	const write = expectsWrite(task, agent);
	if (!write) {
		if (!isReadOnlyAgent(task.agent)) {
			return { task };
		}
		warnings.push(`Runtime architecture policy attached read-only contract to ${task.agent}.`);
		return {
			task: {
				...withDefaultMemory(task, inferMentionedPath(task.task, task.cwd, task.output)),
				pathContract: readOnlyPathContract(task),
				acceptance: mandatoryAcceptance(task.acceptance, false),
			} as T,
		};
	}
	const assignedPath = inferMentionedPath(task.task, task.cwd, task.output);
	if (!assignedPath) {
		return {
			error: `Runtime architecture policy requires an assigned_path/pathContract/FreshBootContract for write-capable task '${task.agent}'. Mention an owned path or provide pathContract/bootContract.`,
		};
	}
	warnings.push(`Runtime architecture policy attached write contract for ${task.agent} at ${assignedPath}.`);
	return {
		task: {
			...withDefaultMemory(task, assignedPath),
			pathContract: writePathContract(task, assignedPath),
			acceptance: mandatoryAcceptance(task.acceptance, true),
		} as T,
	};
}

function normalizeChainStep(
	step: ChainStep,
	agentsByName: Map<string, AgentConfig>,
	warnings: string[],
): { step?: ChainStep; error?: string } {
	if (isParallelStep(step)) {
		const parallel: ParallelTaskItem[] = [];
		for (const task of step.parallel) {
			const normalized = normalizeTask(task, agentsByName, warnings);
			if (normalized.error) return { error: normalized.error };
			parallel.push(normalized.task!);
		}
		return { step: { ...step, parallel } };
	}
	if (isDynamicParallelStep(step)) {
		const normalized = normalizeTask(step.parallel, agentsByName, warnings);
		if (normalized.error) return { error: normalized.error };
		return {
			step: {
				...step,
				parallel: normalized.task as DynamicParallelStep["parallel"],
				acceptance: mandatoryAcceptance(step.acceptance, Boolean(normalized.task?.pathContract?.write_allowed_paths?.length || normalized.task?.bootContract)),
			},
		};
	}
	const normalized = normalizeTask(step as SequentialStep, agentsByName, warnings);
	if (normalized.error) return { error: normalized.error };
	return { step: normalized.task as SequentialStep };
}

export function applyRuntimeArchitecturePolicy<T extends RuntimeArchitectureParams>(
	params: T,
	agents: AgentConfig[],
): RuntimeArchitecturePolicyResult<T> {
	const warnings: string[] = [];
	const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
	if (params.tasks?.length) {
		const tasks: RuntimeArchitectureTask[] = [];
		for (const task of params.tasks) {
			const normalized = normalizeTask(task, agentsByName, warnings);
			if (normalized.error) return { error: normalized.error, warnings };
			tasks.push(normalized.task!);
		}
		return { params: { ...params, tasks } as T, warnings };
	}
	if (params.chain?.length) {
		const chain: ChainStep[] = [];
		for (const step of params.chain) {
			const normalized = normalizeChainStep(step, agentsByName, warnings);
			if (normalized.error) return { error: normalized.error, warnings };
			chain.push(normalized.step!);
		}
		return { params: { ...params, chain } as T, warnings };
	}
	if (params.agent) {
		const normalized = normalizeTask({
			agent: params.agent,
			task: params.task,
			cwd: params.cwd,
			memoryPacket: params.memoryPacket,
			pathContract: params.pathContract,
			bootContract: params.bootContract,
			acceptance: params.acceptance,
			output: params.output,
			outputMode: params.outputMode,
		}, agentsByName, warnings);
		if (normalized.error) return { error: normalized.error, warnings };
		return {
			params: {
				...params,
				memoryPacket: normalized.task?.memoryPacket,
				pathContract: normalized.task?.pathContract,
				bootContract: normalized.task?.bootContract,
				acceptance: normalized.task?.acceptance,
			} as T,
			warnings,
		};
	}
	return { params, warnings };
}
