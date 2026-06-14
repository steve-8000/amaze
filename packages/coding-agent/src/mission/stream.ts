import type { MissionEventBus } from "./event-bus";
import type { MissionEvent } from "./events";
import type { MissionReadModel, MissionView } from "./read-model";
import { readMissionEvents } from "./reader";

export type MissionStreamReadyEvent = {
	type: "mission.stream.ready";
	missionId: string;
	ts: number;
};

export type MissionStreamSnapshotEvent = {
	type: "mission.stream.snapshot";
	missionId: string;
	view?: MissionView;
	events: MissionEvent[];
	ts: number;
};

export type MissionStreamHeartbeatEvent = {
	type: "mission.stream.heartbeat";
	missionId: string;
	ts: number;
};

export type MissionStreamLiveEvent = {
	type: "mission.stream.event";
	missionId: string;
	event: MissionEvent;
	ts: number;
};

export type MissionStreamEvent =
	| MissionStreamReadyEvent
	| MissionStreamSnapshotEvent
	| MissionStreamHeartbeatEvent
	| MissionStreamLiveEvent;

export type MissionSnapshotInput = {
	missionId: string;
	readModel?: MissionReadModel;
	eventsBaseDir?: string;
	includePersistedEvents?: boolean;
};

export type SubscribeMissionStreamInput = MissionSnapshotInput & {
	bus: MissionEventBus;
	heartbeatMs?: number;
};

export async function missionSnapshot(input: MissionSnapshotInput): Promise<MissionStreamSnapshotEvent> {
	const includePersistedEvents = input.includePersistedEvents ?? true;
	const view = input.readModel?.getMissionView(input.missionId);
	const events = includePersistedEvents
		? (await readMissionEvents(input.missionId, { baseDir: input.eventsBaseDir })).filter(
				event => event.missionId === input.missionId,
			)
		: [];

	return {
		type: "mission.stream.snapshot",
		missionId: input.missionId,
		...(view !== undefined ? { view } : {}),
		events,
		ts: Date.now(),
	};
}

/**
 * Live-tail contract:
 * 1. Register the bus subscription before reading the async snapshot so no live
 *    events are lost while persisted events/read-model state are loading.
 * 2. Yield `ready`, then one point-in-time `snapshot`, then buffered/live events
 *    for the requested mission only. Consumers should de-duplicate against the
 *    snapshot if their persisted sink and bus overlap at the cutover boundary.
 * 3. The subscription is removed from `finally` when the consumer closes the
 *    iterator or the stream exits after an error.
 */
export async function* subscribeMissionStream(input: SubscribeMissionStreamInput): AsyncGenerator<MissionStreamEvent> {
	const queue: MissionEvent[] = [];
	let signal: (() => void) | undefined;
	const wake = () => {
		const current = signal;
		if (!current) return;
		signal = undefined;
		current();
	};

	const unsubscribe = input.bus.subscribe(event => {
		if (event.missionId !== input.missionId) return;
		queue.push(event);
		wake();
	});

	try {
		yield { type: "mission.stream.ready", missionId: input.missionId, ts: Date.now() };
		yield await missionSnapshot(input);

		while (true) {
			const event = queue.shift();
			if (event) {
				yield { type: "mission.stream.event", missionId: input.missionId, event, ts: Date.now() };
				continue;
			}

			const heartbeatMs = normalizeHeartbeatMs(input.heartbeatMs);
			const waitResult = await waitForEventOrHeartbeat({
				heartbeatMs,
				setSignal: nextSignal => {
					signal = nextSignal;
				},
				clearSignal: nextSignal => {
					if (signal === nextSignal) signal = undefined;
				},
			});
			if (waitResult === "heartbeat" && queue.length === 0) {
				yield { type: "mission.stream.heartbeat", missionId: input.missionId, ts: Date.now() };
			}
		}
	} finally {
		signal = undefined;
		unsubscribe();
	}
}

function normalizeHeartbeatMs(heartbeatMs: number | undefined): number | undefined {
	return typeof heartbeatMs === "number" && Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : undefined;
}

function waitForEventOrHeartbeat(input: {
	heartbeatMs: number | undefined;
	setSignal: (signal: () => void) => void;
	clearSignal: (signal: () => void) => void;
}): Promise<"event" | "heartbeat"> {
	return new Promise(resolve => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: "event" | "heartbeat") => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			input.clearSignal(nextSignal);
			resolve(result);
		};
		const nextSignal = () => finish("event");
		input.setSignal(nextSignal);
		if (input.heartbeatMs !== undefined) {
			timer = setTimeout(() => finish("heartbeat"), input.heartbeatMs);
		}
	});
}
