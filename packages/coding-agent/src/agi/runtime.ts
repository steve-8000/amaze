import type { ContractiblePlanStep, Objective, ObjectiveContract, RuntimeAction } from "../autonomy/types";
import type { Mission, MissionPlan } from "../mission/core/mission";
import type { MissionRuntime } from "../mission/core/mission-runtime.iface";
import type { MissionTask } from "../mission/core/mission-task";
import type { RuntimeEventDraft } from "../mission/types";
import { verifySourceRefs } from "../research/source-verifier";
import type { SessionToolGateway } from "../tools/gateway/session-gateway";
import type { ToolExecutionContext } from "../tools/registry/tool-descriptor";
import type { CapabilityLease } from "./capability-lease";
import type { EvidenceRequirement, MissionEvidenceVerifier } from "./evidence-verifier";
import type { AgiGovernance } from "./governance";
import type { AgiMemory, MemoryItem } from "./memory";
import { compileObjectiveContract, type ObjectiveCompilerModel } from "./objective-contract";
import type { RoleExecutor } from "./role-executor";
import { routePlanStepToAction } from "./role-router";
import type { SandboxManager, SandboxWorkspace } from "./sandbox-manager";

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
	savePlan?(missionId: string, plan: MissionPlan): void;
	saveTask?(input: MissionTask & { missionId: string }): MissionTask | undefined;
	saveRuntimeAction?(action: RuntimeAction, lease: CapabilityLease): void;
	getRuntimeAction?(actionId: string): { status: RuntimeAction["status"] } | undefined;
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
	toolGateway: Pick<SessionToolGateway, "decide"> & Partial<Pick<SessionToolGateway, "settle">>;
	modelRoles?: Record<string, string>;
	verifier?: MissionEvidenceVerifier;
	store?: AgiRuntimeActionStore;
	memory?: AgiMemory;
	executor?: RoleExecutor;
	governance?: Pick<AgiGovernance, "assertLeaseMayRun">;
	sandbox?: SandboxManager;
	/**
	 * Repository root the sandbox manager forks worktrees from. Defaults to the
	 * current process cwd; the mutation harness points it at an isolated repo.
	 */
	repoCwd?: string;
}

export interface AgiRuntimeTickResult {
	missionsObserved: number;
	actionsQueued: number;
	actionsAllowed: number;
	actionsBlocked: number;
	missionsCompleted: number;
	missionsBlocked: number;
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
			missionsCompleted: 0,
			missionsBlocked: 0,
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
			const memoryGate = this.#filterPlanningMemory(memory, contract);
			if (!memoryGate.allowed) {
				await this.#blockMission(mission.id, memoryGate.reason, [], result);
				continue;
			}

			const plan = await this.#deps.planner.planMission({ mission, contract, memory: memoryGate.memory });
			this.#persistPlan(mission.id, plan);
			const planActionIds: string[] = [];
			const planStatuses = new Map<string, RuntimeAction["status"]>();
			const planEvidenceRefs = new Set<string>();
			for (const step of plan.steps) {
				const action = routePlanStepToAction({
					missionId: mission.id,
					planId: plan.id,
					contract,
					step,
					modelRoles: this.#deps.modelRoles ?? defaultModelRoles(contract),
				});
				planActionIds.push(action.id);
				const existingAction = this.#deps.store?.getRuntimeAction?.(action.id);
				if (existingAction) planStatuses.set(action.id, existingAction.status);
				if (existingAction?.status === "running") {
					this.#markAction(action.id, "blocked", planStatuses);
					this.#deps.store?.appendRuntimeEvent?.({
						missionId: mission.id,
						streamId: `runtime-action:${action.id}`,
						type: "runtime_action.recovered_non_terminal",
						actor: action.role,
						payload: {
							actionId: action.id,
							previousStatus: "running",
							status: "blocked",
						},
						idempotencyKey: `runtime-action:${action.id}:recovered-running`,
					});
					result.actionsBlocked += 1;
					continue;
				}
				if (existingAction && existingAction.status !== "queued") continue;
				this.#persistTask(mission.id, step);
				const lease = this.#deps.leaseIssuer.issue({ mission, contract, action });
				this.#deps.store?.saveRuntimeAction?.(action, lease);
				try {
					this.#deps.governance?.assertLeaseMayRun(lease);
				} catch (error) {
					this.#markAction(action.id, "blocked", planStatuses);
					this.#deps.store?.appendRuntimeEvent?.({
						missionId: mission.id,
						streamId: `runtime-action:${action.id}`,
						type: "runtime.governance.blocked",
						actor: action.role,
						payload: {
							actionId: action.id,
							leaseId: lease.leaseId,
							error: error instanceof Error ? error.message : String(error),
						},
						idempotencyKey: `runtime-action:${action.id}:governance-blocked`,
					});
					result.actionsBlocked += 1;
					continue;
				}
				const toolName = firstAllowedTool(lease);
				const toolContext = contextForLease(lease, event => this.#deps.store?.appendRuntimeEvent?.(event));
				result.actionsQueued += 1;

				const guard = await this.#deps.toolGateway.decide(toolName, toolContext);
				if (guard.allowed) {
					this.#markAction(action.id, "running", planStatuses);
					if (this.#deps.executor) {
						const sandboxWorkspace =
							lease.sandbox.mode === "none"
								? undefined
								: await this.#deps.sandbox?.create({
										missionId: mission.id,
										actionId: action.id,
										cwd: this.#deps.repoCwd ?? process.cwd(),
										baselineRef: lease.sandbox.baselineRef,
									});
						const execution = await this.#deps.executor.execute({
							action,
							lease,
							mission,
							contract,
							sandboxWorkspace,
						});
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
						for (const ref of execution.evidenceRefs) planEvidenceRefs.add(ref);
						this.#deps.toolGateway.settle?.(
							toolName,
							toolContext,
							execution.status === "succeeded" ? "ok" : "error",
						);
						if (action.requiredEvidence.includes("runtime_metric")) {
							this.#deps.store?.appendRuntimeEvent?.({
								missionId: mission.id,
								streamId: `runtime-action:${action.id}`,
								type: "runtime.metric",
								actor: action.role,
								payload: {
									actionId: action.id,
									leaseId: lease.leaseId,
									metric: "strict_supervised_observation",
									passed: execution.status === "succeeded",
								},
								evidenceRefs: execution.evidenceRefs,
								idempotencyKey: `runtime-action:${action.id}:runtime-metric:${execution.status}`,
							});
						}
						if (sandboxWorkspace) {
							const diff = await this.#deps.sandbox?.captureDiff(sandboxWorkspace.id);
							if (diff) {
								this.#deps.store?.appendRuntimeEvent?.({
									missionId: mission.id,
									streamId: `runtime-action:${action.id}`,
									type: "sandbox.diff_captured",
									actor: action.role,
									payload: {
										actionId: action.id,
										workspaceId: sandboxWorkspace.id,
										diffRef: diff.diffRef,
										contentHash: diff.contentHash,
									},
									evidenceRefs: [diff.diffRef],
									idempotencyKey: `runtime-action:${action.id}:sandbox-diff:${diff.contentHash}`,
								});
								planEvidenceRefs.add(diff.diffRef);
							}
						}
						if (execution.status === "succeeded") {
							this.#markAction(action.id, "succeeded", planStatuses);
							const verified = await this.#verifyActionEvidence(mission.id, contract.id, action);
							if (verified === "pass") {
								this.#markAction(action.id, "verified", planStatuses);
								await this.#acceptSandbox(mission.id, action, lease, sandboxWorkspace, planEvidenceRefs);
							} else {
								if (verified === "fail") this.#markAction(action.id, "failed", planStatuses);
								await this.#rollbackSandbox(
									mission.id,
									action,
									sandboxWorkspace?.id,
									lease,
									verified === "fail"
										? "runtime action failed evidence verification"
										: "runtime action produced insufficient evidence",
								);
							}
						} else if (execution.status === "failed") {
							this.#markAction(action.id, "failed", planStatuses);
							await this.#rollbackSandbox(
								mission.id,
								action,
								sandboxWorkspace?.id,
								lease,
								execution.error ?? "runtime action failed",
							);
						} else {
							this.#markAction(action.id, "blocked", planStatuses);
							await this.#rollbackSandbox(
								mission.id,
								action,
								sandboxWorkspace?.id,
								lease,
								execution.error ?? "runtime action blocked",
							);
						}
					}
					result.actionsAllowed += 1;
				} else {
					this.#markAction(action.id, "blocked", planStatuses);
					result.actionsBlocked += 1;
				}
			}
			await this.#settleMissionPlan(
				mission,
				contract.id,
				planActionIds,
				planStatuses,
				[...planEvidenceRefs],
				result,
			);
		}

		return result;
	}

	#persistPlan(missionId: string, plan: { id: string; steps: ContractiblePlanStep[] }): void {
		this.#deps.store?.savePlan?.(missionId, {
			steps: plan.steps.map(step => ({
				id: step.id,
				description: step.description,
				edges: (step.dependsOn ?? []).map(target => ({ target, kind: "depends-on" as const })),
			})),
		});
	}

	#filterPlanningMemory(
		memory: MemoryItem[] | undefined,
		contract: ObjectiveContract,
	): { allowed: true; memory: MemoryItem[] | undefined } | { allowed: false; reason: string } {
		if (!memory || memory.length === 0) {
			if (contract.freshnessPolicy?.researchRequired) {
				return {
					allowed: false,
					reason: "Objective requires fresh research but no planning memory was available.",
				};
			}
			return { allowed: true, memory };
		}
		const maxAgeMs =
			contract.freshnessPolicy?.maxSourceAgeDays === undefined
				? undefined
				: contract.freshnessPolicy.maxSourceAgeDays * 24 * 60 * 60 * 1000;
		const eligible = memory.filter(item => {
			if (contract.freshnessPolicy?.researchRequired && !item.verified) return false;
			return verifySourceRefs(item.sourceRefs, { maxAgeMs }).issues.length === 0;
		});
		if (contract.freshnessPolicy?.researchRequired && eligible.length === 0) {
			return {
				allowed: false,
				reason: "Objective requires fresh research but all planning memory was stale or missing provenance.",
			};
		}
		return { allowed: true, memory: eligible };
	}

	#persistTask(missionId: string, step: ContractiblePlanStep): void {
		this.#deps.store?.saveTask?.({
			missionId,
			id: `${missionId}:task:${step.id}`,
			title: step.description,
			objective: step.description,
			status: "pending",
			assignedAgent: step.roleHint,
			planStepId: step.id,
			scope: { include: step.touches ?? [], exclude: [] },
			successCriteria: step.acceptanceCriteria,
			allowedTools: [],
			deniedTools: [],
		});
	}

	#markAction(
		actionId: string,
		status: RuntimeAction["status"],
		planStatuses: Map<string, RuntimeAction["status"]>,
	): void {
		this.#deps.store?.markRuntimeAction?.(actionId, status);
		planStatuses.set(actionId, status);
	}

	async #settleMissionPlan(
		mission: Mission,
		objectiveContractId: string,
		actionIds: string[],
		planStatuses: Map<string, RuntimeAction["status"]>,
		evidenceRefs: string[],
		result: AgiRuntimeTickResult,
	): Promise<void> {
		if (actionIds.length === 0) return;
		const statuses = actionIds.map(
			actionId => planStatuses.get(actionId) ?? this.#deps.store?.getRuntimeAction?.(actionId)?.status,
		);
		if (statuses.every(status => status === "verified")) {
			const verification = {
				status: "pass" as const,
				verdict: "pass" as const,
				summary: `AGI runtime verified ${actionIds.length} action(s) for objective contract ${objectiveContractId}.`,
				failedCount: 0,
				uncertainCount: 0,
			};
			this.#deps.missionRuntime.recordVerification?.(mission.id, verification);
			try {
				await this.#deps.missionRuntime.complete?.(mission.id, {
					outcome: {
						status: "success",
						summary: verification.summary,
						evidenceRefs,
						recordedAt: Date.now(),
					},
				});
				result.missionsCompleted += 1;
			} catch (error) {
				await this.#blockMission(
					mission.id,
					`Verified runtime actions could not complete mission: ${error instanceof Error ? error.message : String(error)}`,
					evidenceRefs,
					result,
				);
			}
			return;
		}
		if (statuses.some(status => status === "failed")) {
			this.#deps.missionRuntime.recordVerification?.(mission.id, {
				status: "fail",
				verdict: "fail",
				summary: `AGI runtime action failed for objective contract ${objectiveContractId}.`,
				failedCount: statuses.filter(status => status === "failed").length,
				uncertainCount: 0,
			});
			await this.#blockMission(mission.id, "AGI runtime action failed verification.", evidenceRefs, result);
			return;
		}
		if (statuses.some(status => status === "blocked")) {
			await this.#blockMission(
				mission.id,
				"AGI runtime action blocked by tool policy or executor.",
				evidenceRefs,
				result,
			);
		}
	}

	async #blockMission(
		missionId: string,
		reason: string,
		evidenceRefs: string[],
		result: AgiRuntimeTickResult,
	): Promise<void> {
		await this.#deps.missionRuntime.block?.(missionId, { reason, evidenceRefs });
		result.missionsBlocked += 1;
	}

	async #acceptSandbox(
		missionId: string,
		action: RuntimeAction,
		lease: CapabilityLease,
		workspace: SandboxWorkspace | undefined,
		planEvidenceRefs: Set<string>,
	): Promise<void> {
		if (!workspace || !this.#deps.sandbox?.applyToMain) return;
		const applied = await this.#deps.sandbox.applyToMain(workspace.id);
		this.#deps.store?.appendRuntimeEvent?.({
			missionId,
			streamId: `runtime-action:${action.id}`,
			type: "sandbox.applied",
			actor: action.role,
			payload: {
				actionId: action.id,
				leaseId: lease.leaseId,
				workspaceId: workspace.id,
				appliedRef: applied.appliedRef,
				rollbackRef: applied.rollbackRef,
			},
			evidenceRefs: [applied.appliedRef],
			idempotencyKey: `runtime-action:${action.id}:sandbox-applied:${applied.appliedRef}`,
		});
		planEvidenceRefs.add(applied.appliedRef);
		await this.#deps.sandbox.dispose(workspace.id);
	}

	async #rollbackSandbox(
		missionId: string,
		action: RuntimeAction,
		workspaceId: string | undefined,
		lease: CapabilityLease,
		reason: string,
	): Promise<void> {
		if (!workspaceId) return;
		for (const rollbackRef of lease.sandbox.rollbackRefs) {
			await this.#deps.sandbox?.rollback({ rollbackRef, reason });
		}
		this.#deps.store?.appendRuntimeEvent?.({
			missionId,
			streamId: `runtime-action:${action.id}`,
			type: "rollback.completed",
			actor: action.role,
			payload: {
				actionId: action.id,
				leaseId: lease.leaseId,
				workspaceId,
				reason,
				rollbackRefs: lease.sandbox.rollbackRefs,
			},
			evidenceRefs: lease.sandbox.rollbackRefs.map(ref => `rollback:${ref}`),
			idempotencyKey: `runtime-action:${action.id}:rollback`,
		});
		await this.#deps.sandbox?.dispose(workspaceId);
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

function contextForLease(
	lease: CapabilityLease,
	appendRuntimeEvent?: (event: RuntimeEventDraft) => void,
): ToolExecutionContext {
	return {
		capabilityLease: lease,
		actionId: lease.actionId,
		planStepId: lease.planStepId,
		mission: {
			missionId: lease.missionId,
			emit: record => {
				appendRuntimeEvent?.({
					missionId: record.missionId,
					streamId: `runtime-action:${lease.actionId}`,
					type: record.type,
					actor: "agi.runtime",
					payload: {
						toolCallId: record.toolCallId,
						tool: record.tool,
						...(record.type === "mission.tool.completed" ? { status: record.status } : {}),
					},
					idempotencyKey: `runtime-action:${lease.actionId}:${record.type}:${record.toolCallId}:${record.type === "mission.tool.completed" ? record.status : "requested"}`,
				});
			},
		},
		agentRole: "orchestrator",
	};
}

function defaultModelRoles(contract: ObjectiveContract): Record<string, string> {
	const roles: Record<string, string> = {};
	for (const capability of contract.rolePolicy.capabilities) roles[capability.modelRole] = capability.modelRole;
	return roles;
}
