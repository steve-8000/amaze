import type { ConfidenceLevel, EvidenceGrade, ResearchLane } from "../research/types";
import type { EpistemicRole, MissionLaneStatus, MissionRollbackRecord, MissionVerificationRecord } from "./types";

export type ResearchBriefCreatedEvent = {
	type: "research.brief.created";
	missionId: string;
	briefId: string;
	objectiveId: string | null;
	lanes: ResearchLane[];
	ts: number;
};

export type ResearchLaneStartedEvent = {
	type: "research.lane.started";
	missionId: string;
	laneRunId: string;
	lane: ResearchLane;
	agent: string;
	epistemicRole: EpistemicRole;
	ts: number;
};

export type ResearchLaneCompletedEvent = {
	type: "research.lane.completed";
	missionId: string;
	laneRunId: string;
	lane: ResearchLane;
	status: MissionLaneStatus;
	evidenceCount: number;
	emptyReason: string | null;
	ts: number;
};

export type ResearchEvidenceAddedEvent = {
	type: "research.evidence.added";
	missionId: string;
	briefId: string;
	evidenceId: string;
	lane: ResearchLane;
	grade: EvidenceGrade;
	ts: number;
};

export type ResearchSynthesisProposedEvent = {
	type: "research.synthesis.proposed";
	missionId: string;
	briefId: string;
	hypothesisCount: number;
	recommended: string | null;
	ts: number;
};

export type ResearchCritiqueCompletedEvent = {
	type: "research.critique.completed";
	missionId: string;
	briefId: string;
	blockingCount: number;
	softCount: number;
	verdict: "accept" | "accept-with-modifications" | "reject" | "needs-more-research";
	ts: number;
};

export type RuntimeCriticChecksCompletedEvent = {
	type: "runtime_critic.checks.completed";
	missionId: string;
	briefId: string;
	blockingCount: number;
	softCount: number;
	ts: number;
};

export type RuntimeCriticDialogueCompletedEvent = {
	type: "runtime_critic.dialogue.completed";
	missionId: string;
	turnIds: string[];
	blockingCheckIds: string[];
	ts: number;
};

export type DecisionRecordedEvent = {
	type: "decision.recorded";
	missionId: string;
	briefId: string;
	decisionId: string;
	confidence: ConfidenceLevel;
	ts: number;
};

export type ContractCreatedEvent = {
	type: "contract.created";
	missionId: string;
	contractId: string;
	role: string;
	ts: number;
};

export type VerificationCompletedEvent = {
	type: "verification.completed";
	missionId: string;
	verificationId: string;
	status: MissionVerificationRecord["status"];
	failedCount: number;
	uncertainCount: number;
	ts: number;
};

export type RollbackSnapshotCreatedEvent = {
	type: "rollback.snapshot.created";
	missionId: string;
	rollbackId: string;
	targetType: MissionRollbackRecord["targetType"];
	targetId: string;
	snapshotRef: string | null;
	ts: number;
};

export type MissionEvent =
	| ResearchBriefCreatedEvent
	| ResearchLaneStartedEvent
	| ResearchLaneCompletedEvent
	| ResearchEvidenceAddedEvent
	| ResearchSynthesisProposedEvent
	| ResearchCritiqueCompletedEvent
	| RuntimeCriticChecksCompletedEvent
	| RuntimeCriticDialogueCompletedEvent
	| DecisionRecordedEvent
	| ContractCreatedEvent
	| VerificationCompletedEvent
	| RollbackSnapshotCreatedEvent;
