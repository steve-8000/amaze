import { afterEach, describe, expect, test } from "bun:test";
import { MissionStore } from "../../src/mission/store";
import { createDurableMissionToolContext, toolActionStreamId } from "../../src/mission/tool-action-log";
import type { ToolCallRecord } from "../../src/tools/registry/tool-descriptor";

const stores: MissionStore[] = [];

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});

function createStore(): MissionStore {
	const store = new MissionStore(":memory:");
	stores.push(store);
	return store;
}

function createMission(store: MissionStore, title = "Tool action log") {
	return store.createMission({
		title,
		objective: title,
		objectiveId: null,
		briefId: null,
		decisionId: null,
		riskLevel: "medium",
		state: "executing",
		confidence: null,
		snapshotRef: null,
		mode: "interactive",
		intent: "code_change",
		lifecycle: "executing",
	});
}

function requested(toolCallId: string, tool = "edit"): ToolCallRecord {
	return { type: "mission.tool.requested", missionId: "", taskId: null, toolCallId, tool, ts: 111 };
}

function completed(toolCallId: string, status: "ok" | "error" | "denied" = "ok", tool = "edit"): ToolCallRecord {
	return { type: "mission.tool.completed", missionId: "", taskId: null, toolCallId, tool, status, ts: 222 };
}

describe("createDurableMissionToolContext", () => {
	test("persists requested + completed records to runtime_events", () => {
		const store = createStore();
		const mission = createMission(store);
		const ctx = createDurableMissionToolContext({ store, getActiveMissionId: () => mission.id });

		ctx.emit(requested("call-1"));
		ctx.emit(completed("call-1", "ok"));

		const events = store.listRuntimeEvents(mission.id, { streamId: toolActionStreamId(mission.id, "call-1") });
		expect(events.map(e => e.type)).toEqual(["tool_action.requested", "tool_action.completed"]);
		const completedEvent = events.find(e => e.type === "tool_action.completed");
		expect(completedEvent?.payload).toMatchObject({ tool: "edit", status: "ok", toolCallId: "call-1" });
		expect(completedEvent?.actor).toBe("edit");
	});

	test("no-op when no active mission is bound", () => {
		const store = createStore();
		const mission = createMission(store);
		const ctx = createDurableMissionToolContext({ store, getActiveMissionId: () => undefined });

		ctx.emit(requested("call-x"));
		ctx.emit(completed("call-x"));

		expect(store.listRuntimeEvents(mission.id)).toHaveLength(0);
	});

	test("is idempotent per phase (duplicate emit collapses)", () => {
		const store = createStore();
		const mission = createMission(store);
		const ctx = createDurableMissionToolContext({ store, getActiveMissionId: () => mission.id });

		ctx.emit(requested("call-2"));
		ctx.emit(requested("call-2"));
		ctx.emit(completed("call-2"));
		ctx.emit(completed("call-2"));

		const events = store.listRuntimeEvents(mission.id, { streamId: toolActionStreamId(mission.id, "call-2") });
		expect(events).toHaveLength(2);
	});

	test("records a denied completion status", () => {
		const store = createStore();
		const mission = createMission(store);
		const ctx = createDurableMissionToolContext({ store, getActiveMissionId: () => mission.id });

		ctx.emit(completed("call-3", "denied", "bash"));

		const events = store.listRuntimeEvents(mission.id, { streamId: toolActionStreamId(mission.id, "call-3") });
		expect(events).toHaveLength(1);
		expect(events[0]?.payload).toMatchObject({ status: "denied", tool: "bash" });
	});

	test("swallows store errors and reports via onError (never throws into the call)", () => {
		const errors: unknown[] = [];
		const throwingStore = {
			appendRuntimeEvent() {
				throw new Error("db exploded");
			},
		};
		const ctx = createDurableMissionToolContext({
			store: throwingStore,
			getActiveMissionId: () => "mission-1",
			onError: e => errors.push(e),
		});

		expect(() => ctx.emit(requested("call-4"))).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	test("missionId getter reflects the active mission", () => {
		let active: string | undefined;
		const ctx = createDurableMissionToolContext({
			store: { appendRuntimeEvent: () => ({}) as never },
			getActiveMissionId: () => active,
		});
		expect(ctx.missionId).toBe("");
		active = "mission-9";
		expect(ctx.missionId).toBe("mission-9");
	});

	test("isolates the same toolCallId across two missions (mission-scoped stream id)", () => {
		const store = createStore();
		const missionA = createMission(store, "mission A");
		const missionB = createMission(store, "mission B");
		let active = missionA.id;
		const ctx = createDurableMissionToolContext({ store, getActiveMissionId: () => active });

		// Same reused toolCallId on two different active missions must not collapse.
		ctx.emit(requested("shared-call"));
		ctx.emit(completed("shared-call"));
		active = missionB.id;
		ctx.emit(requested("shared-call"));
		ctx.emit(completed("shared-call"));

		expect(store.listRuntimeEvents(missionA.id)).toHaveLength(2);
		expect(store.listRuntimeEvents(missionB.id)).toHaveLength(2);
	});
});
