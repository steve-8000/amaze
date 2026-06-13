import type { RuntimeAction } from "../autonomy/types";
import type { CapabilityLease } from "./capability-lease";

export interface ApprovalRequest {
	id: string;
	missionId: string;
	actionId: string;
	risk: "low" | "medium" | "high" | "critical";
	status: "pending" | "approved" | "rejected";
	createdAt: number;
	decidedAt?: number;
	decidedBy?: string;
	reason?: string;
}

export class AgiGovernance {
	readonly #requests = new Map<string, ApprovalRequest>();
	readonly #stoppedMissions = new Set<string>();
	readonly #now: () => number;

	constructor(input: { now?: () => number } = {}) {
		this.#now = input.now ?? Date.now;
	}

	requestApproval(action: RuntimeAction, risk: ApprovalRequest["risk"]): ApprovalRequest {
		const request: ApprovalRequest = {
			id: `approval-${action.id}`,
			missionId: action.missionId,
			actionId: action.id,
			risk,
			status: "pending",
			createdAt: this.#now(),
		};
		this.#requests.set(request.id, request);
		return request;
	}

	approve(id: string, by: string): ApprovalRequest {
		return this.#decide(id, "approved", by);
	}

	reject(id: string, by: string, reason: string): ApprovalRequest {
		return this.#decide(id, "rejected", by, reason);
	}

	stopMission(missionId: string): void {
		this.#stoppedMissions.add(missionId);
	}

	isStopped(missionId: string): boolean {
		return this.#stoppedMissions.has(missionId);
	}

	assertLeaseMayRun(lease: CapabilityLease): void {
		if (this.isStopped(lease.missionId)) throw new Error(`Mission is emergency-stopped: ${lease.missionId}`);
		if ((lease.allowedRisk === "HIGH" || lease.allowedRisk === "CRITICAL") && !lease.approval) {
			throw new Error("High or critical lease requires approval identity");
		}
	}

	#decide(id: string, status: "approved" | "rejected", by: string, reason?: string): ApprovalRequest {
		const request = this.#requests.get(id);
		if (!request) throw new Error(`Approval request not found: ${id}`);
		if (request.status !== "pending") throw new Error(`Approval request already decided: ${id}`);
		const next = { ...request, status, decidedAt: this.#now(), decidedBy: by, reason };
		this.#requests.set(id, next);
		return next;
	}
}
