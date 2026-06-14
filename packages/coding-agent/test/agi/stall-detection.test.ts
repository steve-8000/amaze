import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AgiGatewayStore } from "../../src/agi/store";
import { type AgiActionDriver, AgiSupervisor, detectControlStall } from "../../src/agi/supervisor";

async function writeSession(root: string, lines: unknown[]): Promise<string> {
	const file = path.join(root, "session.jsonl");
	await fs.writeFile(file, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);
	return file;
}

function assistantTurn(text: string): unknown {
	return {
		type: "message",
		id: `a-${Math.random().toString(36).slice(2)}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "assistant", content: [{ type: "text", text }], stopReason: "endTurn" },
	};
}

function toolResultEntry(): unknown {
	return {
		type: "message",
		id: `t-${Math.random().toString(36).slice(2)}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "toolResult", toolName: "edit", isError: false, content: "applied" },
	};
}

const noopDriver: AgiActionDriver = {
	async run() {
		return { exitCode: 0, stdout: "", stderr: "" };
	},
};

describe("detectControlStall", () => {
	const sig = (over: Partial<Parameters<typeof detectControlStall>[1]> = {}) => ({
		hasToolActivity: false,
		hasStructuredResult: false,
		hasAssistantEnd: true,
		...over,
	});

	it("flags a Korean priority-list response with no execution", () => {
		expect(detectControlStall("다음 미션컨트롤 우선순위는 다음과 같습니다.", sig())).toBe(true);
	});

	it("flags an English next-priority response with no execution", () => {
		expect(detectControlStall("Here is the plan. The next priority is to wire the driver.", sig())).toBe(true);
	});

	it("does not flag generic progress narration", () => {
		expect(detectControlStall("Progress made. Edited the gateway and ran the tests.", sig())).toBe(false);
	});

	it("never flags a turn that exercised a tool, even with priority phrasing", () => {
		expect(detectControlStall("Next priority: finish the driver.", sig({ hasToolActivity: true }))).toBe(false);
	});

	it("never flags a turn that emitted a structured completion marker", () => {
		expect(detectControlStall("Next steps follow.", sig({ hasStructuredResult: true }))).toBe(false);
	});

	it("does not flag when the turn never ended", () => {
		expect(detectControlStall("next priority", sig({ hasAssistantEnd: false }))).toBe(false);
	});
});

describe("AGI supervisor stall handling", () => {
	it("records session.stalled and never re-prompts a priority-list turn", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-stall-"));
		const store = new AgiGatewayStore(":memory:");
		const driverCalls: string[] = [];
		const driver: AgiActionDriver = {
			async run(action) {
				driverCalls.push(action.actionType);
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		try {
			const sessionFile = await writeSession(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Stall" },
				assistantTurn("다음 미션컨트롤 우선순위: 드라이버를 배선한다."),
			]);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				missionId: "mission-1",
				objective: "Wire the runtime",
				criteria: ["Driver wired"],
			});

			await new AgiSupervisor({ store, driver }).tick();

			const events = store.listEvents("s1");
			expect(events.some(event => event.type === "session.stalled")).toBe(true);
			expect(events.some(event => event.type === "session.turn_completed")).toBe(false);

			// A mission-bound stall queues a structured runtime_tick, not a prompt follow-up.
			const actions = store.listActions("s1");
			expect(actions).toHaveLength(1);
			expect(actions[0]?.actionType).toBe("runtime_tick");
			expect(actions[0]?.payload).toMatchObject({ kind: "runtime_tick", missionId: "mission-1" });
			expect(driverCalls).toEqual(["runtime_tick"]);

			const session = store.getSession("s1");
			expect(session?.controlState.consecutiveStalls).toBe(1);
			// The stall must not credit the completion alarm criterion.
			expect(session?.completionState.supervisorSatisfiedCriteria).not.toContain("completion_alarm_detected");
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("escalates a non-mission stall straight to blocked without any action", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-stall-"));
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await writeSession(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Stall" },
				assistantTurn("The next priority is to keep going."),
			]);
			store.addSession({ sessionId: "s1", sessionPath: sessionFile, cwd: root });

			await new AgiSupervisor({ store, driver: noopDriver }).tick();

			expect(store.listActions("s1")).toHaveLength(0);
			expect(store.getSession("s1")?.state).toBe("blocked");
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("blocks a mission session after repeated stalls instead of looping", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-stall-"));
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await writeSession(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Stall" },
				assistantTurn("다음 우선순위 1."),
			]);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				missionId: "mission-1",
				objective: "Wire the runtime",
				criteria: ["Driver wired"],
			});

			// Tick 1: first stall → runtime_tick queued.
			await new AgiSupervisor({ store, driver: noopDriver }).tick();
			expect(store.getSession("s1")?.controlState.consecutiveStalls).toBe(1);

			// Append a second stall turn so observeSessions sees new bytes.
			await fs.appendFile(sessionFile, `${JSON.stringify(assistantTurn("다음 우선순위 2."))}\n`);
			await new AgiSupervisor({ store, driver: noopDriver }).tick();
			expect(store.getSession("s1")?.controlState.consecutiveStalls).toBe(2);

			// Append a third stall turn → escalation to blocked, no new action.
			await fs.appendFile(sessionFile, `${JSON.stringify(assistantTurn("다음 우선순위 3."))}\n`);
			await new AgiSupervisor({ store, driver: noopDriver }).tick();
			const session = store.getSession("s1");
			expect(session?.state).toBe("blocked");
			expect(session?.controlState.blockedReason).toContain("stalled");
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("treats a tool-exercising turn as progress, not a stall", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-stall-"));
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await writeSession(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Progress" },
				toolResultEntry(),
				assistantTurn("Next steps: continue. I edited the file."),
			]);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				missionId: "mission-1",
				objective: "Wire the runtime",
				criteria: ["Driver wired"],
			});

			await new AgiSupervisor({ store, driver: noopDriver }).tick();

			const events = store.listEvents("s1");
			expect(events.some(event => event.type === "session.stalled")).toBe(false);
			expect(events.some(event => event.type === "session.turn_completed")).toBe(true);
			// Progress resets the stall counter and credits the completion alarm.
			expect(store.getSession("s1")?.controlState.consecutiveStalls).toBe(0);
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
