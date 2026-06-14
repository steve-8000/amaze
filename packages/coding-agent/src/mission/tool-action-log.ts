/**
 * Durable tool-action log — routes the live tool gateway's lifecycle records
 * into the mission store's `runtime_events` ledger.
 *
 * The gateway already emits `mission.tool.requested` / `mission.tool.completed`
 * through the {@link ToolMissionContext.emit} seam when a mission context is
 * present (see `tools/gateway/tool-gateway.ts:#emitRecord`). Until now the live
 * interactive agent never set that context (`AgentSession.setMissionToolContext`
 * had no caller), so tool actions were observable only in transient session
 * telemetry — never the durable runtime-action log that Mission Inspector reads.
 *
 * This adapter is that missing sink. It resolves the active mission id lazily on
 * every record (the active mission can change across a session) and appends a
 * durable runtime event keyed by tool-call id, so a request/complete pair is
 * idempotent and survives a restart. Best-effort: a logging failure must never
 * break a tool call, so the adapter swallows store errors.
 */

import type { ToolCallRecord, ToolMissionContext } from "../tools/registry/tool-descriptor";
import type { MissionStore } from "./store";

export interface DurableMissionToolContextDeps {
	/** Durable mission store. Only `appendRuntimeEvent` is used. */
	store: Pick<MissionStore, "appendRuntimeEvent">;
	/** Resolve the currently-active mission id, or undefined when none is bound. */
	getActiveMissionId(): string | undefined;
	/** Optional failure sink for observability. Never rethrows. */
	onError?(error: unknown): void;
}

/**
 * Runtime-event stream id for a single tool call, scoped by mission. Scoping by
 * mission is load-bearing: `MissionStore.getRuntimeEventByIdempotencyKey` dedupes
 * by `(stream_id, idempotency_key)` only, so an unscoped key could collapse the
 * same `toolCallId` (or the empty-id fallback) across two missions and orphan the
 * second mission's log. Mission-scoping makes the key globally unique per mission.
 */
export function toolActionStreamId(missionId: string, toolCallId: string): string {
	return `tool-action:${missionId}:${toolCallId || "unknown"}`;
}

/**
 * Build a {@link ToolMissionContext} that persists tool lifecycle records to the
 * mission store. Returns undefined-safe behavior when no mission is active: the
 * `emit` becomes a no-op rather than throwing, so the gateway can always call it.
 *
 * `missionId`/`taskId` on the context are placeholders the gateway reads when it
 * builds records; the authoritative mission id used for persistence is resolved
 * fresh inside `emit` via `getActiveMissionId`, so a stale binding can never write
 * to the wrong mission.
 */
export function createDurableMissionToolContext(deps: DurableMissionToolContextDeps): ToolMissionContext {
	const emit = (record: ToolCallRecord): void => {
		const missionId = deps.getActiveMissionId();
		// No active mission ⇒ nothing durable to correlate against. Drop quietly.
		if (!missionId) return;
		try {
			const streamId = toolActionStreamId(missionId, record.toolCallId);
			if (record.type === "mission.tool.requested") {
				deps.store.appendRuntimeEvent({
					missionId,
					streamId,
					type: "tool_action.requested",
					actor: record.tool,
					idempotencyKey: `${streamId}:requested`,
					occurredAt: record.ts,
					payload: { tool: record.tool, taskId: record.taskId, toolCallId: record.toolCallId },
				});
				return;
			}
			deps.store.appendRuntimeEvent({
				missionId,
				streamId,
				type: "tool_action.completed",
				actor: record.tool,
				idempotencyKey: `${streamId}:completed`,
				occurredAt: record.ts,
				payload: {
					tool: record.tool,
					taskId: record.taskId,
					toolCallId: record.toolCallId,
					status: record.status,
				},
			});
		} catch (error) {
			deps.onError?.(error);
		}
	};

	return {
		// The gateway reads missionId/taskId only to stamp records; emit resolves the
		// authoritative id itself. Expose the active id so the shape stays honest.
		get missionId(): string {
			return deps.getActiveMissionId() ?? "";
		},
		taskId: null,
		emit,
	};
}
