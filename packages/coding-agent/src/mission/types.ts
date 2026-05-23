import type { ConfidenceLevel, ResearchLane, RiskLevel } from "../research/types";

export const MISSION_STATES = [
	"drafting",
	"researching",
	"synthesizing",
	"critiquing",
	"deciding",
	"contracted",
	"executing",
	"verifying",
	"completed",
	"rolled_back",
	"blocked",
	"cancelled",
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const EPISTEMIC_ROLES = [
	"repo_truth",
	"source_harvest",
	"social_signal",
	"memory_prior",
	"synthesis",
	"critic",
] as const;
export type EpistemicRole = (typeof EPISTEMIC_ROLES)[number];

export const MISSION_LANE_STATUSES = ["pending", "running", "completed", "empty", "failed", "aborted"] as const;
export type MissionLaneStatus = (typeof MISSION_LANE_STATUSES)[number];

export interface Mission {
	id: string;
	title: string;
	objectiveId: string | null;
	briefId: string | null;
	decisionId: string | null;
	riskLevel: RiskLevel;
	state: MissionState;
	confidence: ConfidenceLevel | null;
	snapshotRef: string | null;
	createdAt: number;
	updatedAt: number;
}

export type NewMission = Omit<Mission, "id" | "createdAt" | "updatedAt"> & {
	id?: string;
};

export interface MissionLaneRun {
	id: string;
	missionId: string;
	lane: ResearchLane;
	agent: string;
	epistemicRole: EpistemicRole;
	status: MissionLaneStatus;
	evidenceCount: number;
	emptyReason: string | null;
	taskId: string | null;
	startedAt: number | null;
	endedAt: number | null;
}

export type NewMissionLaneRun = Omit<MissionLaneRun, "id"> & {
	id?: string;
};
export interface MissionContractRecord {
	id: string;
	missionId: string;
	role: string;
	parentContractRevision: number | null;
	include: string[];
	exclude: string[];
	successCriteria: string[];
	escalation: { onUncertainty: "ask-parent" | "block"; budgetCap: number };
	inputArtifact: string | null;
	mustProduce: string[];
	createdAt: number;
}

export type NewMissionContractRecord = Omit<MissionContractRecord, "id" | "createdAt"> & {
	id?: string;
	createdAt?: number;
};

export interface MissionVerificationRecord {
	id: string;
	missionId: string;
	status: "pass" | "fail" | "uncertain" | "force";
	failedCount: number;
	uncertainCount: number;
	summary: string;
	createdAt: number;
}

export type NewMissionVerificationRecord = Omit<MissionVerificationRecord, "id" | "createdAt"> & {
	id?: string;
	createdAt?: number;
};

export interface MissionRollbackRecord {
	id: string;
	missionId: string;
	targetType: "decision" | "proposal" | "file";
	targetId: string;
	snapshotRef: string | null;
	summary: string;
	createdAt: number;
}

export type NewMissionRollbackRecord = Omit<MissionRollbackRecord, "id" | "createdAt"> & {
	id?: string;
	createdAt?: number;
};
