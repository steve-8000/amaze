import type { ContractiblePlanStep, ObjectiveContract, RuntimeRole } from "../autonomy/types";
import type { Mission } from "../mission/core/mission";
import type { MissionTask } from "../mission/core/mission-task";
import type { AgiRuntimeProfile } from "./store";
import { expandSubAgentRoles, type SubAgentExpansion } from "./subagent-policy";
import {
	type SubAgentResult,
	type SynthesizedDecision,
	synthesizeSubAgentResults,
} from "./subagent-result-synthesizer";

/**
 * Files each role MUST produce for its output to count. This is the structural half of the
 * subagent contract (the behavioral half is the synthesizer's verdict gating): a role that
 * runs but does not leave its mandated artifact is treated as incomplete, never as progress.
 */
export const ROLE_OUTPUT_ARTIFACTS: Record<RuntimeRole, string[]> = {
	Planner: ["plan_steps.json"],
	Researcher: ["research_evidence.json"],
	Builder: ["changed_files.json"],
	Reviewer: ["review_findings.json"],
	Verifier: ["verification_result.json"],
	Critic: ["failure_modes.json"],
	Security: ["security_risk_report.json"],
	SRE: ["operational_risk_report.json"],
	MemoryCurator: ["memory_updates.json"],
};

/**
 * AGI runtime profiles whose runtime actions can mutate the workspace. The read-only
 * `strict-observe` profile (and its legacy `strict-supervised` alias) has nothing to
 * mutate; everything else can write.
 */
const MUTATING_PROFILES: ReadonlySet<AgiRuntimeProfile> = new Set<AgiRuntimeProfile>([
	"strict-mutation",
	"strict-self-improve",
]);

/**
 * Single source of truth for "must this runtime profile clear the mandatory subagent
 * gate before any action executes?" The answer is YES for every profile that can mutate
 * the workspace — subagents are the default execution path for mutating work, not an
 * add-on. A read-only profile has no plan to gate and returns false.
 *
 * Centralised so the CLI runtime, the end-to-end mutation harness, and tests cannot
 * drift to different policies.
 */
export function shouldEnforceSubagentGate(profile: AgiRuntimeProfile): boolean {
	return MUTATING_PROFILES.has(profile);
}

/** The observable outcome of running one role as a subagent. */
export interface RoleRunOutcome {
	status: "completed" | "failed" | "blocked";
	evidenceRefs: string[];
	/** Artifact keys the role actually produced (matched against {@link ROLE_OUTPUT_ARTIFACTS}). */
	artifacts: string[];
	changedFiles?: string[];
	verdict?: "pass" | "fail";
	note?: string;
}

/** Runs a single role's subagent task. Injected so the runtime path and tests share one seam. */
export type RoleRunner = (input: { role: RuntimeRole; task: MissionTask }) => Promise<RoleRunOutcome>;

export interface SubAgentOrchestratorOptions {
	missionId: string;
	objectiveContractId: string;
	planId: string;
	runRole: RoleRunner;
}

export interface OrchestrationResult {
	decision: SynthesizedDecision;
	results: SubAgentResult[];
}

function missingArtifacts(role: RuntimeRole, produced: string[]): string[] {
	const required = ROLE_OUTPUT_ARTIFACTS[role] ?? [];
	const have = new Set(produced);
	return required.filter(artifact => !have.has(artifact));
}

/**
 * Runs the mandated subagent roles for a mission and closes them into a single decision.
 *
 * Each role is dispatched through {@link RoleRunner} as a bound {@link MissionTask}. A role
 * that fails to produce its mandated artifact (see {@link ROLE_OUTPUT_ARTIFACTS}) is demoted to
 * `blocked` before synthesis — so "the Builder ran but left no diff" cannot be laundered into
 * progress. The collected per-role results are then handed to {@link synthesizeSubAgentResults},
 * which guarantees a terminal `accept` / `blocked` / `needs_revision` outcome.
 */
export class SubAgentOrchestrator {
	readonly #opts: SubAgentOrchestratorOptions;

	constructor(options: SubAgentOrchestratorOptions) {
		this.#opts = options;
	}

	async run(expansion: SubAgentExpansion): Promise<OrchestrationResult> {
		const results = await Promise.all(
			expansion.roles.map(async role => {
				const task = this.#taskForRole(role, expansion.rationale[role]);
				const outcome = await this.#opts.runRole({ role, task });
				return this.#toResult(role, task.id, outcome);
			}),
		);
		return { decision: synthesizeSubAgentResults(results), results };
	}

	#taskForRole(role: RuntimeRole, rationale: string | undefined): MissionTask {
		const now = Date.now();
		return {
			id: `${this.#opts.missionId}:role:${role}`,
			missionId: this.#opts.missionId,
			title: `${role} subagent`,
			objective: rationale ?? `Execute the ${role} responsibilities for this mission.`,
			assignedAgent: role,
			status: "pending",
			planStepId: this.#opts.planId,
			successCriteria: ROLE_OUTPUT_ARTIFACTS[role]?.map(artifact => `produce ${artifact}`),
			createdAt: now,
			updatedAt: now,
		};
	}

	#toResult(role: RuntimeRole, taskId: string, outcome: RoleRunOutcome): SubAgentResult {
		const missing = missingArtifacts(role, outcome.artifacts);
		if (outcome.status === "completed" && missing.length > 0) {
			return {
				taskId,
				role,
				status: "blocked",
				evidenceRefs: outcome.evidenceRefs,
				...(outcome.changedFiles ? { changedFiles: outcome.changedFiles } : {}),
				note: `Missing mandated artifact(s): ${missing.join(", ")}.`,
			};
		}
		return {
			taskId,
			role,
			status: outcome.status,
			evidenceRefs: outcome.evidenceRefs,
			...(outcome.changedFiles ? { changedFiles: outcome.changedFiles } : {}),
			...(outcome.verdict ? { verdict: outcome.verdict } : {}),
			...(outcome.note ? { note: outcome.note } : {}),
		};
	}
}

/**
 * Production {@link AgiRuntimeSubagentGate} implementation: expand the policy-mandated roles
 * for a plan, run them through the injected {@link RoleRunner}, and synthesize a terminal
 * decision. Wired into the AGI runtime's `subagentGate` dependency.
 */
export class MissionSubagentGate {
	readonly #runRole: RoleRunner;
	readonly #selfImprovement: boolean;

	constructor(options: { runRole: RoleRunner; selfImprovement?: boolean }) {
		this.#runRole = options.runRole;
		this.#selfImprovement = options.selfImprovement ?? false;
	}

	async enforce(input: {
		mission: Mission;
		contract: ObjectiveContract;
		plan: { id: string; steps: ContractiblePlanStep[] };
	}): Promise<SynthesizedDecision> {
		const expansion = expandSubAgentRoles({
			contract: input.contract,
			plan: input.plan,
			selfImprovement: this.#selfImprovement,
		});
		const orchestrator = new SubAgentOrchestrator({
			missionId: input.mission.id,
			objectiveContractId: input.contract.id,
			planId: input.plan.id,
			runRole: this.#runRole,
		});
		const { decision } = await orchestrator.run(expansion);
		return decision;
	}
}
