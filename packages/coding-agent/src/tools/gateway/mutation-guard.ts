/**
 * Lane C1 — ToolGateway Skeleton.
 *
 * Minimal mutation-scope policy stub. For workspace-mutating tools the gateway
 * asks the guard whether the call is within the caller's declared mutation
 * scope. The default guard is permissive when no scope is declared and is the
 * hook Lane H/I will tighten (e.g. subagent scope enforcement).
 */
import type { ToolDescriptor, ToolExecutionContext } from "../registry/tool-descriptor";

export interface MutationDecision {
	allowed: boolean;
	reason?: string;
}

export interface MutationScopeGuard {
	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext): MutationDecision;
}

export class DefaultMutationScopeGuard implements MutationScopeGuard {
	check(descriptor: ToolDescriptor<any, any>, ctx: ToolExecutionContext): MutationDecision {
		// Non-mutating tools are never scope-restricted.
		if (!descriptor.mutatesWorkspace) {
			return { allowed: true };
		}
		// No declared scope ⇒ no restriction to enforce (skeleton behavior).
		if (!ctx.mutationScope) {
			return { allowed: true };
		}
		// An explicitly empty scope means "no mutation allowed".
		if (ctx.mutationScope.length === 0) {
			return {
				allowed: false,
				reason: `tool "${descriptor.name}" mutates the workspace but the mutation scope is empty`,
			};
		}
		return { allowed: true };
	}
}

/** A guard that allows everything. */
export class AllowAllMutationScopeGuard implements MutationScopeGuard {
	check(): MutationDecision {
		return { allowed: true };
	}
}
