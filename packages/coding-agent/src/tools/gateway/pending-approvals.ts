import type { ToolRiskLevel } from "../registry/tool-descriptor";

export type PendingApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PendingApprovalRequest {
	id: string;
	status: PendingApprovalStatus;
	tool: string;
	toolCallId: string;
	missionId?: string;
	taskId?: string;
	riskLevel: ToolRiskLevel;
	reason: string;
	requestedAt: number;
	resolvedAt?: number;
	resolvedBy?: string;
	resolutionReason?: string;
	inputSummary?: string;
}

export interface PendingApprovalRequestInput {
	tool: string;
	toolCallId: string;
	missionId?: string;
	taskId?: string | null;
	riskLevel: ToolRiskLevel;
	reason: string;
	inputSummary?: string;
}

export interface PendingApprovalResolution {
	status: Exclude<PendingApprovalStatus, "pending">;
	resolvedBy?: string;
	resolutionReason?: string;
}

export interface PendingApprovalListFilter {
	status?: PendingApprovalStatus;
	tool?: string;
	toolCallId?: string;
	missionId?: string;
	taskId?: string;
}

/**
 * Deterministic in-memory approval registry for tool-call permission denials.
 *
 * IDs and timestamps are sequence-derived so session-local callers get stable ordering without a wall-clock dependency.
 */
export class PendingApprovalRegistry {
	#requests = new Map<string, PendingApprovalRequest>();
	#idsByToolCallId = new Map<string, string>();
	#nextSequence = 1;

	request(input: PendingApprovalRequestInput): PendingApprovalRequest {
		const existing = this.pendingForToolCall(input.toolCallId);
		if (existing) return existing;

		const sequence = this.#nextSequence++;
		const request: PendingApprovalRequest = {
			id: `approval-${sequence}`,
			status: "pending",
			tool: input.tool,
			toolCallId: input.toolCallId,
			riskLevel: input.riskLevel,
			reason: input.reason,
			requestedAt: sequence,
			...(input.missionId ? { missionId: input.missionId } : {}),
			...(input.taskId ? { taskId: input.taskId } : {}),
			...(input.inputSummary ? { inputSummary: input.inputSummary } : {}),
		};
		this.#requests.set(request.id, request);
		this.#idsByToolCallId.set(request.toolCallId, request.id);
		return request;
	}

	resolve(id: string, resolution: PendingApprovalResolution): PendingApprovalRequest | undefined {
		const existing = this.#requests.get(id);
		if (!existing) return undefined;

		const sequence = this.#nextSequence++;
		const resolved: PendingApprovalRequest = {
			...existing,
			status: resolution.status,
			resolvedAt: sequence,
			...(resolution.resolvedBy ? { resolvedBy: resolution.resolvedBy } : {}),
			...(resolution.resolutionReason ? { resolutionReason: resolution.resolutionReason } : {}),
		};
		this.#requests.set(id, resolved);
		return resolved;
	}

	get(id: string): PendingApprovalRequest | undefined {
		return this.#requests.get(id);
	}

	list(filter: PendingApprovalListFilter = {}): PendingApprovalRequest[] {
		return Array.from(this.#requests.values()).filter(request => {
			if (filter.status && request.status !== filter.status) return false;
			if (filter.tool && request.tool !== filter.tool) return false;
			if (filter.toolCallId && request.toolCallId !== filter.toolCallId) return false;
			if (filter.missionId && request.missionId !== filter.missionId) return false;
			if (filter.taskId && request.taskId !== filter.taskId) return false;
			return true;
		});
	}

	pendingForToolCall(toolCallId: string): PendingApprovalRequest | undefined {
		const id = this.#idsByToolCallId.get(toolCallId);
		const request = id ? this.#requests.get(id) : undefined;
		return request?.status === "pending" ? request : undefined;
	}
}
