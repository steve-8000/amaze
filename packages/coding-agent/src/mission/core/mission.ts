import type { RiskLevel } from "../../research/types";
import type { MissionIntent } from "../policy/intent";
import type { AcceptanceCriterion } from "./acceptance-criteria";
import type { MissionBudget, MissionContextBudget } from "./mission-budget";
import type { MissionInput, MissionMode } from "./mission-input";
import type { MissionOutcome } from "./mission-outcome";
import type { MissionScopeGuard } from "./mission-scope";
import type { MissionTask, MissionTaskStatus } from "./mission-task";

/**
 * The full lifecycle a mission progresses through. Ordered roughly by the
 * canonical happy path, with several terminal/exception states.
 */
export const MISSION_LIFECYCLE_STATES = [
	"created",
	"classified",
	"planning",
	"researching",
	"critiquing",
	"contracting",
	"executing",
	"verifying",
	"completed",
	"blocked",
	"cancelled",
	"rolled_back",
] as const;

/**
 * Discriminated lifecycle state for a {@link Mission}.
 */
export type MissionLifecycleState = (typeof MISSION_LIFECYCLE_STATES)[number];

/**
 * A single planned step. Kept intentionally minimal at the core level; richer
 * planning structures live in higher layers.
 */
export interface MissionPlanStep {
	id: string;
	description: string;
	dependsOn?: string[];
}

/**
 * A mission plan: the ordered intent the runtime will execute.
 */
export interface MissionPlan {
	steps: MissionPlanStep[];
	rationale?: string;
	revision?: number;
}

/**
 * Re-exported from {@link ./mission-task}. The canonical task type now lives there
 * (workplan §10) as a superset of the original minimal record; this re-export keeps
 * existing `from "./mission"` / `mission/core` imports stable.
 */
export type { MissionTask, MissionTaskStatus };

/**
 * Verification outcome attached to a mission.
 */
export interface MissionVerification {
	status: "pass" | "fail" | "uncertain" | "force";
	verdict?: "pass" | "fail" | "pending";
	summary: string;
	failedCount?: number;
	uncertainCount?: number;
}

/**
 * Rollback record attached to a mission.
 */
export interface MissionRollback {
	targetType: "decision" | "proposal" | "file";
	targetId: string;
	snapshotRef?: string;
	summary: string;
}

/**
 * The canonical Mission aggregate for the refactored mission core. This is the
 * forward-looking shape; see {@link ../core/compat} for mappings to/from the
 * existing {@link ../types.Mission} record.
 */
export interface Mission {
	id: string;
	title: string;
	objective: string;
	mode: MissionMode;
	lifecycle: MissionLifecycleState;
	riskLevel: RiskLevel;
	intent?: MissionIntent;
	projectId?: string;
	sessionId?: string;
	parentMissionId?: string;
	constraints: string[];
	acceptanceCriteria: AcceptanceCriterion[];
	scopeGuard?: MissionScopeGuard;
	budget: MissionBudget;
	contextBudget: MissionContextBudget;
	contractRevision?: number;
	plan?: MissionPlan;
	tasks: MissionTask[];
	evidenceRefs: string[];
	decisionId?: string;
	regressionContractId?: string;
	proposalId?: string;
	verification?: MissionVerification;
	rollback?: MissionRollback;
	outcome?: MissionOutcome;
	createdAt: number;
	updatedAt: number;
}

export type { MissionInput, MissionMode };
