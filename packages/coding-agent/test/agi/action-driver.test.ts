import { describe, expect, it } from "bun:test";
import { CompositeAgiActionDriver } from "../../src/agi/action-driver";
import type { AgiControlAction, AgiGatewayAction, AgiMonitoredSession } from "../../src/agi/store";
import type { AgiActionDriver } from "../../src/agi/supervisor";

function action(over: Partial<AgiGatewayAction> = {}): AgiGatewayAction {
	return {
		id: "a1",
		sessionId: "s1",
		actionType: "follow_up_turn",
		instruction: "do the thing",
		status: "pending",
		createdAt: 1,
		...over,
	};
}

const session = { sessionId: "s1" } as AgiMonitoredSession;

describe("CompositeAgiActionDriver", () => {
	it("routes payload-less actions to the legacy prompt driver", async () => {
		const calls: string[] = [];
		const legacy: AgiActionDriver = {
			async run() {
				calls.push("legacy");
				return { exitCode: 0, stdout: "prompted", stderr: "" };
			},
		};
		const driver = new CompositeAgiActionDriver({ legacy });
		const result = await driver.run(action(), session);
		expect(calls).toEqual(["legacy"]);
		expect(result.stdout).toBe("prompted");
	});

	it("routes an explicit legacy_follow_up_turn payload to the legacy driver", async () => {
		const calls: string[] = [];
		const legacy: AgiActionDriver = {
			async run() {
				calls.push("legacy");
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		const driver = new CompositeAgiActionDriver({ legacy });
		await driver.run(action({ payload: { kind: "legacy_follow_up_turn" } }), session);
		expect(calls).toEqual(["legacy"]);
	});

	it("dispatches runtime_tick to its wired handler and never the legacy driver", async () => {
		const calls: string[] = [];
		const legacy: AgiActionDriver = {
			async run() {
				calls.push("legacy");
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		const payload: AgiControlAction = { kind: "runtime_tick", missionId: "m1", profile: "strict-mutation" };
		const driver = new CompositeAgiActionDriver({
			legacy,
			runtimeTick: async () => {
				calls.push("runtime_tick");
				return { exitCode: 0, stdout: "ticked", stderr: "" };
			},
		});
		const result = await driver.run(action({ actionType: "runtime_tick", payload }), session);
		expect(calls).toEqual(["runtime_tick"]);
		expect(result.stdout).toBe("ticked");
	});

	it("fails closed when a structured action has no wired handler", async () => {
		const calls: string[] = [];
		const legacy: AgiActionDriver = {
			async run() {
				calls.push("legacy");
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		const payload: AgiControlAction = { kind: "runtime_tick", missionId: "m1", profile: "strict-mutation" };
		const driver = new CompositeAgiActionDriver({ legacy });
		const result = await driver.run(action({ actionType: "runtime_tick", payload }), session);
		// No prompt re-injection: the unwired structured action errors instead.
		expect(calls).toEqual([]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("runtime_tick");
	});
});
