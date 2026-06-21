export interface RepeatedToolCallDecision {
	signature: string;
	toolName: string;
	repeatCount: number;
}

export interface RepeatedToolCallGuard {
	record(toolName: string | undefined, args: Record<string, unknown>, toolCount: number): RepeatedToolCallDecision | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeToolArgs(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => normalizeToolArgs(item));
	if (!isObject(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, normalizeToolArgs(value[key])]),
	);
}

export function toolCallSignature(toolName: string | undefined, args: Record<string, unknown>): string {
	try {
		return `${toolName ?? "tool"}:${JSON.stringify(normalizeToolArgs(args))}`;
	} catch {
		return `${toolName ?? "tool"}:${String(args)}`;
	}
}

export function createRepeatedToolCallGuard(limit: number): RepeatedToolCallGuard {
	const repeatedToolCalls = new Map<string, { count: number; toolName: string; firstToolCount: number }>();

	return {
		record(toolName: string | undefined, args: Record<string, unknown>, toolCount: number): RepeatedToolCallDecision | undefined {
			const signature = toolCallSignature(toolName, args);
			const repeated = repeatedToolCalls.get(signature) ?? {
				count: 0,
				toolName: toolName ?? "tool",
				firstToolCount: toolCount,
			};
			repeated.count++;
			repeatedToolCalls.set(signature, repeated);
			if (repeated.count < limit || toolCount <= repeated.firstToolCount) return undefined;
			return {
				signature,
				toolName: repeated.toolName,
				repeatCount: repeated.count,
			};
		},
	};
}
