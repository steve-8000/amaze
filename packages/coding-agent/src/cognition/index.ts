/**
 * Cognition plane — integration facade.
 *
 * Composes the three cognition modules over the existing mission substrate:
 *
 * 1. {@link planMission} — decompose a mission objective into a validated plan
 *    DAG, persist it (`mission_plans` / `mission_plan_steps`), and record the
 *    decomposition in the world model. Planning context automatically includes
 *    learned heuristics (L5) and world-model claims.
 * 2. {@link replanMission} — same path with critic feedback and the prior plan;
 *    revision increments and the rejection trail stays queryable.
 * 3. {@link learnFromMissionOutcome} — derive heuristics from a finished
 *    mission's checkpoints and record them into the KnowledgeStore + world model.
 *
 * The LLM stays an injectable seam; everything else is deterministic and
 * test-covered without a model.
 */

import type { MissionPlan } from "../mission/core/mission";
import type { MissionStore } from "../mission/store";
import {
	heuristicsForPlanning,
	type LearnResult,
	learnFromMission,
	type MissionOutcomeSnapshot,
	recordEpisode,
	type ToolFailureTally,
} from "./learner";
import { type DecomposeOptions, decomposeGoal, type PlannerLlm, type PlanningContext } from "./planner";
import type { RuntimeKnowledgeHandle } from "./runtime-knowledge";
import { recordLearnedOutcome, recordPlanAction, worldModelForPlanning } from "./world-model";

export type {
	DerivedHeuristic,
	EpisodeRecord,
	LearnerMemory,
	LearnerMemoryItem,
	MissionOutcomeSnapshot,
	ToolFailureTally,
} from "./learner";
export {
	deriveEpisode,
	deriveHeuristics,
	episodesForObjective,
	heuristicsForPlanning,
	learnFromMission,
	recordEpisode,
} from "./learner";
export { createRegistryPlannerLlm } from "./llm";
export type { PlannerLlm, PlanningContext } from "./planner";
export { buildPlannerPrompt, decomposeGoal, PLANNER_SYSTEM_PROMPT, parsePlannerOutput } from "./planner";
export { openRuntimeKnowledge, type RuntimeKnowledgeHandle } from "./runtime-knowledge";
export { recordLearnedOutcome, recordPlanAction, worldModelForPlanning } from "./world-model";

export interface CognitionDeps {
	missions: MissionStore;
	knowledge: RuntimeKnowledgeHandle["knowledge"];
	llm: PlannerLlm;
}

export interface PlanMissionInput {
	missionId: string;
	objective: string;
	constraints?: string[];
	decompose?: DecomposeOptions;
}

export interface PlanMissionResult {
	plan: MissionPlan;
	attempts: number;
	injectedHeuristics: number;
	injectedWorldModel: number;
}

/**
 * Decompose and persist a plan for a mission. The stored plan is what
 * `MissionRuntimeImpl.plan` seeds tasks from — after this call, goal
 * decomposition is no longer a prompt convention but a recorded artifact.
 */
export async function planMission(deps: CognitionDeps, input: PlanMissionInput): Promise<PlanMissionResult> {
	const heuristics = heuristicsForPlanning(deps.knowledge);
	const worldModel = worldModelForPlanning(deps.missions, input.missionId);
	const priorPlan = deps.missions.getPlan(input.missionId);
	const ctx: PlanningContext = {
		objective: input.objective,
		...(input.constraints?.length ? { constraints: input.constraints } : {}),
		...(heuristics.length ? { heuristics } : {}),
		...(worldModel.length ? { worldModel } : {}),
		...(priorPlan ? { priorPlan } : {}),
	};
	const { plan, attempts } = await decomposeGoal(ctx, deps.llm, input.decompose);
	deps.missions.savePlan(input.missionId, plan);
	recordPlanAction(deps.missions, input.missionId, {
		revision: plan.revision ?? 1,
		stepCount: plan.steps.length,
		...(plan.rationale ? { rationale: plan.rationale } : {}),
	});
	return {
		plan,
		attempts,
		injectedHeuristics: heuristics.length,
		injectedWorldModel: worldModel.length,
	};
}

export interface ReplanMissionInput extends PlanMissionInput {
	/** Critic findings the revised plan must address. Non-empty. */
	criticFeedback: string[];
}

/** Replan after critic rejection: prior plan + findings drive a new revision. */
export async function replanMission(deps: CognitionDeps, input: ReplanMissionInput): Promise<PlanMissionResult> {
	if (input.criticFeedback.length === 0) {
		throw new Error("replanMission requires non-empty criticFeedback; use planMission for initial planning");
	}
	const priorPlan = deps.missions.getPlan(input.missionId);
	if (!priorPlan) {
		throw new Error(`replanMission: no prior plan recorded for mission ${input.missionId}`);
	}
	const heuristics = heuristicsForPlanning(deps.knowledge);
	const worldModel = worldModelForPlanning(deps.missions, input.missionId);
	const ctx: PlanningContext = {
		objective: input.objective,
		criticFeedback: input.criticFeedback,
		priorPlan,
		...(input.constraints?.length ? { constraints: input.constraints } : {}),
		...(heuristics.length ? { heuristics } : {}),
		...(worldModel.length ? { worldModel } : {}),
	};
	const { plan, attempts } = await decomposeGoal(ctx, deps.llm, input.decompose);
	deps.missions.savePlan(input.missionId, plan);
	recordPlanAction(deps.missions, input.missionId, {
		revision: plan.revision ?? (priorPlan.revision ?? 0) + 1,
		stepCount: plan.steps.length,
		...(plan.rationale ? { rationale: plan.rationale } : {}),
	});
	return {
		plan,
		attempts,
		injectedHeuristics: heuristics.length,
		injectedWorldModel: worldModel.length,
	};
}

/**
 * Learn from a finished mission: derive heuristics from its checkpoints,
 * persist them at global scope (L5), mirror each into the mission's world
 * model so the causal trail survives, AND record a single durable episode at
 * mission scope (L3) capturing what happened. Episode recording is best-effort
 * and idempotent — it never affects the heuristic LearnResult.
 */
export function learnFromMissionOutcome(
	deps: Pick<CognitionDeps, "missions" | "knowledge">,
	snapshot: MissionOutcomeSnapshot,
): LearnResult {
	const result = learnFromMission(snapshot, deps.knowledge);
	for (const item of result.recorded) {
		recordLearnedOutcome(deps.missions, snapshot.missionId, {
			claim: item.claim,
			knowledgeItemId: item.id,
			outcomeStatus: snapshot.status === "success" ? "pass" : snapshot.status === "failure" ? "fail" : "uncertain",
		});
	}
	// L3 episodic memory: a concrete what-happened record for this mission, kept at
	// mission scope so it never pollutes the global heuristic planning context.
	// Best-effort: episode recording must never fail the heuristic LearnResult (e.g.
	// if a knowledge backend rejects the mission scope), so swallow any error.
	try {
		recordEpisode(snapshot, deps.knowledge);
	} catch {
		// Episodic recording is supplementary; never break the heuristic path.
	}
	return result;
}

/**
 * Build a learner snapshot from a terminal mission's durable records and learn
 * from it. This is the production entry the session layer calls on mission
 * terminalization — it reads checkpoints and verification straight from the
 * store so the learner never depends on in-memory session state.
 *
 * Returns undefined when the mission has no outcome recorded (nothing to learn
 * from yet) — callers treat that as a no-op, not an error.
 */
export function learnFromTerminalMission(
	deps: Pick<CognitionDeps, "missions" | "knowledge">,
	mission: {
		id: string;
		objective: string;
		outcome?: { status: string } | undefined;
		verification?: { verdict?: "pass" | "fail" | "pending" } | undefined;
	},
): LearnResult | undefined {
	if (!mission.outcome) return undefined;
	const status = normalizeOutcomeStatus(mission.outcome.status);
	const { toolFailures, runtimeErrorCount } = harvestRuntimeFailures(deps.missions, mission.id);
	const snapshot: MissionOutcomeSnapshot = {
		missionId: mission.id,
		objective: mission.objective,
		status,
		checkpoints: deps.missions.listTaskAttemptCheckpoints(mission.id),
		...(mission.verification?.verdict ? { verificationVerdict: mission.verification.verdict } : {}),
		...(toolFailures.length > 0 ? { toolFailures } : {}),
		...(runtimeErrorCount > 0 ? { runtimeErrorCount } : {}),
	};
	return learnFromMissionOutcome(deps, snapshot);
}

/** Map MissionOutcomeStatus onto the learner's status union. */
function normalizeOutcomeStatus(status: string): MissionOutcomeSnapshot["status"] {
	switch (status) {
		case "success":
			return "success";
		case "partial":
			return "partial";
		case "cancelled":
			return "cancelled";
		case "blocked":
			return "blocked";
		default:
			// "failed", "rolled_back", and anything unknown count as failure evidence.
			return "failure";
	}
}

/**
 * Harvest tool/runtime failures for a mission from the durable runtime-event log
 * (Step-3 `tool_action.*` events plus runtime-action error/blocked events). Pure
 * read; returns empty tallies when no failures were recorded.
 *
 * Tool failures: `tool_action.completed` events whose payload.status is "error".
 * Runtime errors: any runtime event whose type ends in ".blocked" / ".failed" or
 * ".evidence_insufficient" — the recurring runtime hazards worth learning from.
 */
function harvestRuntimeFailures(
	missions: Pick<MissionStore, "listRuntimeEvents">,
	missionId: string,
): { toolFailures: ToolFailureTally[]; runtimeErrorCount: number } {
	const events = missions.listRuntimeEvents(missionId);
	const byTool = new Map<string, number>();
	let runtimeErrorCount = 0;
	for (const event of events) {
		if (event.type === "tool_action.completed" && (event.payload as { status?: unknown }).status === "error") {
			const tool = String((event.payload as { tool?: unknown }).tool ?? "unknown");
			byTool.set(tool, (byTool.get(tool) ?? 0) + 1);
			continue;
		}
		// Runtime hazards actually persisted to runtime_events: governance/research
		// blocks and insufficient-evidence verdicts. (Failed missions/tasks flow through
		// the in-memory MissionEventBus, not this durable ledger, so there is no `.failed`
		// type here; tool errors are already counted above as tool failures.)
		if (/\.(blocked|evidence_insufficient)$/.test(event.type)) {
			runtimeErrorCount += 1;
		}
	}
	const toolFailures: ToolFailureTally[] = [...byTool.entries()]
		.map(([tool, count]) => ({ tool, count }))
		.sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
	return { toolFailures, runtimeErrorCount };
}
