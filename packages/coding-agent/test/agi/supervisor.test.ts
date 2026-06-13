import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EvidenceVerifier } from "../../src/agi/evidence-verifier";
import { AgiGatewayStore, buildAgiCompletionState } from "../../src/agi/store";
import { type AgiActionDriver, AgiSupervisor, createFailClosedAgiCompletionVerifier } from "../../src/agi/supervisor";

async function makeSessionFile(root: string, lines: unknown[]): Promise<string> {
	const file = path.join(root, "session.jsonl");
	await fs.writeFile(file, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);
	return file;
}

async function makeCompletionClaimSession(root: string): Promise<string> {
	return makeSessionFile(root, [
		{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "AGI claim" },
		{
			type: "message",
			id: "a1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				content: [
					{
						type: "text",
						text: 'Done.\nAGI_GATEWAY_RESULT {"score":100,"complete":true,"satisfiedCriteria":["context_boundaries_preserved","initial_build_goal_complete"],"summary":"Claimed complete."}',
					},
				],
				stopReason: "endTurn",
			},
		},
	]);
}

describe("AGI supervisor", () => {
	it("observes completed turns, schedules follow-up work, and increases structured progress", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		const driverCalls: string[] = [];
		const driver: AgiActionDriver = {
			async run(action) {
				driverCalls.push(action.instruction);
				return { exitCode: 0, stdout: "continued", stderr: "" };
			},
		};
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeSessionFile(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "AGI loop" },
				{
					type: "message",
					id: "u1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: { role: "user", content: "build agi" },
				},
				{
					type: "message",
					id: "a1",
					parentId: "u1",
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Initial AGI control loop is partially ready." }],
						stopReason: "endTurn",
					},
				},
			]);
			store.addSession({ sessionId: "s1", sessionPath: sessionFile, cwd: root, title: "AGI loop" });

			const result = await new AgiSupervisor({ store, driver }).tick();
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			expect(result.observed).toBe(1);
			expect(result.actionsCreated).toBe(1);
			expect(result.actionsCompleted).toBe(1);
			expect(result.score).toBe(60);
			expect(session.completionState.supervisorSatisfiedCriteria).toEqual([
				"completion_alarm_detected",
				"follow_up_turn_executed",
				"monitored_by_gateway",
			]);
			expect(driverCalls).toHaveLength(1);
			expect(driverCalls[0]).toContain("AGI_GATEWAY_RESULT");
			expect(store.listActions("s1")[0]).toMatchObject({ status: "completed", result: { stdout: "continued" } });
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("reaches score 100 only when all structured criteria are satisfied", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		let calls = 0;
		const driver: AgiActionDriver = {
			async run() {
				calls += 1;
				return { exitCode: 0, stdout: "unexpected", stderr: "" };
			},
		};
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeSessionFile(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "AGI done" },
				{
					type: "message",
					id: "a1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: 'AGI work is complete.\nAGI_GATEWAY_RESULT {"score":100,"complete":true,"satisfiedCriteria":["context_boundaries_preserved","initial_build_goal_complete"],"summary":"All AGI controls are wired."}',
							},
						],
						stopReason: "endTurn",
					},
				},
			]);
			const attached = store.addSession({ sessionId: "s1", sessionPath: sessionFile, cwd: root, title: "AGI done" });
			const completionState = buildAgiCompletionState(attached.goalSpec, {
				score: 60,
				complete: false,
				structuredResultSeen: false,
				summary: attached.completionState.summary,
				agentSatisfiedCriteria: [],
				supervisorSatisfiedCriteria: ["monitored_by_gateway", "follow_up_turn_executed"],
			});
			store.updateSession("s1", { score: 60, completionState });

			const result = await new AgiSupervisor({ store, driver, completionVerifier: () => true }).tick();
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			expect(result.score).toBe(100);
			expect(result.actionsCreated).toBe(0);
			expect(calls).toBe(0);
			expect(session.state).toBe("completed");
			expect(session.completionState.complete).toBe(true);
			expect(session.completionState.missingCriteria).toHaveLength(0);
			expect(session.completionState.lastStructuredResult).toMatchObject({ score: 100, complete: true });
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("moves sessions into waiting and then blocked after repeated action failures", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		let calls = 0;
		const driver: AgiActionDriver = {
			async run() {
				calls += 1;
				return { exitCode: 1, stdout: "", stderr: "model unavailable" };
			},
		};
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeSessionFile(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "AGI retry" },
				{
					type: "message",
					id: "a1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Need more AGI work." }],
						stopReason: "endTurn",
					},
				},
			]);
			store.addSession({ sessionId: "s1", sessionPath: sessionFile, cwd: root, title: "AGI retry" });

			for (let attempt = 1; attempt <= 3; attempt += 1) {
				const tick = await new AgiSupervisor({ store, driver, now: () => attempt * 1_000 }).tick();
				expect(tick.actionsCompleted).toBe(0);
				expect(tick.actionsCreated).toBe(1);
				const session = store.getSession("s1");
				if (!session) throw new Error("Expected session");
				if (attempt < 3) {
					expect(session.state).toBe("waiting");
					expect(session.controlState.retryCount).toBe(attempt);
					expect(session.controlState.nextRetryAt).toBeDefined();
					store.updateSession("s1", {
						controlState: {
							...session.controlState,
							nextRetryAt: 0,
						},
					});
					store.recordEvent(
						"s1",
						"session.turn_completed",
						{ summary: `retry ${attempt}` },
						{ id: `retry-${attempt}` },
					);
				} else {
					expect(session.state).toBe("blocked");
					expect(session.controlState.retryCount).toBe(3);
					expect(session.controlState.blockedReason).toContain("model unavailable");
				}
			}
			expect(calls).toBe(3);
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects an unverified completion claim and keeps the session incomplete", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		const driver: AgiActionDriver = {
			async run() {
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeCompletionClaimSession(root);
			store.addSession({ sessionId: "s1", sessionPath: sessionFile, cwd: root, title: "AGI claim" });

			const result = await new AgiSupervisor({
				store,
				driver,
				completionVerifier: () => false,
			}).tick();
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			// Claim was rejected: not complete, score below target, claim kept for audit.
			expect(session.completionState.complete).toBe(false);
			expect(result.score).toBeLessThan(100);
			expect(session.state).not.toBe("completed");
			expect(session.completionState.lastStructuredResult).toMatchObject({ complete: false, score: 100 });
			const events = store.listEvents("s1");
			expect(events.some(event => event.payload.completionClaimRejected === true)).toBe(true);
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("honors a completion claim when the verifier confirms it", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		const driver: AgiActionDriver = {
			async run() {
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		};
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeCompletionClaimSession(root);
			const attached = store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				title: "AGI claim",
			});
			// Pre-satisfy the supervisor-owned criteria so the agent claim is the last gate.
			const completionState = buildAgiCompletionState(attached.goalSpec, {
				score: 60,
				complete: false,
				structuredResultSeen: false,
				summary: attached.completionState.summary,
				agentSatisfiedCriteria: [],
				supervisorSatisfiedCriteria: ["monitored_by_gateway", "follow_up_turn_executed"],
			});
			store.updateSession("s1", { score: 60, completionState });

			const result = await new AgiSupervisor({
				store,
				driver,
				completionVerifier: () => true,
			}).tick();
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			expect(result.score).toBe(100);
			expect(session.state).toBe("completed");
			expect(session.completionState.complete).toBe(true);
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects mission-bound self-report completion without enough verifier evidence", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeSessionFile(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Mission claim" },
				{
					type: "message",
					id: "a1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: 'Done.\nAGI_GATEWAY_RESULT {"score":100,"complete":true,"satisfiedCriteria":["mission_criterion_1"],"summary":"Claimed complete."}',
							},
						],
						stopReason: "endTurn",
					},
				},
			]);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				missionId: "mission-1",
				objective: "Ship the bridge",
				criteria: ["Bridge persists mission fields"],
			});

			await new AgiSupervisor({
				store,
				driver: {
					async run() {
						return { exitCode: 0, stdout: "", stderr: "" };
					},
				},
				completionVerifier: createFailClosedAgiCompletionVerifier(),
			}).tick();

			const session = store.getSession("s1");
			expect(session?.state).not.toBe("completed");
			expect(session?.completionState.complete).toBe(false);
			expect(store.listEvents("s1").some(event => event.payload.completionClaimRejected === true)).toBe(true);
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("evidence verifier rejects self-report until mission criteria have non-agent evidence", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-evidence-verifier-"));
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeCompletionClaimSession(root);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				title: "Evidence claim",
				missionId: "mission-1",
				objective: "Ship evidence verifier",
				criteria: ["Verifier rejects self-report"],
				evidenceRefs: ["test-output:agi/evidence-verifier"],
			});
			const verifier = new EvidenceVerifier({ gatewayStore: store });
			const session = store.getSession("s1");
			if (!session) throw new Error("Expected session");

			expect(await verifier.verify(session, { score: 100, complete: true, satisfiedCriteria: [] })).toBe(false);

			store.updateSession("s1", {
				evidenceRefs: ["test-output:agi/evidence-verifier", "criterion:mission_criterion_1"],
			});
			const evidenced = store.getSession("s1");
			if (!evidenced) throw new Error("Expected session");
			expect(await verifier.verify(evidenced, { score: 100, complete: true, satisfiedCriteria: [] })).toBe(true);
			expect(verifier.collectSources(evidenced)).toContainEqual({
				type: "test-output",
				ref: "test-output:agi/evidence-verifier",
			});
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("uses objective and unsatisfied mission criteria in follow-up instructions", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "amaze-agi-supervisor-"));
		const driverCalls: string[] = [];
		const store = new AgiGatewayStore(":memory:");
		try {
			const sessionFile = await makeSessionFile(root, [
				{ type: "session", id: "s1", timestamp: new Date().toISOString(), cwd: root, title: "Mission follow-up" },
				{
					type: "message",
					id: "a1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Progress made." }],
						stopReason: "endTurn",
					},
				},
			]);
			store.addSession({
				sessionId: "s1",
				sessionPath: sessionFile,
				cwd: root,
				missionId: "mission-1",
				objective: "Deliver mission-aware AGI follow-up",
				criteria: ["Persist session mission fields", "Mention unsatisfied verifier criteria"],
			});

			await new AgiSupervisor({
				store,
				driver: {
					async run(action) {
						driverCalls.push(action.instruction);
						return { exitCode: 0, stdout: "ok", stderr: "" };
					},
				},
			}).tick();

			expect(driverCalls[0]).toContain("Mission objective: Deliver mission-aware AGI follow-up");
			expect(driverCalls[0]).toContain("mission_criterion_1: Persist session mission fields");
			expect(driverCalls[0]).toContain("mission_criterion_2: Mention unsatisfied verifier criteria");
			expect(driverCalls[0]).not.toContain("initial AGI build goal");
		} finally {
			store.close();
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
