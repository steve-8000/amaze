import type { ContractiblePlanStep, Objective, ObjectiveContract, RuntimeAction } from "../autonomy/types";
import type { Mission } from "../mission/core/mission";
import type { MissionRuntime } from "../mission/core/mission-runtime.iface";
import type { RuntimeEventDraft } from "../mission/types";
import type { SessionToolGateway } from "../tools/gateway/session-gateway";
import type { ToolExecutionContext } from "../tools/registry/tool-descriptor";
import type { CapabilityLease } from "./capability-lease";
import type { EvidenceRequirement, MissionEvidenceVerifier } from "./evidence-verifier";
import type { AgiMemory, MemoryItem } from "./memory";
import { compileObjectiveContract, type ObjectiveCompilerModel } from "./objective-contract";
import type { RoleExecutor } from "./role-executor";
import { routePlanStepToAction } from "./role-router";

export interface AgiRuntimeScheduler {
	tick(): Promise<Array<{ objectiveId: string; kind: string; missionId?: string }>>;
}

export interface AgiRuntimeObjectiveSource {
	get(id: string): Objective | undefined;
}

export interface AgiRuntimePlanner {
	planMission(input: {
		mission: Mission;
		contract: ObjectiveContract;
		memory?: MemoryItem[];
	}): Promise<{ id: string; steps: ContractiblePlanStep[] }>;
}

export interface AgiRuntimeLeaseIssuer {
	issue(input: { mission: Mission; contract: ObjectiveContract; action: RuntimeAction }): CapabilityLease;
}

export interface AgiRuntimeActionStore {
	saveObjectiveContract?(missionId: string, contract: ObjectiveContract): void;
	saveRuntimeAction?(action: RuntimeAction, lease: CapabilityLease): void;
	markRuntimeAction?(actionId: string, status: RuntimeAction["status"]): void;
	appendRuntimeEvent?(input: RuntimeEventDraft): void;
}

export interface AgiRuntimeDeps {
	scheduler: AgiRuntimeScheduler;
	objectives: AgiRuntimeObjectiveSource;
	missionRuntime: MissionRuntime & { tryGet?(missionId: string): Mission | undefined };
	compilerModel: ObjectiveCompilerModel;
	planner: AgiRuntimePlanner;
	leaseIssuer: AgiRuntimeLeaseIssuer;
	toolGateway: Pick<SessionToolGateway, "decide">;
	modelRoles?: Record<string, string>;
	verifier?: MissionEvidenceVerifier;
	store?: AgiRuntimeActionStore;
	memory?: AgiMemory;
	executor?: RoleExecutor;
}

export interface AgiRuntimeTickResult {
	missionsObserved: number;
	actionsQueued: number;
	actionsAllowed: number;
	actionsBlocked: number;
}

/**
 * Thin AGI runtime orchestrator for the durable control flow:
 * scheduler tick → mission → objective contract → plan → runtime action → lease → gateway.
 */
export class AgiRuntime {
	readonly #deps: AgiRuntimeDeps;

	constructor(deps: AgiRuntimeDeps) {
		this.#deps = deps;
	}

	async tick(): Promise<AgiRuntimeTickResult> {
		const decisions = await this.#deps.scheduler.tick();
		const result: AgiRuntimeTickResult = {
			missionsObserved: 0,
			actionsQueued: 0,
			actionsAllowed: 0,
			actionsBlocked: 0,
		};

		for (const decision of decisions) {
			if (decision.kind !== "schedule-mission" && decision.kind !== "resume-mission") continue;
			if (!decision.missionId) continue;
			const objective = this.#deps.objectives.get(decision.objectiveId);
			if (!objective) continue;
			const mission = this.#deps.missionRuntime.tryGet?.(decision.missionId);
			if (!mission) continue;
			result.missionsObserved += 1;

			const contract = await compileObjectiveContract({
				goal: mission.objective,
				operatorCriteria: mission.acceptanceCriteria.map(criterion => criterion.description),
				constraints: mission.constraints,
				mode: objective.guardrails.requireHumanForApply ? "manual" : "supervised",
				llm: this.#deps.compilerModel,
			});
			this.#deps.store?.saveObjectiveContract?.(mission.id, contract);

			const memory = await this.#deps.memory?.query({
				levels: ["L1", "L2", "L3", "L4", "L5"],
				scope: { missionId: mission.id, objectiveId: decision.objectiveId },
				claimLike: mission.objective,
				limit: 20,
			});

			const plan = await this.#deps.planner.planMission({ mission, contract, memory });
			for (const step of plan.steps) {
				const action = routePlanStepToAction({
					missionId: mission.id,
					planId: plan.id,
					contract,
					step,
					modelRoles: this.#deps.modelRoles ?? defaultModelRoles(contract),
				});
				const lease = this.#deps.leaseIssuer.issue({ mission, contract, action });
				this.#deps.store?.saveRuntimeAction?.(action, lease);
				result.actionsQueued += 1;

				const guard = await this.#deps.toolGateway.decide(firstAllowedTool(lease), contextForLease(lease));
				if (guard.allowed) {
					this.#deps.store?.markRuntimeAction?.(action.id, "running");
					if (this.#deps.executor) {
						const execution = await this.#deps.executor.execute({ action, lease, mission, contract });
						this.#deps.store?.appendRuntimeEvent?.({
							missionId: mission.id,
							streamId: `runtime-action:${action.id}`,
							type: "runtime_action.completed",
							actor: action.role,
							payload: {
								actionId: action.id,
								leaseId: lease.leaseId,
								status: execution.status,
								error: execution.error,
							},
							evidenceRefs: execution.evidenceRefs,
							idempotencyKey: `runtime-action:${action.id}:${execution.status}`,
						});
						if (execution.status === "succeeded") {
							this.#deps.store?.markRuntimeAction?.(action.id, "succeeded");
							const verified = await this.#verifyActionEvidence(mission.id, contract.id, action);
							if (verified === "pass") this.#deps.store?.markRuntimeAction?.(action.id, "verified");
							if (verified === "fail") this.#deps.store?.markRuntimeAction?.(action.id, "failed");
						} else if (execution.status === "failed") {
							this.#deps.store?.markRuntimeAction?.(action.id, "failed");
						} else {
							this.#deps.store?.markRuntimeAction?.(action.id, "blocked");
						}
					}
					result.actionsAllowed += 1;
				} else {
					this.#deps.store?.markRuntimeAction?.(action.id, "blocked");
					result.actionsBlocked += 1;
				}
			}
		}

		return result;
	}

	async #verifyActionEvidence(
		missionId: string,
		objectiveContractId: string,
		action: RuntimeAction,
	): Promise<"pass" | "fail" | "insufficient_evidence" | undefined> {
		if (!this.#deps.verifier) return undefined;
		const requirements: EvidenceRequirement[] = action.requiredEvidence.map((kind, index) => ({
			criterionId: `${action.id}:evidence-${index + 1}`,
			description: kind,
			required: true,
			evidenceKinds: [kind],
		}));
		if (requirements.length === 0) return "pass";
		const result = await this.#deps.verifier.verifyMission({ missionId, objectiveContractId, requirements });
		return result.status;
	}
}

function firstAllowedTool(lease: CapabilityLease): string {
	const [tool] = lease.allowedTools;
	if (!tool) throw new Error(`Capability lease ${lease.leaseId} has no allowed tools`);
	return tool;
}

function contextForLease(lease: CapabilityLease): ToolExecutionContext {
	return {
		capabilityLease: lease,
		actionId: lease.actionId,
		planStepId: lease.planStepId,
		mission: { missionId: lease.missionId, emit: () => undefined },
		agentRole: "orchestrator",
	};
}

function defaultModelRoles(contract: ObjectiveContract): Record<string, string> {
	const roles: Record<string, string> = {};
	for (const capability of contract.rolePolicy.capabilities) roles[capability.modelRole] = capability.modelRole;
	return roles;
}
