import type { AgiEvalId, AgiEvalRunResult } from "./eval-suite";

export interface SelfImprovementSignal {
	metric: string;
	actual: number;
	expected: number;
	direction: "up" | "down";
}

export interface SelfImprovementProposal {
	id: string;
	status: "proposed" | "eval_passed" | "approved" | "applied" | "rejected";
	expectedMetricMovement: Array<{ metric: string; direction: "up" | "down"; targetDelta?: number }>;
	affectedRuntimeModules: string[];
	requiredEvalIds: AgiEvalId[];
	rollbackRefs: string[];
	riskTier: "low" | "medium" | "high" | "critical";
	verifierEvidenceRefs: string[];
}

export interface SelfImprovementEvalRunner {
	runSubset(evalIds: AgiEvalId[]): Promise<AgiEvalRunResult[]>;
}

export class SelfImprovementRuntime {
	readonly #evalRunner: SelfImprovementEvalRunner;

	constructor(input: { evalRunner: SelfImprovementEvalRunner }) {
		this.#evalRunner = input.evalRunner;
	}

	propose(input: {
		signal: SelfImprovementSignal;
		affectedRuntimeModules: string[];
		requiredEvalIds: AgiEvalId[];
		riskTier?: SelfImprovementProposal["riskTier"];
	}): SelfImprovementProposal {
		if (input.affectedRuntimeModules.length === 0)
			throw new Error("self-improvement proposal requires affected runtime modules");
		if (input.requiredEvalIds.length === 0) throw new Error("self-improvement proposal requires eval coverage");
		return {
			id: `self-improvement-${input.signal.metric}`,
			status: "proposed",
			expectedMetricMovement: [
				{
					metric: input.signal.metric,
					direction: input.signal.direction,
					targetDelta: Math.abs(input.signal.expected - input.signal.actual),
				},
			],
			affectedRuntimeModules: input.affectedRuntimeModules,
			requiredEvalIds: input.requiredEvalIds,
			rollbackRefs: [],
			riskTier: input.riskTier ?? "medium",
			verifierEvidenceRefs: [],
		};
	}

	async verifyWithEvals(proposal: SelfImprovementProposal): Promise<SelfImprovementProposal> {
		const results = await this.#evalRunner.runSubset(proposal.requiredEvalIds);
		const failed = results.filter(result => !result.passed);
		if (failed.length > 0)
			return { ...proposal, status: "rejected", verifierEvidenceRefs: failed.map(result => result.specId) };
		return { ...proposal, status: "eval_passed", verifierEvidenceRefs: results.map(result => result.specId) };
	}

	approve(
		proposal: SelfImprovementProposal,
		input: { approvedBy: string; rollbackRefs: string[] },
	): SelfImprovementProposal {
		if (proposal.status !== "eval_passed")
			throw new Error("self-improvement proposal requires passing evals before approval");
		if (input.rollbackRefs.length === 0) throw new Error("self-improvement approval requires rollback refs");
		if ((proposal.riskTier === "high" || proposal.riskTier === "critical") && input.approvedBy.length === 0) {
			throw new Error("high-risk self-improvement requires human approval");
		}
		return { ...proposal, status: "approved", rollbackRefs: input.rollbackRefs };
	}

	apply(proposal: SelfImprovementProposal): SelfImprovementProposal {
		if (proposal.status !== "approved") throw new Error("self-improvement proposal must be approved before apply");
		if (proposal.rollbackRefs.length === 0) throw new Error("self-improvement apply requires rollback refs");
		return { ...proposal, status: "applied" };
	}
}
