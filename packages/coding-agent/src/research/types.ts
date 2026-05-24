export const RESEARCH_LANES = ["repo", "source", "social", "memory"] as const;
export type ResearchLane = (typeof RESEARCH_LANES)[number];

export const EVIDENCE_GRADES = ["A", "B", "C", "D", "E"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface ResearchBrief {
	id: string;
	objectiveId: string | null;
	question: string;
	lanes: ResearchLane[];
	requiredEvidence: string[];
	disallowedEvidence: string[];
	riskLevel: RiskLevel;
	stopCriteria: string[];
	createdAt: number;
	updatedAt: number;
}

export type NewResearchBrief = Omit<ResearchBrief, "id" | "createdAt" | "updatedAt"> & {
	id?: string;
};

export interface EvidenceCard {
	id: string;
	briefId: string;
	lane: ResearchLane;
	grade: EvidenceGrade;
	sourceRef: string;
	excerpt: string;
	claims: string[];
	capturedAt: number;
	/** 0..1 — primary vs secondary */
	directness: number;
	/** 0..1 — concrete fact vs opinion */
	specificity: number;
	/** 0..1 — newer is higher */
	recency: number;
	/** 0..1 — can be reproduced by code/tests */
	reproducibility: number;
}

export type NewEvidenceCard = Omit<EvidenceCard, "id" | "capturedAt"> & {
	id?: string;
	capturedAt?: number;
};

export const DECISION_KINDS = ["select", "reject", "defer", "needs-more-research", "scope-reduction"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export interface DecisionRecord {
	id: string;
	briefId: string;
	hypothesis: string;
	rationale: string;
	kind: DecisionKind;
	confidence: ConfidenceLevel;
	evidenceRefs: string[];
	rejectedOptions: Array<{ id: string; reason: string }>;
	nextActions: string[];
	createdAt: number;
}

export type NewDecisionRecord = Omit<DecisionRecord, "id" | "createdAt" | "kind"> & {
	id?: string;
	kind?: DecisionKind;
};
export const CRITIQUE_VERDICTS = ["accept", "accept-with-modifications", "reject", "needs-more-research"] as const;
export type CritiqueVerdict = (typeof CRITIQUE_VERDICTS)[number];

export interface SynthesisRecord {
	id: string;
	briefId: string;
	hypothesisCount: number;
	recommended: string | null;
	summary: string;
	rawOutput: string;
	createdAt: number;
}

export type NewSynthesisRecord = Omit<SynthesisRecord, "id" | "createdAt"> & {
	id?: string;
	createdAt?: number;
};

export interface CritiqueRecord {
	id: string;
	briefId: string;
	blockingCount: number;
	softCount: number;
	verdict: CritiqueVerdict;
	summary: string;
	rawOutput: string;
	createdAt: number;
}

export type NewCritiqueRecord = Omit<CritiqueRecord, "id" | "createdAt"> & {
	id?: string;
	createdAt?: number;
};

export interface ComplementarityScore {
	briefId: string;
	total: number;
	laneCoverage: number;
	sourceQuality: number;
	contradictionPenalty: number;
	stalenessPenalty: number;
	socialOverweightPenalty: number;
	breakdown: Array<{ lane: ResearchLane; cardCount: number; avgGradeWeight: number }>;
}
