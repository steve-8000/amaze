import type { ObjectiveScheduler, ObjectiveTickDecision } from "../autonomy/scheduler";

export interface AgiKernelLedgerEvent {
	streamId: string;
	type: string;
	actor: string;
	idempotencyKey: string;
	payload: Record<string, unknown>;
	evidence?: Record<string, unknown>;
}

export interface AgiKernelLedger {
	append(event: AgiKernelLedgerEvent): Promise<unknown> | unknown;
}

export interface AgiKernelDeps {
	scheduler: Pick<ObjectiveScheduler, "tick">;
	ledger?: AgiKernelLedger;
	now(): number;
}

export interface AgiKernelRunResult {
	decisions: ObjectiveTickDecision[];
}

export class AgiKernel {
	readonly #deps: AgiKernelDeps;

	constructor(deps: AgiKernelDeps) {
		this.#deps = deps;
	}

	async tick(): Promise<AgiKernelRunResult> {
		const decisions = await this.#deps.scheduler.tick();
		for (const decision of decisions) {
			if (decision.missionId) {
				await this.#deps.ledger?.append({
					streamId: `objective:${decision.objectiveId}`,
					type: "objective.mission_binding",
					actor: "agi-kernel",
					idempotencyKey: `${decision.objectiveId}:${decision.missionId}:${decision.kind}`,
					payload: {
						objectiveId: decision.objectiveId,
						missionId: decision.missionId,
						decision: decision.kind,
						reason: decision.reason,
						ts: this.#deps.now(),
					},
				});
			}
		}
		return { decisions };
	}
}
