import type { ObjectiveContract } from "../autonomy/types";
import { verifySourceRefs } from "../research/source-verifier";
import type { AgiMemory, MemorySourceRef } from "./memory";

export interface ResearchLoopResult {
	satisfied: boolean;
	citations: MemorySourceRef[];
	blockers: string[];
}

export interface ResearchAgent {
	research(input: { missionId: string; contract: ObjectiveContract }): Promise<MemorySourceRef[]>;
}

export interface ResearchLoop {
	satisfyFreshnessPolicy(input: { missionId: string; contract: ObjectiveContract }): Promise<ResearchLoopResult>;
}

export class MemoryBackedResearchLoop implements ResearchLoop {
	readonly #memory: AgiMemory;
	readonly #now: () => number;
	readonly #researchAgent: ResearchAgent | undefined;

	constructor(input: { memory: AgiMemory; now?: () => number; researchAgent?: ResearchAgent }) {
		this.#memory = input.memory;
		this.#now = input.now ?? Date.now;
		this.#researchAgent = input.researchAgent;
	}

	async satisfyFreshnessPolicy(input: {
		missionId: string;
		contract: ObjectiveContract;
	}): Promise<ResearchLoopResult> {
		const policy = input.contract.freshnessPolicy;
		if (!policy?.researchRequired) return { satisfied: true, citations: [], blockers: [] };
		const items = await this.#memory.query({
			levels: ["L2", "L3", "L4", "L5"],
			scope: { missionId: input.missionId },
			claimLike: input.contract.objective,
			limit: 20,
		});
		const maxAgeMs =
			policy.maxSourceAgeDays === undefined ? undefined : policy.maxSourceAgeDays * 24 * 60 * 60 * 1000;
		const citations = verifySourceRefs(
			items.flatMap(item => item.sourceRefs),
			{ now: this.#now(), maxAgeMs },
		).valid;
		if (citations.length > 0) return { satisfied: true, citations, blockers: [] };
		const researched =
			(await this.#researchAgent?.research({ missionId: input.missionId, contract: input.contract })) ?? [];
		const researchedCitations = verifySourceRefs(researched, { now: this.#now(), maxAgeMs }).valid;
		return researchedCitations.length > 0
			? { satisfied: true, citations: researchedCitations, blockers: [] }
			: { satisfied: false, citations: [], blockers: ["fresh citation evidence required before mutation"] };
	}
}
