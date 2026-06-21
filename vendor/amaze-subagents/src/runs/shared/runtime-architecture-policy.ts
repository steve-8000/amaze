import type { AgentConfig } from "../../agents/agents.ts";
import type { FreshBootContract } from "../../harness/fresh-boot-contract.ts";
import type { PathContract } from "../../harness/path-contract.ts";
import type { PathMemoryPacketInput } from "../../harness/path-memory.ts";
import type { ChainStep, DynamicParallelStep, ParallelTaskItem, SequentialStep } from "../../shared/settings.ts";
import { isDynamicParallelStep, isParallelStep } from "../../shared/settings.ts";
import type { AcceptanceInput } from "../../shared/types.ts";

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

function stripExecutionContract(bootContract: FreshBootContract | undefined): FreshBootContract | undefined {
	if (!bootContract) return undefined;
	return { ...bootContract, execution_contract: undefined } as unknown as FreshBootContract;
}

function normalizeTask<T extends RuntimeArchitectureTask>(task: T): T {
	return {
		...task,
		pathContract: undefined,
		bootContract: stripExecutionContract(task.bootContract),
	} as T;
}

function normalizeChainStep(step: ChainStep): ChainStep {
	if (isParallelStep(step)) {
		const parallel: ParallelTaskItem[] = step.parallel.map((task) => normalizeTask(task));
		return { ...step, parallel };
	}
	if (isDynamicParallelStep(step)) {
		return {
			...step,
			parallel: normalizeTask(step.parallel) as DynamicParallelStep["parallel"],
		};
	}
	return normalizeTask(step as SequentialStep) as SequentialStep;
}

export function applyRuntimeArchitecturePolicy<T extends RuntimeArchitectureParams>(
	params: T,
	_agents: AgentConfig[],
): RuntimeArchitecturePolicyResult<T> {
	if (params.tasks?.length) {
		return { params: { ...params, tasks: params.tasks.map((task) => normalizeTask(task)) } as T, warnings: [] };
	}
	if (params.chain?.length) {
		return { params: { ...params, chain: params.chain.map((step) => normalizeChainStep(step)) } as T, warnings: [] };
	}
	if (params.agent) {
		const task = normalizeTask({
			agent: params.agent,
			task: params.task,
			cwd: params.cwd,
			memoryPacket: params.memoryPacket,
			pathContract: params.pathContract,
			bootContract: params.bootContract,
			acceptance: params.acceptance,
			output: params.output,
			outputMode: params.outputMode,
		});
		return {
			params: {
				...params,
				memoryPacket: task.memoryPacket,
				pathContract: undefined,
				bootContract: task.bootContract,
				acceptance: task.acceptance,
			} as T,
			warnings: [],
		};
	}
	return { params, warnings: [] };
}
