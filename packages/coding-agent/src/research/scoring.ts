import type { ComplementarityScore, EvidenceCard, ResearchBrief } from "./types";

const GRADE_WEIGHT: Record<string, number> = { A: 1.0, B: 0.75, C: 0.5, D: 0.25, E: 0.1 };
const SOCIAL_OVERWEIGHT_THRESHOLD = 0.5;

export function scoreComplementarity(brief: ResearchBrief, evidence: EvidenceCard[]): ComplementarityScore {
	const breakdown = brief.lanes.map(lane => {
		const cards = evidence.filter(card => card.lane === lane);
		return {
			lane,
			cardCount: cards.length,
			avgGradeWeight: cards.length ? mean(cards.map(card => gradeWeight(card))) : 0,
		};
	});
	const laneCoverage = brief.lanes.length
		? breakdown.filter(item => item.cardCount > 0).length / brief.lanes.length
		: 0;
	const sourceQuality = evidence.length
		? mean(
				evidence.map(
					card =>
						0.4 * gradeWeight(card) +
						0.2 * card.directness +
						0.2 * card.specificity +
						0.1 * card.recency +
						0.1 * card.reproducibility,
				),
			)
		: 0;
	// First cut: contradiction detection requires claim-level comparison by a future reviewer pass.
	const contradictionPenalty = 0;
	const stalenessPenalty = evidence.length ? mean(evidence.map(card => Math.max(0, 1 - card.recency) * 0.25)) : 0;
	const socialShare = evidence.length ? evidence.filter(card => card.lane === "social").length / evidence.length : 0;
	const socialOverweightPenalty =
		socialShare > SOCIAL_OVERWEIGHT_THRESHOLD ? 0.3 * (socialShare - SOCIAL_OVERWEIGHT_THRESHOLD) : 0;
	const total = clamp01(
		laneCoverage * 0.4 + sourceQuality * 0.6 - contradictionPenalty - stalenessPenalty - socialOverweightPenalty,
	);

	return {
		briefId: brief.id,
		total,
		laneCoverage,
		sourceQuality,
		contradictionPenalty,
		stalenessPenalty,
		socialOverweightPenalty,
		breakdown,
	};
}

function gradeWeight(card: EvidenceCard): number {
	return GRADE_WEIGHT[card.grade] ?? 0;
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
