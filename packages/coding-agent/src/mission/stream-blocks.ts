import type { MissionEvent } from "./events";
import type { MissionStreamEvent } from "./stream";

export type MissionStreamBlockKind =
	| "lifecycle"
	| "task"
	| "tool"
	| "phase"
	| "verification"
	| "research"
	| "critic"
	| "status";

export type MissionStreamBlockStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "blocked"
	| "cancelled"
	| "unknown";

export type MissionStreamBlock = {
	id: string;
	missionId: string;
	kind: MissionStreamBlockKind;
	title: string;
	status: MissionStreamBlockStatus;
	ts: number;
	updatedAt: number;
	eventTypes: string[];
	summary: string;
	meta?: Record<string, string | number | boolean | null>;
};

export type MissionStreamBlockState = {
	missionId: string;
	blocks: MissionStreamBlock[];
};

type BlockPatch = {
	id: string;
	missionId: string;
	kind: MissionStreamBlockKind;
	title: string;
	status: MissionStreamBlockStatus;
	ts: number;
	eventType: string;
	summary: string;
	meta?: Record<string, string | number | boolean | null>;
};

export function reduceMissionStreamBlocks(
	events: MissionStreamEvent[],
	initial?: MissionStreamBlockState,
): MissionStreamBlockState {
	let state = initial ? cloneState(initial) : initialState(events[0]?.missionId ?? "");
	for (const event of events) {
		state = reduceMissionStreamBlock(state, event);
	}
	return state;
}

export function reduceMissionStreamBlock(
	state: MissionStreamBlockState,
	event: MissionStreamEvent,
): MissionStreamBlockState {
	let nextState = cloneStateWithMission(state, state.missionId || event.missionId);

	if (event.type === "mission.stream.snapshot") {
		nextState = upsertBlock(nextState, streamStatusPatch(event, "Snapshot loaded", "completed"));
		for (const rawEvent of event.events) {
			nextState = reduceMissionEvent(nextState, rawEvent);
		}
		return sortState(nextState);
	}

	if (event.type === "mission.stream.event") {
		return sortState(reduceMissionEvent(nextState, event.event));
	}

	return sortState(upsertBlock(nextState, streamStatusPatch(event, streamStatusSummary(event.type), "running")));
}

function reduceMissionEvent(state: MissionStreamBlockState, event: MissionEvent): MissionStreamBlockState {
	const patch = missionEventPatch(event);
	return patch ? upsertBlock(state, patch) : state;
}

function missionEventPatch(event: MissionEvent): BlockPatch | undefined {
	switch (event.type) {
		case "mission.created":
			return {
				id: `lifecycle:${event.missionId}`,
				missionId: event.missionId,
				kind: "lifecycle",
				title: event.title || "Mission",
				status: "running",
				ts: event.ts,
				eventType: event.type,
				summary: "Mission created",
				meta: compactMeta({ objectiveId: event.objectiveId, riskLevel: event.riskLevel }),
			};
		case "mission.classified":
			return lifecyclePatch(event, "Mission classified", "running", {
				riskLevel: event.riskLevel,
				confidence: event.confidence,
			});
		case "mission.planned":
			return lifecyclePatch(
				event,
				`Mission planned with ${event.taskCount} task${event.taskCount === 1 ? "" : "s"}`,
				"running",
				{
					taskCount: event.taskCount,
				},
			);
		case "mission.completed":
			return lifecyclePatch(event, "Mission completed", "completed", { finalState: String(event.finalState) });
		case "mission.blocked":
			return lifecyclePatch(
				event,
				event.reason ? `Mission blocked: ${event.reason}` : "Mission blocked",
				"blocked",
				{
					reason: event.reason,
				},
			);
		case "mission.cancelled":
			return lifecyclePatch(
				event,
				event.reason ? `Mission cancelled: ${event.reason}` : "Mission cancelled",
				"cancelled",
				{
					reason: event.reason,
				},
			);
		case "mission.rolled_back":
			return lifecyclePatch(event, `Rolled back ${event.targetType} ${event.targetId}`, "running", {
				rollbackId: event.rollbackId,
				targetType: event.targetType,
				targetId: event.targetId,
			});
		case "mission.task.created":
			return {
				id: `task:${event.taskId}`,
				missionId: event.missionId,
				kind: "task",
				title: `Task ${event.taskId}`,
				status: "pending",
				ts: event.ts,
				eventType: event.type,
				summary: event.agent ? `${event.role} task assigned to ${event.agent}` : `${event.role} task created`,
				meta: compactMeta({ taskId: event.taskId, role: event.role, agent: event.agent }),
			};
		case "mission.task.completed":
			return taskPatch(event, taskStatus(event.status), `Task ${event.status}`, { status: event.status });
		case "mission.task.failed":
			return taskPatch(event, "failed", "Task failed", { status: event.status });
		case "mission.task.attempt":
			return taskPatch(
				event,
				event.verdict === "success" ? "completed" : "failed",
				`Task attempt ${event.verdict}`,
				{
					verdict: event.verdict,
					note: event.note ?? null,
				},
			);
		case "mission.tool.requested":
			return {
				id: `tool:${event.toolCallId}`,
				missionId: event.missionId,
				kind: "tool",
				title: event.tool,
				status: "running",
				ts: event.ts,
				eventType: event.type,
				summary: `Requested ${event.tool}`,
				meta: compactMeta({ toolCallId: event.toolCallId, taskId: event.taskId, tool: event.tool }),
			};
		case "mission.tool.completed":
			return {
				id: `tool:${event.toolCallId}`,
				missionId: event.missionId,
				kind: "tool",
				title: event.tool,
				status: event.status === "ok" ? "completed" : event.status === "denied" ? "blocked" : "failed",
				ts: event.ts,
				eventType: event.type,
				summary: `${event.tool} ${event.status}`,
				meta: compactMeta({
					toolCallId: event.toolCallId,
					taskId: event.taskId,
					tool: event.tool,
					status: event.status,
				}),
			};
		case "mission.phase.declared":
			return {
				id: `phase:${event.phaseId}`,
				missionId: event.missionId,
				kind: "phase",
				title: event.name,
				status: "pending",
				ts: event.ts,
				eventType: event.type,
				summary: `Phase ${event.ordinal} declared`,
				meta: compactMeta({ phaseId: event.phaseId, ordinal: event.ordinal, name: event.name }),
			};
		case "mission.phase.verified":
			return phasePatch(event, verificationStatus(event.status), `Phase verification ${event.status}`, {
				verificationId: event.verificationId,
				status: event.status,
				failedCount: event.failedCount,
				uncertainCount: event.uncertainCount,
			});
		case "mission.phase.closed":
			return phasePatch(event, "completed", "Phase closed", {});
		case "verification.completed":
		case "mission.verification.completed":
			return {
				id: `verification:${event.verificationId}`,
				missionId: event.missionId,
				kind: "verification",
				title: `Verification ${event.verificationId}`,
				status: verificationStatus(event.status),
				ts: event.ts,
				eventType: event.type,
				summary: `Verification ${event.status}`,
				meta: compactMeta({
					verificationId: event.verificationId,
					status: event.status,
					failedCount: event.failedCount,
					uncertainCount: event.uncertainCount,
				}),
			};
		case "research.brief.created":
			return researchPatch({
				id: `research:${event.briefId}`,
				event,
				title: `Research brief ${event.briefId}`,
				status: "pending",
				summary: `Research brief created with ${event.lanes.length} lane${event.lanes.length === 1 ? "" : "s"}`,
				meta: { briefId: event.briefId, objectiveId: event.objectiveId, laneCount: event.lanes.length },
			});
		case "research.lane.started":
			return researchPatch({
				id: `research:${event.laneRunId}`,
				event,
				title: `Research ${event.lane}`,
				status: "running",
				summary: `${event.lane} research started`,
				meta: {
					laneRunId: event.laneRunId,
					lane: event.lane,
					agent: event.agent,
					epistemicRole: event.epistemicRole,
				},
			});
		case "research.lane.completed":
			return researchPatch({
				id: `research:${event.laneRunId}`,
				event,
				title: `Research ${event.lane}`,
				status: laneStatus(event.status),
				summary: `${event.lane} research ${event.status}`,
				meta: {
					laneRunId: event.laneRunId,
					lane: event.lane,
					status: event.status,
					evidenceCount: event.evidenceCount,
					emptyReason: event.emptyReason,
				},
			});
		case "research.evidence.added":
			return researchPatch({
				id: `research:${event.evidenceId}`,
				event,
				title: `Research evidence ${event.evidenceId}`,
				status: "completed",
				summary: `${event.lane} evidence added`,
				meta: { evidenceId: event.evidenceId, briefId: event.briefId, lane: event.lane, grade: event.grade },
			});
		case "research.synthesis.proposed":
			return researchPatch({
				id: `research:${event.briefId}:synthesis`,
				event,
				title: `Research synthesis ${event.briefId}`,
				status: "completed",
				summary: `Research synthesis proposed with ${event.hypothesisCount} hypothesis${event.hypothesisCount === 1 ? "" : "es"}`,
				meta: { briefId: event.briefId, hypothesisCount: event.hypothesisCount, recommended: event.recommended },
			});
		case "research.critique.completed":
			return criticPatch(
				event,
				critiqueStatus(event.blockingCount, event.verdict === "reject"),
				`Research critique ${event.verdict}`,
				{
					briefId: event.briefId,
					blockingCount: event.blockingCount,
					softCount: event.softCount,
					verdict: event.verdict,
				},
			);
		case "runtime_critic.checks.completed":
			return criticPatch(
				event,
				event.blockingCount > 0 ? "blocked" : "completed",
				"Runtime critic checks completed",
				{
					briefId: event.briefId,
					blockingCount: event.blockingCount,
					softCount: event.softCount,
				},
			);
		case "runtime_critic.dialogue.completed":
			return criticPatch(
				event,
				event.blockingCheckIds.length > 0 ? "blocked" : "completed",
				"Runtime critic dialogue completed",
				{
					turnCount: event.turnIds.length,
					blockingCount: event.blockingCheckIds.length,
				},
			);
		case "mission.critic.completed":
			return criticPatch(
				event,
				critiqueStatus(event.blockingCount, event.verdict === "fail"),
				`Mission critic ${event.verdict}`,
				{
					blockingCount: event.blockingCount,
					softCount: event.softCount,
					verdict: event.verdict,
				},
			);
		default:
			return undefined;
	}
}

function initialState(missionId: string): MissionStreamBlockState {
	return { missionId, blocks: [] };
}

function cloneState(state: MissionStreamBlockState): MissionStreamBlockState {
	return cloneStateWithMission(state, state.missionId);
}

function cloneStateWithMission(state: MissionStreamBlockState, missionId: string): MissionStreamBlockState {
	return {
		missionId,
		blocks: state.blocks.map(block => ({ ...block, eventTypes: [...block.eventTypes], meta: cloneMeta(block.meta) })),
	};
}

function upsertBlock(state: MissionStreamBlockState, patch: BlockPatch): MissionStreamBlockState {
	const blocks = [...state.blocks];
	const index = blocks.findIndex(block => block.id === patch.id);
	if (index === -1) {
		blocks.push({
			id: patch.id,
			missionId: patch.missionId,
			kind: patch.kind,
			title: patch.title,
			status: patch.status,
			ts: patch.ts,
			updatedAt: patch.ts,
			eventTypes: [patch.eventType],
			summary: patch.summary,
			...(patch.meta ? { meta: patch.meta } : {}),
		});
		return { missionId: state.missionId || patch.missionId, blocks };
	}

	const existing = blocks[index];
	const eventTypes = existing.eventTypes.includes(patch.eventType)
		? [...existing.eventTypes]
		: [...existing.eventTypes, patch.eventType];
	blocks[index] = {
		...existing,
		title: patch.title || existing.title,
		status: patch.status,
		updatedAt: Math.max(existing.updatedAt, patch.ts),
		eventTypes,
		summary: patch.summary,
		...(patch.meta
			? { meta: { ...(existing.meta ?? {}), ...patch.meta } }
			: existing.meta
				? { meta: { ...existing.meta } }
				: {}),
	};
	return { missionId: state.missionId || patch.missionId, blocks };
}

function sortState(state: MissionStreamBlockState): MissionStreamBlockState {
	return {
		missionId: state.missionId,
		blocks: [...state.blocks].sort((a, b) => a.ts - b.ts || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id)),
	};
}

function streamStatusPatch(
	event: Exclude<MissionStreamEvent, { type: "mission.stream.event" }>,
	summary: string,
	status: MissionStreamBlockStatus,
): BlockPatch {
	return {
		id: `status:${event.missionId}`,
		missionId: event.missionId,
		kind: "status",
		title: "Mission stream",
		status,
		ts: event.ts,
		eventType: event.type,
		summary,
	};
}

function streamStatusSummary(type: MissionStreamEvent["type"]): string {
	return type === "mission.stream.ready" ? "Stream ready" : "Stream heartbeat";
}

function lifecyclePatch(
	event: MissionEvent & { ts: number; missionId: string; type: string },
	summary: string,
	status: MissionStreamBlockStatus,
	meta: Record<string, string | number | boolean | null>,
): BlockPatch {
	return {
		id: `lifecycle:${event.missionId}`,
		missionId: event.missionId,
		kind: "lifecycle",
		title: "Mission",
		status,
		ts: event.ts,
		eventType: event.type,
		summary,
		meta: compactMeta(meta),
	};
}

function taskPatch(
	event: Extract<MissionEvent, { taskId: string }> & { type: string },
	status: MissionStreamBlockStatus,
	summary: string,
	meta: Record<string, string | number | boolean | null>,
): BlockPatch {
	return {
		id: `task:${event.taskId}`,
		missionId: event.missionId,
		kind: "task",
		title: `Task ${event.taskId}`,
		status,
		ts: event.ts,
		eventType: event.type,
		summary,
		meta: compactMeta({ taskId: event.taskId, ...meta }),
	};
}

function phasePatch(
	event: Extract<MissionEvent, { phaseId: string }> & { type: string },
	status: MissionStreamBlockStatus,
	summary: string,
	meta: Record<string, string | number | boolean | null>,
): BlockPatch {
	return {
		id: `phase:${event.phaseId}`,
		missionId: event.missionId,
		kind: "phase",
		title: `Phase ${event.phaseId}`,
		status,
		ts: event.ts,
		eventType: event.type,
		summary,
		meta: compactMeta({ phaseId: event.phaseId, ...meta }),
	};
}

function researchPatch(input: {
	id: string;
	event: MissionEvent & { ts: number; missionId: string; type: string };
	title: string;
	status: MissionStreamBlockStatus;
	summary: string;
	meta: Record<string, string | number | boolean | null>;
}): BlockPatch {
	return {
		id: input.id,
		missionId: input.event.missionId,
		kind: "research",
		title: input.title,
		status: input.status,
		ts: input.event.ts,
		eventType: input.event.type,
		summary: input.summary,
		meta: compactMeta(input.meta),
	};
}

function criticPatch(
	event: MissionEvent & { ts: number; missionId: string; type: string },
	status: MissionStreamBlockStatus,
	summary: string,
	meta: Record<string, string | number | boolean | null>,
): BlockPatch {
	return {
		id: `critic:${event.missionId}`,
		missionId: event.missionId,
		kind: "critic",
		title: "Critic",
		status,
		ts: event.ts,
		eventType: event.type,
		summary,
		meta: compactMeta(meta),
	};
}

function taskStatus(status: "completed" | "failed" | "blocked" | "escalated"): MissionStreamBlockStatus {
	if (status === "completed") return "completed";
	if (status === "blocked" || status === "escalated") return "blocked";
	return "failed";
}

function verificationStatus(status: "pass" | "fail" | "uncertain" | "force"): MissionStreamBlockStatus {
	if (status === "pass" || status === "force") return "completed";
	if (status === "fail") return "failed";
	return "unknown";
}

function laneStatus(status: string): MissionStreamBlockStatus {
	if (status === "completed" || status === "accepted" || status === "success") return "completed";
	if (status === "failed" || status === "rejected") return "failed";
	if (status === "blocked") return "blocked";
	if (status === "cancelled") return "cancelled";
	return "unknown";
}

function critiqueStatus(blockingCount: number, rejected: boolean): MissionStreamBlockStatus {
	return blockingCount > 0 || rejected ? "blocked" : "completed";
}

function compactMeta(
	meta: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> | undefined {
	const entries = Object.entries(meta).filter(
		(entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function cloneMeta(
	meta: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
	return meta ? { ...meta } : undefined;
}
