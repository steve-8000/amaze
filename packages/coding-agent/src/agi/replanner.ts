import type { ContractiblePlanStep, ObjectiveContract } from "../autonomy/types";
import type { Mission } from "../mission/core/mission";
import type { AgiRuntimeReplanner } from "./runtime";

export class DeterministicReplanner implements AgiRuntimeReplanner {
	replan(input: {
		mission: Mission;
		contract: ObjectiveContract;
		reason: string;
		evidenceRefs: string[];
	}): Promise<{ plan: { id: string; steps: ContractiblePlanStep[] }; summary: string }> {
		const safeReason = input.reason.trim() || "runtime settlement failed";
		return Promise.resolve({
			summary: `Generated recovery plan after: ${safeReason}`,
			plan: {
				id: stableId("replan", [input.mission.id, input.contract.id, safeReason, ...input.evidenceRefs]),
				steps: [
					{
						id: "recover-runtime-plan",
						kind: "replan",
						description: `Recover from runtime failure: ${safeReason}`,
						roleHint: "Planner",
						requiresWrite: false,
						acceptanceCriteria: input.contract.acceptanceCriteria.map(criterion => criterion.id),
						requiredEvidence: ["runtime_metric"],
					},
				],
			},
		});
	}
}

function stableId(prefix: string, parts: string[]): string {
	let hash = 0x811c9dc5;
	for (const part of parts.join("\0")) {
		hash ^= part.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${prefix}-${hash.toString(36)}`;
}
