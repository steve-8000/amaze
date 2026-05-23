export type ProposalGate = "auto" | "review" | "human-required";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "rolled-back" | "expired";

export interface ProposalEvidence {
	sessionIds: string[];
	eventRefs: string[];
	ruleFindings?: string[];
	sampleN: number;
}

export interface ProposalProvenance {
	source: "rule" | "reflection" | "manual";
	ruleId?: string;
}

export interface ProposalBase {
	id: string;
	createdAt: number;
	status: ProposalStatus;
	gate: ProposalGate;
	evidence: ProposalEvidence;
	provenance: ProposalProvenance;
	expiresAt?: number;
}

export type MemoryLearningProposal = ProposalBase & {
	type: "memory";
	content: string;
	memoryType: string;
	confidence: "tool_verified" | "inferred" | "hypothesis";
};

export type SkillLearningProposal = ProposalBase & {
	type: "skill";
	name: string;
	sourceMemoryIds: string[];
	bodyMarkdown: string;
	evalCommand?: string;
};

export type RuleLearningProposal = ProposalBase & {
	type: "rule";
	ruleMarkdown: string;
	replaySessions: string[];
	expectedImpact: string;
};

export type SettingsLearningProposal = ProposalBase & {
	type: "settings";
	patch: Record<string, unknown>;
	reason: string;
	rollback: Record<string, unknown>;
};

export type LearningProposal =
	| MemoryLearningProposal
	| SkillLearningProposal
	| RuleLearningProposal
	| SettingsLearningProposal;

export type LearningProposalType = LearningProposal["type"];
