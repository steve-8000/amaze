export interface PlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: "parallel" | "iterative";
	reentry?: boolean;
	goalId?: string;
}

export function parsePlanModeState(
	modeData: Record<string, unknown> | undefined,
	options?: { enabled?: boolean; reentry?: boolean },
): PlanModeState | undefined {
	const raw = modeData;
	if (!raw) return undefined;
	const planFilePath = raw.planFilePath;
	if (typeof planFilePath !== "string" || planFilePath.trim().length === 0) return undefined;

	const workflow = raw.workflow;
	if (workflow !== undefined && workflow !== "parallel" && workflow !== "iterative") return undefined;

	const goal = raw.goal;
	const goalId =
		goal && typeof goal === "object" && "id" in goal && typeof (goal as { id?: unknown }).id === "string"
			? (goal as { id: string }).id
			: undefined;

	return {
		enabled: options?.enabled ?? true,
		planFilePath,
		workflow,
		reentry: options?.reentry,
		goalId,
	};
}
