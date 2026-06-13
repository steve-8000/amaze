import type { RuntimeAction } from "../autonomy/types";
import type { AgiApprovalRequestRecord, MissionStore } from "../mission/store";
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
	readonly #store: MissionStore | undefined;

	constructor(input: { now?: () => number; store?: MissionStore } = {}) {
		this.#now = input.now ?? Date.now;
		this.#store = input.store;
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
		this.#saveRequest(request);
		return request;
	}

	approve(id: string, by: string): ApprovalRequest {
		return this.#decide(id, "approved", by);
	}

	reject(id: string, by: string, reason: string): ApprovalRequest {
		return this.#decide(id, "rejected", by, reason);
	}

	stopMission(missionId: string, reason?: string): void {
		this.#stoppedMissions.add(missionId);
		this.#store?.recordAgiEmergencyStop(missionId, reason);
	}

	isStopped(missionId: string): boolean {
		return this.#stoppedMissions.has(missionId) || this.#store?.getAgiEmergencyStop(missionId) !== undefined;
	}

	assertLeaseMayRun(lease: CapabilityLease): void {
		if (this.isStopped(lease.missionId)) throw new Error(`Mission is emergency-stopped: ${lease.missionId}`);
		if (lease.allowedRisk === "HIGH" || lease.allowedRisk === "CRITICAL") {
			if (!lease.approval) throw new Error("High or critical lease requires approval identity");
			const request = this.#getRequest(lease.approval.approvalId);
			if (!request || request.status !== "approved") throw new Error("Lease approval is not approved");
			if (request.missionId !== lease.missionId || request.actionId !== lease.actionId) {
				throw new Error("Lease approval does not match mission/action");
			}
		}
	}

	#decide(id: string, status: "approved" | "rejected", by: string, reason?: string): ApprovalRequest {
		const request = this.#getRequest(id);
		if (!request) throw new Error(`Approval request not found: ${id}`);
		if (request.status !== "pending") throw new Error(`Approval request already decided: ${id}`);
		const next = { ...request, status, decidedAt: this.#now(), decidedBy: by, reason };
		this.#saveRequest(next);
		return next;
	}

	#getRequest(id: string): ApprovalRequest | undefined {
		return this.#requests.get(id) ?? recordToApprovalRequest(this.#store?.getAgiApprovalRequest(id));
	}

	#saveRequest(request: ApprovalRequest): void {
		this.#requests.set(request.id, request);
		this.#store?.saveAgiApprovalRequest(request);
	}
}

function recordToApprovalRequest(record: AgiApprovalRequestRecord | undefined): ApprovalRequest | undefined {
	if (!record) return undefined;
	return {
		id: record.id,
		missionId: record.missionId,
		actionId: record.actionId,
		risk: record.risk,
		status: record.status,
		createdAt: record.createdAt,
		decidedAt: record.decidedAt,
		decidedBy: record.decidedBy,
		reason: record.reason,
	};
}
