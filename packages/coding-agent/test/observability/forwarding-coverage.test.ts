import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MissionRuntimeImpl } from "../../src/mission/core/mission-runtime";
import { MissionStore } from "../../src/mission/store";
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
	it("forwards mission lifecycle events to the mission store bus", async () => {
		const session = {};
		const bus = getSessionEventBus(session);
		const store = new MissionStore(":memory:");
		const runtime = new MissionRuntimeImpl({ store });
		try {
			const mission = await runtime.create({
				title: "ship forwarding",
				objective: "ship forwarding",
				riskLevel: "low",
			});
			runtime.recordVerification(mission.id, { status: "pass", summary: "ok" });
			await runtime.complete(mission.id, { outcome: { status: "success", summary: "done", recordedAt: 1234 } });
			expect(runtime.runtimeEvents().some(event => event.detail?.kind === "mission_updated")).toBe(true);
			expect(bus.snapshot()).toEqual([]);
		} finally {
			runtime.close();
			store.close();
		}
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
