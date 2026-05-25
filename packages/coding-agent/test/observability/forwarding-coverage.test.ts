import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ObjectiveRuntimeImpl } from "../../src/goals/runtime";
import type { GoalModeState, GoalRuntimeEvent, GoalTokenUsage } from "../../src/goals/state";
import { NexusStore } from "../../src/nexus/store";
import { getSessionEventBus } from "../../src/observability/session-bus";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-forwarding-"));
	tempRoots.push(root);
	return root;
}

describe("observability forwarding coverage", () => {
	it("forwards goal completion events to the session bus", async () => {
		const session = {};
		const bus = getSessionEventBus(session);
		let state: GoalModeState | undefined;
		const runtime = new ObjectiveRuntimeImpl({
			getState: () => state,
			setState: next => {
				state = next;
			},
			getCurrentUsage: (): GoalTokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
			emit: (_event: GoalRuntimeEvent) => {},
			persist: () => {},
			sendHiddenMessage: async () => {},
			now: () => 1234,
			getSessionId: () => "session-goal",
			sessionEventBus: bus,
		});

		await runtime.createGoal({ objective: "ship forwarding" });
		await runtime.completeGoalFromTool({ force: true });

		expect(bus.snapshot().some(event => event.type === "goal.complete" && event.sessionId === "session-goal")).toBe(
			true,
		);
	});

	it("forwards nexus memory write, recall, and skill promotion events", async () => {
		const root = await tempDir();
		const session = {};
		const bus = getSessionEventBus(session);
		const store = new NexusStore({ agentDir: root, cwd: root, sessionId: "session-memory", sessionEventBus: bus });
		try {
			const add = store.add({ target: "project", content: "Forwarding coverage unique recall fact." });
			expect(add.success).toBe(true);

			const hits = store.search({ query: "Forwarding coverage", scope: "current_project", limit: 5 });
			expect(hits.length).toBeGreaterThan(0);

			store.ensureScope(store.scope);
			expect(store.upsertSkill(store.scope.id, "forwarding-skill", "Use forwarding coverage.", [], "active")).toBe(
				true,
			);
		} finally {
			store.close();
		}

		const types = bus.snapshot().map(event => event.type);
		expect(types).toContain("memory.write");
		expect(types).toContain("memory.recall");
		expect(types).toContain("skill.promote");
	});

	it("uses a single event bus per session object", () => {
		const session = {};
		expect(getSessionEventBus(session)).toBe(getSessionEventBus(session));
	});
});
