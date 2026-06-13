import type { AfterToolCallContext, AfterToolCallResult } from "@amaze/agent-core";

export function mergeAfterToolCallResult(
	base: AfterToolCallResult | undefined,
	override: AfterToolCallResult | undefined,
): AfterToolCallResult | undefined {
	if (!base) return override;
	if (!override) return base;
	return {
		content: override.content ?? base.content,
		details: override.details ?? base.details,
		isError: override.isError ?? base.isError,
	};
}

export function applyAfterToolCallOverride(
	ctx: AfterToolCallContext,
	override: AfterToolCallResult | undefined,
): AfterToolCallContext {
	if (!override) return ctx;
	return {
		...ctx,
		result: {
			...ctx.result,
			content: override.content ?? ctx.result.content,
			details: override.details ?? ctx.result.details,
			isError: override.isError ?? ctx.result.isError,
		},
		isError: override.isError ?? ctx.isError,
	};
}
