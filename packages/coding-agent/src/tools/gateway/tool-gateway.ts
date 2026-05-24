/**
 * Lane C1 — ToolGateway Skeleton (workplan §9).
 *
 * The ToolGateway runs a tool call through a fixed policy pipeline:
 *
 *   PolicyGate → PermissionGate → MutationScopeGuard → TimeoutPolicy → execute
 *
 * It is additive and OPT-IN: no existing tool call path is routed through it
 * yet. Lifecycle hooks are left as optional callbacks (no event emission). On
 * any policy denial it short-circuits with a failed {@link ToolResult} rather
 * than throwing.
 */
import type { ToolDescriptor, ToolExecutionContext, ToolResult, ToolRiskLevel } from "../registry/tool-descriptor";
import type { ToolRegistry } from "../registry/tool-registry";
import { DefaultMutationScopeGuard, type MutationScopeGuard } from "./mutation-guard";
import { DefaultPermissionGate, type PermissionGate } from "./permission-gate";
import { classifyRisk } from "./risk-classifier";
import { DefaultTimeoutPolicy, type TimeoutPolicy } from "./timeout-policy";

export interface PolicyDecision {
	allowed: boolean;
	reason?: string;
}

/**
 * Optional first-stage gate (e.g. MissionPolicyEngine in Wave 3). Defaults to
 * allow-all in the skeleton.
 */
export interface PolicyGate {
	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext, riskLevel: ToolRiskLevel): PolicyDecision;
}

class AllowAllPolicyGate implements PolicyGate {
	check(): PolicyDecision {
		return { allowed: true };
	}
}

/** Stage at which a call was denied, for diagnostics. */
export type DenyStage = "policy" | "permission" | "mutation";

export interface GatewayHooks {
	onClassified?(descriptor: ToolDescriptor<any, any>, riskLevel: ToolRiskLevel, ctx: ToolExecutionContext): void;
	onDenied?(descriptor: ToolDescriptor<any, any>, stage: DenyStage, reason: string, ctx: ToolExecutionContext): void;
	onBeforeExecute?(descriptor: ToolDescriptor<any, any>, timeoutMs: number, ctx: ToolExecutionContext): void;
	onResult?(descriptor: ToolDescriptor<any, any>, result: ToolResult<any>, ctx: ToolExecutionContext): void;
}

export interface ToolGatewayOptions {
	policyGate?: PolicyGate;
	permissionGate?: PermissionGate;
	mutationGuard?: MutationScopeGuard;
	timeoutPolicy?: TimeoutPolicy;
	hooks?: GatewayHooks;
}

function deniedResult(reason: string, riskLevel: ToolRiskLevel): ToolResult<never> {
	return {
		ok: false,
		output: undefined as never,
		error: new Error(reason),
		riskLevel,
	};
}

export class ToolGateway {
	#registry: ToolRegistry;
	#policyGate: PolicyGate;
	#permissionGate: PermissionGate;
	#mutationGuard: MutationScopeGuard;
	#timeoutPolicy: TimeoutPolicy;
	#hooks: GatewayHooks;

	constructor(registry: ToolRegistry, options: ToolGatewayOptions = {}) {
		this.#registry = registry;
		this.#policyGate = options.policyGate ?? new AllowAllPolicyGate();
		this.#permissionGate = options.permissionGate ?? new DefaultPermissionGate();
		this.#mutationGuard = options.mutationGuard ?? new DefaultMutationScopeGuard();
		this.#timeoutPolicy = options.timeoutPolicy ?? new DefaultTimeoutPolicy();
		this.#hooks = options.hooks ?? {};
	}

	get registry(): ToolRegistry {
		return this.#registry;
	}

	/**
	 * Run a registered tool by name through the policy pipeline.
	 * Returns a failed ToolResult (never throws) on lookup miss or policy deny.
	 */
	async run<TInput = unknown, TOutput = unknown>(
		name: string,
		input: TInput,
		ctx: ToolExecutionContext = {},
	): Promise<ToolResult<TOutput>> {
		const descriptor = this.#registry.get<TInput, TOutput>(name);
		if (!descriptor) {
			return {
				ok: false,
				output: undefined as never,
				error: new Error(`ToolGateway.run: no tool registered under "${name}"`),
			};
		}

		const riskLevel = classifyRisk(descriptor);
		this.#hooks.onClassified?.(descriptor, riskLevel, ctx);

		// 1. PolicyGate
		const policy = this.#policyGate.check(descriptor, ctx, riskLevel);
		if (!policy.allowed) {
			const reason = policy.reason ?? `policy denied tool "${name}"`;
			this.#hooks.onDenied?.(descriptor, "policy", reason, ctx);
			return deniedResult(reason, riskLevel);
		}

		// 2. PermissionGate
		const permission = this.#permissionGate.check(descriptor, ctx, riskLevel);
		if (!permission.allowed) {
			const reason = permission.reason ?? `permission denied for tool "${name}"`;
			this.#hooks.onDenied?.(descriptor, "permission", reason, ctx);
			return deniedResult(reason, riskLevel);
		}

		// 3. MutationScopeGuard
		const mutation = this.#mutationGuard.check(descriptor, ctx);
		if (!mutation.allowed) {
			const reason = mutation.reason ?? `mutation scope denied for tool "${name}"`;
			this.#hooks.onDenied?.(descriptor, "mutation", reason, ctx);
			return deniedResult(reason, riskLevel);
		}

		// 4. TimeoutPolicy
		const timeoutMs = this.#timeoutPolicy.resolve(descriptor, riskLevel);
		this.#hooks.onBeforeExecute?.(descriptor, timeoutMs, ctx);

		// 5. Execute
		let result: ToolResult<TOutput>;
		try {
			result = await descriptor.execute(input, ctx);
		} catch (err) {
			result = {
				ok: false,
				output: undefined as never,
				error: err instanceof Error ? err : new Error(String(err)),
			};
		}

		// Annotate with policy metadata (without clobbering explicit values).
		result.riskLevel ??= riskLevel;
		result.timeoutMs ??= timeoutMs;

		this.#hooks.onResult?.(descriptor, result, ctx);
		return result;
	}
}
