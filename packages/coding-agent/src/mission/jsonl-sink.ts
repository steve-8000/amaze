import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import type { MissionEventBus, Unsubscribe } from "./event-bus";
import type { MissionEvent } from "./events";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 500;

type Timer = ReturnType<typeof setTimeout>;

type SinkOptions = {
	baseDir?: string;
	batchSize?: number;
	flushIntervalMs?: number;
};

export class MissionJsonlSink {
	#baseDir: string;
	#batchSize: number;
	#flushIntervalMs: number;
	#unsubscribe: Unsubscribe;
	#pending: MissionEvent[] = [];
	#timer: Timer | null = null;
	#flushChain: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(bus: MissionEventBus, options: SinkOptions = {}) {
		this.#baseDir =
			options.baseDir ?? path.join(process.env.HOME || homedir(), ".amaze", "observability", "missions");
		this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
		this.#flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.#unsubscribe = bus.subscribe(event => this.#enqueue(event));
	}

	async flush(): Promise<void> {
		this.#scheduleFlush();
		await this.#flushChain;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#unsubscribe();
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#scheduleFlush();
		await this.#flushChain;
	}

	#enqueue(event: MissionEvent): void {
		if (this.#closed) return;
		this.#pending.push(event);
		if (this.#pending.length >= this.#batchSize) {
			this.#scheduleFlush();
		} else if (!this.#timer) {
			this.#timer = setTimeout(() => {
				this.#timer = null;
				this.#scheduleFlush();
			}, this.#flushIntervalMs);
		}
	}

	#scheduleFlush(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#flushChain = this.#flushChain.then(() => this.#flushPending());
	}

	async #flushPending(): Promise<void> {
		if (this.#pending.length === 0) return;
		const batch = this.#pending.splice(0, this.#pending.length);
		const byMission = new Map<string, string[]>();
		for (const event of batch) {
			const lines = byMission.get(event.missionId) ?? [];
			lines.push(`${JSON.stringify(event)}\n`);
			byMission.set(event.missionId, lines);
		}

		await fs.mkdir(this.#baseDir, { recursive: true });
		for (const [missionId, lines] of byMission) {
			await fs.appendFile(this.#missionPath(missionId), lines.join(""), "utf8");
		}
	}

	#missionPath(missionId: string): string {
		return path.join(this.#baseDir, `${missionId}.jsonl`);
	}
}
