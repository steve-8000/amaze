import type { ObjectiveContract } from "../autonomy/types";
import type { AgiMemory, MemorySourceRef } from "./memory";
import type { ResearchAgent } from "./research-loop";

export interface AutomaticResearchProvider {
	search(input: {
		query: string;
		maxAgeDays?: number;
	}): Promise<Array<{ uri: string; contentHash: string; observedAt: number }>>;
}

/**
 * Deterministic research-agent adapter for the AGI runtime. It turns an ObjectiveContract's
 * freshness policy into provider searches, records the sourced findings in memory, and returns
 * only citations with durable provenance fields. The provider can be web, OKF, or a test double;
 * this class owns the runtime contract, not network policy.
 */
export class AutomaticResearchAgent implements ResearchAgent {
	readonly #provider: AutomaticResearchProvider;
	readonly #memory?: AgiMemory;

	constructor(input: { provider: AutomaticResearchProvider; memory?: AgiMemory }) {
		this.#provider = input.provider;
		this.#memory = input.memory;
	}

	async research(input: { missionId: string; contract: ObjectiveContract }): Promise<MemorySourceRef[]> {
		const hits = await this.#provider.search({
			query: input.contract.objective,
			maxAgeDays: input.contract.freshnessPolicy?.maxSourceAgeDays,
		});
		const citations: MemorySourceRef[] = hits
			.filter(hit => hit.uri.trim() !== "" && hit.contentHash.trim() !== "")
			.map(hit => ({ kind: "provider", uri: hit.uri, contentHash: hit.contentHash, observedAt: hit.observedAt }));
		if (citations.length > 0) {
			await this.#memory?.record({
				level: "L4",
				scope: { missionId: input.missionId },
				kind: "claim",
				content: `Fresh research for objective: ${input.contract.objective}`,
				sourceRefs: citations,
				confidence: "high",
				verified: true,
			});
		}
		return citations;
	}
}
