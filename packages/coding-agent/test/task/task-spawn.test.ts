/**
 * Contracts: task tool spawn routing (rework-contracts.md §3).
 *
 * 1. With an AsyncJobManager wired, `execute` returns immediately (agent id +
 *    job id) while the job body is still gated; successful job completion is
 *    retained for polling/history without waking the parent, while failures
 *    deliver a result carrying the `history://<id>` hint.
 * 2. The session-scoped spawn semaphore (task.maxConcurrency) serializes job
 *    bodies: with concurrency 1 the second body does not start until the
 *    first releases.
 *
 * Param validation (missing agent / missing assignment) is covered by
 * test/task/task-schema.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AsyncJobManager, type AsyncJobManagerOptions } from "@amaze/pi-coding-agent/async/job-manager";
import { Settings } from "@amaze/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@amaze/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@amaze/pi-coding-agent/registry/agent-registry";
import { TaskTool } from "@amaze/pi-coding-agent/task";
import * as discoveryModule from "@amaze/pi-coding-agent/task/discovery";
import * as executorModule from "@amaze/pi-coding-agent/task/executor";
import { AgentOutputManager } from "@amaze/pi-coding-agent/task/output-manager";
import type { AgentDefinition, SingleResult, TaskParams } from "@amaze/pi-coding-agent/task/types";
import type { ToolSession } from "@amaze/pi-coding-agent/tools";

const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	source: "bundled",
};

const checkerAgent: AgentDefinition = {
	name: "checker",
	description: "Review, challenge, risk checks, and adversarial second opinions",
	systemPrompt: "You are a checker agent.",
	source: "bundled",
};

function createSession(options: { manager?: AsyncJobManager; settings?: Record<string, unknown> }): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(options.settings ?? {}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		asyncJobManager: options.manager,
		agentOutputManager: new AgentOutputManager(() => null),
	} as unknown as ToolSession;
}

function getFirstText(result: { content: Array<{ type: string; text?: string }> }): string {
	const content = result.content.find(part => part.type === "text");
	return content?.type === "text" ? (content.text ?? "") : "";
}

function makeResult(id: string, overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id,
		agent: "task",
		agentSource: "bundled",
		task: "task prompt",
		assignment: "Do the thing.",
		exitCode: 0,
		output: "All done.",
		stderr: "",
		truncated: false,
		durationMs: 5,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { promise, resolve };
}

async function pollUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

describe("task spawn routing", () => {
	const managers: AsyncJobManager[] = [];

	function createManager(onJobComplete: AsyncJobManagerOptions["onJobComplete"] = () => {}): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete });
		managers.push(manager);
		return manager;
	}

	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const manager of managers.splice(0)) {
			await manager.dispose({ timeoutMs: 1000 });
		}
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("returns immediately on spawn and retains successful completion without parent delivery", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const gate = deferred();
		const runSpy = vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			await gate.promise;
			return makeResult(options.id ?? "?");
		});

		const onJobComplete = vi.fn();
		const manager = createManager(onJobComplete);
		const tool = await TaskTool.create(createSession({ manager }));

		const result = await tool.execute("tc-spawn", {
			agent: "task",
			id: "Spawnling",
			description: "background work",
			assignment: "Do the thing.",
		} as TaskParams);

		// Tool returned while the job body is still gated on the deferred.
		const text = getFirstText(result);
		expect(text).toContain("Spawned agent `Spawnling`");
		expect(text).toContain("Use `irc` only while it runs");
		expect(text).toContain("read `history://Spawnling`");
		expect(text).toContain("Failures will surface automatically");
		const jobId = result.details?.async?.jobId;
		expect(jobId).toBeTruthy();
		expect(text).toContain(`job \`${jobId}\``);
		const job = manager.getJob(jobId!);
		expect(job?.status).toBe("running");
		expect(job?.resultText).toBeUndefined();

		gate.resolve();
		await job!.promise;

		expect(job!.status).toBe("completed");
		expect(job!.resultText).toContain("Spawnling completed");
		expect(job!.resultText).toContain("transcript at history://Spawnling");
		expect(onJobComplete).not.toHaveBeenCalled();
		expect(runSpy).toHaveBeenCalledTimes(1);
	});

	it("names unnamed background spawns after the selected subagent kind", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [checkerAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => makeResult(options.id ?? "?"));

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager }));

		const first = await tool.execute("tc-checker-1", {
			agent: "checker",
			assignment: "Review the sign-in flow.",
		} as TaskParams);
		const second = await tool.execute("tc-checker-2", {
			agent: "checker",
			assignment: "Review the auth broker flow.",
		} as TaskParams);

		expect(first.details?.progress?.map(progress => progress.id)).toEqual(["Checker"]);
		expect(second.details?.progress?.map(progress => progress.id)).toEqual(["Checker-2"]);
		expect(getFirstText(first)).toContain("Spawned agent `Checker`");
		expect(getFirstText(second)).toContain("Spawned agent `Checker-2`");
		expect(manager.getJob("Checker")).toBeDefined();
		expect(manager.getJob("Checker-2")).toBeDefined();

		await manager.getJob("Checker")!.promise;
		await manager.getJob("Checker-2")!.promise;
	});

	it("passes a contract launch spec into the subagent executor", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const seenSpecs: unknown[] = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			seenSpecs.push(options.launchSpec);
			return makeResult(options.id ?? "?");
		});

		const manager = createManager();
		const tool = await TaskTool.create(
			createSession({
				manager,
				settings: {
					"task.agentModelOverrides": {
						task: "codex_high",
					},
				},
			}),
		);

		const result = await tool.execute("tc-launch-spec", {
			agent: "task",
			id: "SpecSpawn",
			role: "Risk auditor",
			assignment: "Check the thing.",
		} as TaskParams);
		const job = manager.getJob(result.details!.async!.jobId)!;
		await job.promise;

		expect(seenSpecs).toHaveLength(1);
		expect(seenSpecs[0]).toMatchObject({
			id: "SpecSpawn",
			agentName: "task",
			displayName: "Risk auditor",
			contextProfile: "contract",
			modelProfile: {
				key: "codex_high",
				selector: ["codex_high"],
			},
			irc: {
				revivable: false,
			},
			memory: {
				mode: "off",
			},
			extensions: {
				allowContextHooks: false,
			},
		});
	});

	it("delivers failed background task output through async delivery", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockResolvedValue(
			makeResult("BrokenSpawn", {
				exitCode: 1,
				output: "Could not finish.",
				stderr: "boom",
			}),
		);
		const deliveries: Array<{ jobId: string; text: string }> = [];
		const manager = createManager((jobId, text) => {
			deliveries.push({ jobId, text });
		});
		const tool = await TaskTool.create(createSession({ manager }));

		const result = await tool.execute("tc-spawn-fail", {
			agent: "task",
			id: "BrokenSpawn",
			description: "background work",
			assignment: "Do the thing.",
		} as TaskParams);
		const jobId = result.details?.async?.jobId;
		if (!jobId) throw new Error("Expected async job id");
		const job = manager.getJob(jobId);
		if (!job) throw new Error("Expected async job");

		await job.promise;
		await manager.drainDeliveries({ timeoutMs: 2_000 });

		expect(job.status).toBe("failed");
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toEqual({
			jobId,
			text: expect.stringContaining("BrokenSpawn failed"),
		});
		expect(deliveries[0]?.text).toContain("transcript at history://BrokenSpawn");
	});

	it("bounds concurrent job bodies with the session spawn semaphore", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const started: string[] = [];
		const gates = new Map<string, Deferred>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			started.push(id);
			const gate = deferred();
			gates.set(id, gate);
			await gate.promise;
			return makeResult(id);
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager, settings: { "task.maxConcurrency": 1 } }));

		const first = await tool.execute("tc-1", { agent: "task", id: "First", assignment: "Work A." } as TaskParams);
		const second = await tool.execute("tc-2", { agent: "task", id: "Second", assignment: "Work B." } as TaskParams);
		const firstJob = manager.getJob(first.details!.async!.jobId)!;
		const secondJob = manager.getJob(second.details!.async!.jobId)!;

		// First job body reaches the executor; second stays parked at the
		// semaphore — still flagged queued because markRunning never ran.
		await pollUntil(() => started.length >= 1);
		expect(started).toEqual(["First"]);
		expect(secondJob.queued).toBe(true);

		// Releasing the first body lets the second one start.
		gates.get(started[0]!)!.resolve();
		await firstJob.promise;
		await pollUntil(() => started.length === 2);
		expect(started).toEqual(["First", "Second"]);

		gates.get("Second")!.resolve();
		await secondJob.promise;
		expect(firstJob.status).toBe("completed");
		expect(secondJob.status).toBe("completed");
	});
	it("defaults async spawn fan-out to one concurrent job", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		const started: string[] = [];
		const gates = new Map<string, Deferred>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const id = options.id ?? "?";
			started.push(id);
			const gate = deferred();
			gates.set(id, gate);
			await gate.promise;
			return makeResult(id);
		});

		const manager = createManager();
		const tool = await TaskTool.create(createSession({ manager }));

		const first = await tool.execute("tc-default-1", {
			agent: "task",
			id: "FirstDefault",
			assignment: "Work A.",
		} as TaskParams);
		const second = await tool.execute("tc-default-2", {
			agent: "task",
			id: "SecondDefault",
			assignment: "Work B.",
		} as TaskParams);
		const firstJob = manager.getJob(first.details!.async!.jobId)!;
		const secondJob = manager.getJob(second.details!.async!.jobId)!;

		await pollUntil(() => started.length >= 1);
		expect(started).toEqual(["FirstDefault"]);
		expect(secondJob.queued).toBe(true);

		gates.get(started[0]!)!.resolve();
		await firstJob.promise;
		await pollUntil(() => started.length === 2);
		expect(started).toEqual(["FirstDefault", "SecondDefault"]);

		gates.get("SecondDefault")!.resolve();
		await secondJob.promise;
		expect(firstJob.status).toBe("completed");
		expect(secondJob.status).toBe("completed");
	});
});
