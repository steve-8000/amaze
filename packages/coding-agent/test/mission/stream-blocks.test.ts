import { describe, expect, test } from "bun:test";
import type { MissionEvent } from "../../src/mission/events";
import type { MissionStreamEvent } from "../../src/mission/stream";
import { reduceMissionStreamBlock, reduceMissionStreamBlocks } from "../../src/mission/stream-blocks";

const missionId = "mission-1";

function streamEvent(event: MissionEvent, ts = event.ts): MissionStreamEvent {
	return { type: "mission.stream.event", missionId, event, ts } as MissionStreamEvent;
}

describe("mission stream blocks", () => {
	test("snapshot folds mission, task, and tool events into sorted blocks plus status", () => {
		const state = reduceMissionStreamBlocks([
			{
				type: "mission.stream.snapshot",
				missionId,
				ts: 40,
				events: [
					{
						type: "mission.tool.requested",
						missionId,
						taskId: "task-1",
						toolCallId: "call-1",
						tool: "read",
						ts: 30,
					},
					{
						type: "mission.created",
						missionId,
						title: "Test mission",
						objectiveId: null,
						riskLevel: "medium",
						ts: 10,
					},
					{ type: "mission.task.created", missionId, taskId: "task-1", role: "builder", agent: "agent-1", ts: 20 },
				] as MissionEvent[],
			} as MissionStreamEvent,
		]);

		expect(state.missionId).toBe(missionId);
		expect(state.blocks.map(block => block.id)).toEqual([
			"lifecycle:mission-1",
			"task:task-1",
			"tool:call-1",
			"status:mission-1",
		]);
		expect(state.blocks.map(block => [block.kind, block.status, block.ts])).toEqual([
			["lifecycle", "running", 10],
			["task", "pending", 20],
			["tool", "running", 30],
			["status", "completed", 40],
		]);
		expect(state.blocks[0]).toMatchObject({
			title: "Test mission",
			summary: "Mission created",
			eventTypes: ["mission.created"],
		});
		expect(state.blocks[1]).toMatchObject({ title: "Task task-1", summary: "builder task assigned to agent-1" });
		expect(state.blocks[2]).toMatchObject({ title: "read", summary: "Requested read" });
		expect(state.blocks[3]).toMatchObject({ title: "Mission stream", summary: "Snapshot loaded" });
	});

	test("incremental tool completion updates same block without mutating previous state", () => {
		const previous = reduceMissionStreamBlocks([
			streamEvent({
				type: "mission.tool.requested",
				missionId,
				taskId: "task-1",
				toolCallId: "call-1",
				tool: "read",
				ts: 10,
			} as MissionEvent),
		]);
		const previousBlocks = previous.blocks;
		const previousTool = previous.blocks[0];
		const previousEventTypes = previousTool.eventTypes;
		const previousMeta = previousTool.meta;

		const next = reduceMissionStreamBlock(
			previous,
			streamEvent({
				type: "mission.tool.completed",
				missionId,
				taskId: "task-1",
				toolCallId: "call-1",
				tool: "read",
				status: "ok",
				ts: 25,
			} as MissionEvent),
		);

		expect(next).not.toBe(previous);
		expect(next.blocks).not.toBe(previousBlocks);
		expect(next.blocks).toHaveLength(1);
		expect(previous.blocks).toBe(previousBlocks);
		expect(previous.blocks[0]).toBe(previousTool);
		expect(previousTool.eventTypes).toBe(previousEventTypes);
		expect(previousTool.meta).toBe(previousMeta);
		expect(previousTool).toMatchObject({
			status: "running",
			ts: 10,
			updatedAt: 10,
			eventTypes: ["mission.tool.requested"],
		});
		expect(next.blocks[0]).not.toBe(previousTool);
		expect(next.blocks[0]).toMatchObject({
			id: "tool:call-1",
			kind: "tool",
			status: "completed",
			ts: 10,
			updatedAt: 25,
			eventTypes: ["mission.tool.requested", "mission.tool.completed"],
			summary: "read ok",
			meta: { toolCallId: "call-1", taskId: "task-1", tool: "read", status: "ok" },
		});

		const replayed = reduceMissionStreamBlock(
			next,
			streamEvent({
				type: "mission.tool.completed",
				missionId,
				taskId: "task-1",
				toolCallId: "call-1",
				tool: "read",
				status: "ok",
				ts: 30,
			} as MissionEvent),
		);
		expect(replayed.blocks[0].eventTypes).toEqual(["mission.tool.requested", "mission.tool.completed"]);
		expect(replayed.blocks[0]).toMatchObject({ ts: 10, updatedAt: 30 });
	});

	test("mission terminal events map lifecycle status", () => {
		const created = reduceMissionStreamBlocks([
			streamEvent({
				type: "mission.created",
				missionId,
				title: "Test mission",
				objectiveId: null,
				riskLevel: "medium",
				ts: 10,
			} as MissionEvent),
		]);

		expect(
			reduceMissionStreamBlock(
				created,
				streamEvent({ type: "mission.blocked", missionId, reason: "needs input", ts: 20 } as MissionEvent),
			).blocks[0],
		).toMatchObject({
			id: "lifecycle:mission-1",
			status: "blocked",
			summary: "Mission blocked: needs input",
			ts: 10,
			updatedAt: 20,
		});
		expect(
			reduceMissionStreamBlock(
				created,
				streamEvent({ type: "mission.cancelled", missionId, reason: null, ts: 30 } as MissionEvent),
			).blocks[0],
		).toMatchObject({
			id: "lifecycle:mission-1",
			status: "cancelled",
			summary: "Mission cancelled",
			ts: 10,
			updatedAt: 30,
		});
		expect(
			reduceMissionStreamBlock(
				created,
				streamEvent({ type: "mission.completed", missionId, finalState: "completed", ts: 40 } as MissionEvent),
			).blocks[0],
		).toMatchObject({
			id: "lifecycle:mission-1",
			status: "completed",
			summary: "Mission completed",
			ts: 10,
			updatedAt: 40,
		});
	});

	test("phase and verification events keep stable ids and statuses", () => {
		const state = reduceMissionStreamBlocks([
			streamEvent({
				type: "mission.phase.declared",
				missionId,
				phaseId: "phase-1",
				ordinal: 1,
				name: "Build",
				ts: 10,
			} as MissionEvent),
			streamEvent({
				type: "mission.phase.verified",
				missionId,
				phaseId: "phase-1",
				verificationId: "verify-1",
				status: "fail",
				failedCount: 2,
				uncertainCount: 0,
				ts: 20,
			} as MissionEvent),
			streamEvent({ type: "mission.phase.closed", missionId, phaseId: "phase-1", ts: 30 } as MissionEvent),
			streamEvent({
				type: "mission.verification.completed",
				missionId,
				verificationId: "verify-1",
				status: "uncertain",
				failedCount: 0,
				uncertainCount: 1,
				ts: 25,
			} as MissionEvent),
		]);

		expect(state.blocks.map(block => [block.id, block.kind, block.status, block.ts, block.updatedAt])).toEqual([
			["phase:phase-1", "phase", "completed", 10, 30],
			["verification:verify-1", "verification", "unknown", 25, 25],
		]);
		expect(state.blocks[0].eventTypes).toEqual([
			"mission.phase.declared",
			"mission.phase.verified",
			"mission.phase.closed",
		]);
		expect(state.blocks[0]).toMatchObject({
			title: "Phase phase-1",
			summary: "Phase closed",
			meta: {
				phaseId: "phase-1",
				ordinal: 1,
				name: "Build",
				verificationId: "verify-1",
				status: "fail",
				failedCount: 2,
				uncertainCount: 0,
			},
		});
		expect(state.blocks[1]).toMatchObject({
			title: "Verification verify-1",
			summary: "Verification uncertain",
			eventTypes: ["mission.verification.completed"],
		});
	});

	test("research lane and critic events reduce to research and critic blocks", () => {
		const state = reduceMissionStreamBlocks([
			streamEvent({
				type: "research.lane.started",
				missionId,
				laneRunId: "lane-1",
				lane: "source",
				agent: "researcher-1",
				epistemicRole: "source_harvest",
				ts: 10,
			} as MissionEvent),
			streamEvent({
				type: "research.lane.completed",
				missionId,
				laneRunId: "lane-1",
				lane: "source",
				status: "completed",
				evidenceCount: 3,
				emptyReason: null,
				ts: 20,
			} as MissionEvent),
			streamEvent({
				type: "mission.critic.completed",
				missionId,
				blockingCount: 1,
				softCount: 2,
				verdict: "fail",
				ts: 30,
			} as MissionEvent),
		]);

		expect(state.blocks.map(block => [block.id, block.kind, block.status, block.ts, block.updatedAt])).toEqual([
			["research:lane-1", "research", "completed", 10, 20],
			["critic:mission-1", "critic", "blocked", 30, 30],
		]);
		expect(state.blocks[0]).toMatchObject({
			title: "Research source",
			summary: "source research completed",
			eventTypes: ["research.lane.started", "research.lane.completed"],
			meta: {
				laneRunId: "lane-1",
				lane: "source",
				agent: "researcher-1",
				epistemicRole: "source_harvest",
				status: "completed",
				evidenceCount: 3,
				emptyReason: null,
			},
		});
		expect(state.blocks[1]).toMatchObject({
			title: "Critic",
			summary: "Mission critic fail",
			eventTypes: ["mission.critic.completed"],
			meta: { blockingCount: 1, softCount: 2, verdict: "fail" },
		});
	});
});
