import type { SessionEvent } from "./event-schema";

export type SessionEventSubscriber = (event: SessionEvent) => void;
export type Unsubscribe = () => void;

export class EventBus {
	#events: SessionEvent[] = [];
	#subscribers = new Set<SessionEventSubscriber>();
	#capacity: number;

	constructor(capacity = 5000) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error("EventBus capacity must be a positive integer");
		}
		this.#capacity = capacity;
	}

	emit(event: SessionEvent): void {
		this.#events.push(event);
		if (this.#events.length > this.#capacity) {
			this.#events.splice(0, this.#events.length - this.#capacity);
		}

		const subscribers = [...this.#subscribers];
		if (subscribers.length === 0) return;

		queueMicrotask(() => {
			for (const subscriber of subscribers) {
				if (this.#subscribers.has(subscriber)) {
					subscriber(event);
				}
			}
		});
	}

	subscribe(subscriber: SessionEventSubscriber): Unsubscribe {
		this.#subscribers.add(subscriber);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.#subscribers.delete(subscriber);
		};
	}

	snapshot(n = this.#capacity): SessionEvent[] {
		if (!Number.isFinite(n) || n <= 0) return [];
		return this.#events.slice(-Math.floor(n));
	}
}
