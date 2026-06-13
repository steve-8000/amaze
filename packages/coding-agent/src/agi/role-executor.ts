import type { ObjectiveContract, RuntimeAction, RuntimeRole } from "../autonomy/types";
import type { Mission } from "../mission/core/mission";
import type { ToolDescriptor, ToolExecutionContext } from "../tools/registry/tool-descriptor";
import type { ToolRegistry } from "../tools/registry/tool-registry";
import {
	type CapabilityLease,
	classifyToolMutation,
	leaseGrantsSandbox,
	mutationClassRequiresSandbox,
} from "./capability-lease";
import type { SandboxWorkspace } from "./sandbox-manager";

export interface RoleExecutionResult {
	actionId: string;
	status: "succeeded" | "failed" | "blocked";
	evidenceRefs: string[];
	error?: string;
}

export interface RoleExecutionInput {
	action: RuntimeAction;
	lease: CapabilityLease;
	mission: Mission;
	contract: ObjectiveContract;
	sandboxWorkspace?: SandboxWorkspace;
}

export interface RoleExecutor {
	execute(input: RoleExecutionInput): Promise<RoleExecutionResult>;
}

const COMPLETION_APPROVAL_ROLES = new Set<RuntimeRole>(["Verifier"]);

export interface RegistryRoleExecutorOptions {
	registry: Pick<ToolRegistry, "get">;
	buildInput?: (input: RoleExecutionInput) => unknown;
	buildContext?: (input: RoleExecutionInput & { tool: ToolDescriptor }) => ToolExecutionContext;
}

export function assertRoleLeaseAlignment(
	action: RuntimeAction,
	lease: CapabilityLease,
	contract: ObjectiveContract,
): void {
	if (lease.actionId !== action.id) throw new Error("Lease/action mismatch");
	if (lease.planStepId !== action.stepId) throw new Error("Lease/plan step mismatch");
	if (lease.actorRole !== action.role) throw new Error("Lease role does not match runtime action role");
	const capability = contract.rolePolicy.capabilities.find(candidate => candidate.role === action.role);
	if (!capability) throw new Error(`No role capability configured for ${action.role}`);
	for (const tool of lease.allowedTools) {
		if (!capability.allowedTools.includes(tool))
			throw new Error(`Tool ${tool} is not allowed for role ${action.role}`);
	}
}

export function roleCanApproveCompletion(role: RuntimeRole): boolean {
	return COMPLETION_APPROVAL_ROLES.has(role);
}

export class GuardedRoleExecutor implements RoleExecutor {
	readonly #delegate: RoleExecutor;

	constructor(delegate: RoleExecutor) {
		this.#delegate = delegate;
	}

	async execute(input: RoleExecutionInput): Promise<RoleExecutionResult> {
		assertRoleLeaseAlignment(input.action, input.lease, input.contract);
		return this.#delegate.execute(input);
	}
}

export class RegistryRoleExecutor implements RoleExecutor {
	readonly #registry: Pick<ToolRegistry, "get">;
	readonly #buildInput: ((input: RoleExecutionInput) => unknown) | undefined;
	readonly #buildContext: ((input: RoleExecutionInput & { tool: ToolDescriptor }) => ToolExecutionContext) | undefined;

	constructor(options: RegistryRoleExecutorOptions) {
		this.#registry = options.registry;
		this.#buildInput = options.buildInput;
		this.#buildContext = options.buildContext;
	}

	async execute(input: RoleExecutionInput): Promise<RoleExecutionResult> {
		assertRoleLeaseAlignment(input.action, input.lease, input.contract);
		const [toolName] = input.lease.allowedTools;
		if (!toolName) return blocked(input.action.id, "Capability lease has no allowed tools");
		const tool = this.#registry.get(toolName);
		if (!tool) return blocked(input.action.id, `No registered tool descriptor for ${toolName}`);
		const mutationClass = classifyToolMutation(tool);
		if (mutationClassRequiresSandbox(mutationClass)) {
			if (!leaseGrantsSandbox(input.lease)) {
				return blocked(
					input.action.id,
					`${mutationClass} tool ${toolName} requires a sandbox lease (sandbox.mode is "${input.lease.sandbox.mode}")`,
				);
			}
			if (!input.sandboxWorkspace) {
				return blocked(input.action.id, `${mutationClass} tool ${toolName} requires an isolated sandbox workspace`);
			}
		}
		const context =
			this.#buildContext?.({ ...input, tool }) ??
			({
				cwd: input.sandboxWorkspace?.cwd,
				capabilityLease: input.lease,
				actionId: input.action.id,
				planStepId: input.action.stepId,
				mutationScope: input.lease.mutationScope.allowedPaths,
				agentRole: "orchestrator",
			} satisfies ToolExecutionContext);
		const result = await tool.execute(this.#buildInput?.(input) ?? defaultToolInput(input.action), context);
		if (!result.ok)
			return { actionId: input.action.id, status: "failed", evidenceRefs: [], error: result.error?.message };
		return {
			actionId: input.action.id,
			status: "succeeded",
			evidenceRefs: [`tool:${tool.name}:${input.action.id}`],
		};
	}
}

function blocked(actionId: string, error: string): RoleExecutionResult {
	return { actionId, status: "blocked", evidenceRefs: [], error };
}

function defaultToolInput(action: RuntimeAction): Record<string, unknown> {
	return {
		actionId: action.id,
		instruction: action.instruction,
		scope: action.scopeGuard,
		acceptanceCriteria: action.acceptanceCriteria.map(criterion => criterion.id),
	};
}
