import type { CapabilityLeaseRecord, MissionStore, RuntimeActionRecord } from "../mission/store";

export interface AgiTimelineEvent {
	ts: number;
	missionId: string;
	actionId?: string;
	leaseId?: string;
	type: string;
	actor: string;
	summary: string;
	evidenceRefs: string[];
}

export function buildMissionTimeline(input: {
	missionId: string;
	store: Pick<MissionStore, "listRuntimeEvents"> & Partial<Pick<MissionStore, "listRunnableActions">>;
}): AgiTimelineEvent[] {
	return input.store.listRuntimeEvents(input.missionId).map(event => ({
		ts: event.occurredAt,
		missionId: event.missionId,
		actionId: typeof event.payload.actionId === "string" ? event.payload.actionId : undefined,
		leaseId: typeof event.payload.leaseId === "string" ? event.payload.leaseId : undefined,
		type: event.type,
		actor: event.actor ?? "system",
		summary: typeof event.payload.summary === "string" ? event.payload.summary : event.type,
		evidenceRefs: event.evidenceRefs,
	}));
}

export function summarizeRuntimeAction(action: RuntimeActionRecord): string {
	return `${action.status}: ${action.action.role} ${action.action.instruction}`;
}

export function summarizeCapabilityLease(lease: CapabilityLeaseRecord): string {
	return `${lease.status}: ${lease.id} for ${lease.runtimeActionId}`;
}
