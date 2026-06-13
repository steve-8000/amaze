import { afterEach, describe, expect, test } from "bun:test";
import { isAutonomyEnabled, ObjectiveStore, startAutonomyLoop } from "../../src/autonomy";

const stores: ObjectiveStore[] = [];

function createStore(): ObjectiveStore {
	const store = new ObjectiveStore(":memory:");
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		store.close();
	}
});

function settings(enabled: boolean) {
	return {
		get(path: "autonomy.enabled") {
			expect(path).toBe("autonomy.enabled");
			return enabled;
		},
	};
}

describe("autonomy feature flag", () => {
	test("autonomy is enabled only by explicit true", () => {
		expect(isAutonomyEnabled(settings(true))).toBe(true);
		expect(isAutonomyEnabled(settings(false))).toBe(false);
	});

	test("startAutonomyLoop is a no-op when disabled", async () => {
		const handle = await startAutonomyLoop({ settings: settings(false), store: createStore(), tickMs: 1 });

		handle.stop();
		expect(handle.tickCount).toBe(0);
	});

	test("startAutonomyLoop calls the scheduler when enabled", async () => {
		let schedulerTicks = 0;
		const handle = await startAutonomyLoop({
			settings: settings(true),
			store: createStore(),
			tickMs: 1,
			scheduler: {
				async tick() {
					schedulerTicks += 1;
					return [];
				},
			},
		});
		try {
			await Bun.sleep(5);
			expect(handle.tickCount).toBeGreaterThanOrEqual(1);
			expect(schedulerTicks).toBeGreaterThanOrEqual(1);
		} finally {
			handle.stop();
		}
	});
});
