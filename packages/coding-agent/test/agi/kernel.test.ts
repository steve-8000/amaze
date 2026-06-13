import { describe, expect, test } from "bun:test";
import { AgiKernel, type AgiKernelLedgerEvent } from "../../src/agi/kernel";

describe("AgiKernel", () => {
	test("ticks scheduler and appends mission binding ledger events", async () => {
		const events: AgiKernelLedgerEvent[] = [];
		const kernel = new AgiKernel({
			now: () => 123,
			scheduler: {
				async tick() {
					return [
						{
							objectiveId: "objective-1",
							missionId: "mission-1",
							kind: "schedule-mission",
							reason: "active objective has no resumable mission",
						} as const,
					];
				},
			},
			ledger: {
				append(event) {
					events.push(event);
				},
			},
		});

		const result = await kernel.tick();

		expect(result.decisions).toHaveLength(1);
		expect(events).toEqual([
			{
				streamId: "objective:objective-1",
				type: "objective.mission_binding",
				actor: "agi-kernel",
				idempotencyKey: "objective-1:mission-1:schedule-mission",
				payload: {
					objectiveId: "objective-1",
					missionId: "mission-1",
					decision: "schedule-mission",
					reason: "active objective has no resumable mission",
					ts: 123,
				},
			},
		]);
	});
});
