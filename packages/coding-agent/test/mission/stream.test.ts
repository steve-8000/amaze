import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MissionEventBus } from "../../src/mission/event-bus";
import type { MissionCreatedEvent, MissionEvent } from "../../src/mission/events";
import { type MissionStreamEvent, missionSnapshot, subscribeMissionStream } from "../../src/mission/stream";

const tempDirs: string[] = [];

function missionCreated(missionId: string, ts: number): MissionCreatedEvent {
	return {
		type: "mission.created",
		missionId,
		title: `Mission ${missionId}`,
		objectiveId: null,
		riskLevel: "medium",
		ts,
	};
}

async function makeTempEventsDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-stream-test-"));
	tempDirs.push(dir);
	return dir;
}

async function writeJsonl(filePath: string, events: MissionEvent[]): Promise<void> {
	await fs.writeFile(filePath, `${events.map(event => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

async function flushBusEmit(): Promise<void> {
	await new Promise<void>(resolve => queueMicrotask(resolve));
}

async function expectNext(iterator: AsyncGenerator<MissionStreamEvent>): Promise<MissionStreamEvent> {
	const result = await iterator.next();
	expect(result.done).toBe(false);
	return result.value;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("mission stream", () => {
	test("missionSnapshot returns persisted events for the requested mission", async () => {
		const eventsDir = await makeTempEventsDir();
		const mission1First = missionCreated("mission-1", 10);
		const mission2Event = missionCreated("mission-2", 20);
		const mission1Second = missionCreated("mission-1", 30);
		await writeJsonl(path.join(eventsDir, "mission-1.jsonl"), [mission1First, mission2Event]);
		await writeJsonl(path.join(eventsDir, "mission-1.2.jsonl"), [mission1Second]);
		await writeJsonl(path.join(eventsDir, "mission-2.jsonl"), [mission2Event]);

		const snapshot = await missionSnapshot({
			missionId: "mission-1",
			eventsBaseDir: eventsDir,
			includePersistedEvents: true,
		});

		expect(snapshot.type).toBe("mission.stream.snapshot");
		expect(snapshot.missionId).toBe("mission-1");
		expect(snapshot.events).toEqual([mission1First, mission1Second]);
	});

	test("subscribeMissionStream yields ready, snapshot, then only matching live events", async () => {
		const bus = new MissionEventBus();
		const iterator = subscribeMissionStream({
			missionId: "mission-1",
			bus,
			includePersistedEvents: false,
		});

		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.ready", missionId: "mission-1" });
		expect(await expectNext(iterator)).toMatchObject({
			type: "mission.stream.snapshot",
			missionId: "mission-1",
			events: [],
		});

		const ignored = missionCreated("mission-2", 20);
		const live = missionCreated("mission-1", 30);
		bus.emit(ignored);
		bus.emit(live);
		await flushBusEmit();

		const streamed = await expectNext(iterator);
		expect(streamed).toMatchObject({ type: "mission.stream.event", missionId: "mission-1", event: live });
		await iterator.return(undefined);
	});

	test("subscribeMissionStream buffers live events emitted before the snapshot resolves", async () => {
		const eventsDir = await makeTempEventsDir();
		const bus = new MissionEventBus();
		const iterator = subscribeMissionStream({
			missionId: "mission-1",
			bus,
			eventsBaseDir: eventsDir,
			includePersistedEvents: true,
		});

		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.ready", missionId: "mission-1" });

		const live = missionCreated("mission-1", 40);
		bus.emit(live);
		await flushBusEmit();

		expect(await expectNext(iterator)).toMatchObject({
			type: "mission.stream.snapshot",
			missionId: "mission-1",
			events: [],
		});
		expect(await expectNext(iterator)).toMatchObject({
			type: "mission.stream.event",
			missionId: "mission-1",
			event: live,
		});
		await iterator.return(undefined);
	});

	test("subscribeMissionStream emits heartbeats after ready and snapshot when idle", async () => {
		const bus = new MissionEventBus();
		const iterator = subscribeMissionStream({
			missionId: "mission-1",
			bus,
			includePersistedEvents: false,
			heartbeatMs: 1,
		});

		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.ready", missionId: "mission-1" });
		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.snapshot", missionId: "mission-1" });
		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.heartbeat", missionId: "mission-1" });
		await iterator.return(undefined);
	});

	test("closing the iterator unsubscribes from later bus events", async () => {
		const bus = new MissionEventBus();
		const iterator = subscribeMissionStream({
			missionId: "mission-1",
			bus,
			includePersistedEvents: false,
		});

		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.ready", missionId: "mission-1" });
		expect(await expectNext(iterator)).toMatchObject({ type: "mission.stream.snapshot", missionId: "mission-1" });
		expect(await iterator.return(undefined)).toEqual({ value: undefined, done: true });

		bus.emit(missionCreated("mission-1", 50));
		await flushBusEmit();
		expect(await iterator.next()).toEqual({ value: undefined, done: true });
	});
});
