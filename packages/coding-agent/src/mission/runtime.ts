import { MissionEventBus } from "./event-bus";
import { MissionJsonlSink } from "./jsonl-sink";

type MissionRuntimeOptions = {
	baseDir?: string;
	batchSize?: number;
	flushIntervalMs?: number;
};

type MissionRuntime = {
	bus: MissionEventBus;
	sink: MissionJsonlSink;
};

let runtime: MissionRuntime | undefined;

export function initializeMissionRuntime(options: MissionRuntimeOptions = {}): MissionRuntime {
	if (runtime) return runtime;
	const bus = new MissionEventBus();
	const sink = new MissionJsonlSink(bus, options);
	runtime = { bus, sink };
	return runtime;
}

export function getMissionEventBus(): MissionEventBus | undefined {
	return runtime?.bus;
}

export function getMissionJsonlSink(): MissionJsonlSink | undefined {
	return runtime?.sink;
}

export async function closeMissionRuntime(): Promise<void> {
	const current = runtime;
	runtime = undefined;
	await current?.sink.close();
}
