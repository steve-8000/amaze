import type { FreshBootContract } from "../../harness/fresh-boot-contract.ts";
import type { PathContract } from "../../harness/path-contract.ts";

export const DEFAULT_SCOUT_ACTIVITY_BUDGET = {
	max_tool_uses: 80,
	max_tokens: 150_000,
	max_elapsed_ms: 300_000,
} as const;

function isScoutAgent(agentName: string): boolean {
	return agentName === "scout" || agentName.endsWith(".scout");
}

export function withDefaultScoutActivityBudget(
	agentName: string,
	pathContract: PathContract | undefined,
	bootContract: FreshBootContract | undefined,
): PathContract | undefined {
	if (pathContract || bootContract || !isScoutAgent(agentName)) return pathContract;
	return {
		contract_id: "default-scout-activity-budget",
		assigned_worker: agentName,
		activity_budget: { ...DEFAULT_SCOUT_ACTIVITY_BUDGET },
	};
}
