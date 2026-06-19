/// <reference types="node" />

import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createSubagentExecutor } from "../../src/runs/foreground/subagent-executor.ts";
import { validateHarnessValidatorContract } from "../../src/harness/validator-contract.ts";

function createState() {
	return {
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		backgroundRuns: new Map(),
		backgroundRunCounter: 0,
		baseCwd: process.cwd(),
		sessions: [],
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function createExecutor() {
	return createSubagentExecutor({
		pi: { events: { emit() {}, on() { return () => {}; } }, getSessionName() { return "parent"; } } as any,
		state: createState() as any,
		config: { maxSubagentDepth: 2, control: {}, intercomBridge: {} } as any,
		asyncByDefault: false,
		tempArtifactsDir: os.tmpdir(),
		getSubagentSessionRoot: (parentSessionFile?: string | null) => parentSessionFile
			? path.join(path.dirname(parentSessionFile), path.basename(parentSessionFile, ".jsonl"))
			: os.tmpdir(),
		expandTilde: (value: string) => value,
		discoverAgents: () => ({ agents: [] }),
		allowMutatingManagementActions: true,
	});
}

function ctx(cwd = process.cwd()) {
	return {
		cwd,
		hasUI: false,
		sessionManager: { getSessionId() { return "session"; }, getSessionFile() { return null; } },
		modelRegistry: { getAvailable() { return []; } },
	} as any;
}

function bootContract(): any {
	return {
		boot_id: "boot-runtime-001",
		mission_id: "mission-runtime",
		contract_id: "runtime-state-model",
		boot_mode: "fresh",
		parent_context: {
			inherit_conversation: false,
			inherit_system_prompt: false,
			inherit_tools: false,
			inherit_skills: false,
		},
		specialist: {
			path_id: "folder.packages_coding_agent.src.runtime",
			owned_path: "packages/coding-agent/src/runtime",
			memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
		},
		context_packet: {
			packet_id: "ctx-runtime-001",
			path: ".harness/context/packets/ctx-runtime-001.json",
		},
		memory_attachments: [{
			attachment_id: "mem-runtime-001",
			path_id: "folder.packages_coding_agent.src.runtime",
			memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
			include: {},
			mode: "read_only",
			budget: {},
		}],
		execution_contract: {
			contract_id: "runtime-state-model",
			assigned_path: "packages/coding-agent/src/runtime",
			assigned_specialist: "folder.packages_coding_agent.src.runtime",
			goal: "Add durable runtime task state model.",
			owned_paths: ["packages/coding-agent/src/runtime/**"],
			read_allowed_paths: ["packages/coding-agent/src/session/**"],
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
			write_denied_paths: ["**/*"],
			activity_budget: {
				max_tool_uses: 40,
				max_tokens: 80_000,
				max_elapsed_ms: 180_000,
			},
			acceptance: {
				must_change: ["Durable runtime task state model exists."],
				must_not_change: ["Session bootstrap files."],
				validation_commands: ["npm run test:unit"],
			},
			output_required: ["summary", "files_changed", "tests_run", "risks", "change_requests", "memory_updates"],
		},
	};
}

function text(result: Awaited<ReturnType<ReturnType<typeof createExecutor>["execute"]>>): string {
	return result.content[0]?.type === "text" ? result.content[0].text : "";
}

describe("harness actions", () => {
	it("validates a FreshBootContract without starting a child process", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "harness_validate_contract",
			bootContract: bootContract(),
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, undefined);
		const body = JSON.parse(text(result));
		assert.equal(body.status, "valid");
		assert.equal(body.contract_id, "runtime-state-model");
		assert.equal(body.assigned_specialist, "folder.packages_coding_agent.src.runtime");
		assert.equal(body.validator_contract.checks.memory_updates.attachment_count, 1);
		assert.deepEqual(body.errors, []);
	});

	it("rejects invalid harness contracts before execution", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "harness_validate_contract",
			bootContract: { ...bootContract(), boot_mode: "fork" },
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, true);
		assert.match(text(result), /Invalid FreshBootContract/);
	});

	it("rejects FreshBootContract subcontracts that fail validator-contract checks", async () => {
		const contract = bootContract();
		contract.execution_contract.assigned_specialist = "folder.packages_coding_agent.src.session";
		const result = await createExecutor().execute("run-1", {
			action: "harness_validate_contract",
			bootContract: contract,
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, true);
		const body = JSON.parse(text(result));
		assert.equal(body.status, "invalid");
		assert.match(body.errors.join("\n"), /assigned_specialist must match specialist\.path_id/);
	});

	it("requires bootContract for harness_run_contract", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "harness_run_contract",
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, true);
		assert.match(text(result), /requires bootContract/);
	});

	it("compiles mission profiles through the executor harness action", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "harness_compile_mission",
			id: "mission-docs",
			task: "README 오타 한 줄만 수정해줘",
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, undefined);
		const parsed = JSON.parse(text(result)) as {
			missionId: string;
			route: { baseRuntime: string; validatorPack: string };
			policy: { runtime: string; validatorPack: string };
		};
		assert.equal(parsed.missionId, "mission-docs");
		assert.equal(parsed.route.baseRuntime, "micro-direct");
		assert.equal(parsed.route.validatorPack, "basic-diff");
		assert.equal(parsed.policy.runtime, "micro-direct");
	});

	it("compiles profiled orchestration into FreshBootContract-only child invocations", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "orchestrate",
			id: "mission-runtime",
			task: "Fix the subagent runtime so profile orchestration creates worker and reviewer contracts",
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, undefined);
		const parsed = JSON.parse(text(result)) as {
			missionId: string;
			policy: { agentPolicy: { agentType: string } };
			executionPlan: {
				mode: string;
				childExecution: string;
				contextBoundary: {
					freshBootOnly: boolean;
					parentContextDisabled: boolean;
					contextFilesDisabled: boolean;
					skillsDisabled: boolean;
				};
				steps: Array<{
					role: string;
					action: string;
					bootContract: {
						boot_mode: string;
						parent_context: {
							inherit_conversation: boolean;
							inherit_system_prompt: boolean;
							inherit_tools: boolean;
							inherit_skills: boolean;
						};
						execution_contract: {
							assigned_specialist: string;
							assigned_path: string;
							output_required: string[];
							tool_policy: {
								xenonite_first: boolean;
								core_tools_available: boolean;
								skills_available: boolean;
								parent_tool_inheritance: boolean;
							};
							coordination: {
								irc_required: boolean;
								orchestrator_contact: string;
								goal_updates_allowed: boolean;
							};
						};
					};
				}>;
			};
		};
		assert.equal(parsed.missionId, "mission-runtime");
		assert.equal(parsed.executionPlan.mode, "profiled_orchestration");
		assert.equal(parsed.executionPlan.childExecution, "harness_run_contract_only");
		assert.deepEqual(parsed.executionPlan.contextBoundary, {
			freshBootOnly: true,
			parentContextDisabled: true,
			contextFilesDisabled: true,
			skillsDisabled: false,
		});
		assert.deepEqual(parsed.executionPlan.steps.map((step) => step.role), ["scout", "planner", "worker", "reviewer"]);
		for (const step of parsed.executionPlan.steps) {
			assert.equal(step.action, "harness_run_contract");
			assert.equal(step.bootContract.boot_mode, "fresh");
			assert.equal(validateHarnessValidatorContract(step.bootContract as any).status, "valid");
			assert.deepEqual(step.bootContract.parent_context, {
				inherit_conversation: false,
				inherit_system_prompt: false,
				inherit_tools: false,
				inherit_skills: false,
			});
			assert.ok(step.bootContract.execution_contract.assigned_specialist);
			assert.ok(step.bootContract.execution_contract.assigned_path);
			assert.deepEqual(step.bootContract.execution_contract.tool_policy, {
				xenonite_first: true,
				core_tools_available: true,
				skills_available: true,
				parent_tool_inheritance: false,
			});
			assert.deepEqual(step.bootContract.execution_contract.coordination, {
				irc_required: true,
				orchestrator_contact: "intercom",
				goal_updates_allowed: true,
			});
			assert.ok(step.bootContract.execution_contract.output_required.includes("memory_updates"));
		}
	});

	it("fans out workers by mentioned folder paths", async () => {
		const result = await createExecutor().execute("run-1", {
			action: "orchestrate",
			id: "mission-folders",
			task: "Update packages/coding-agent/src/core and vendor/amaze-subagents/src/runs for orchestration",
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, undefined);
		const parsed = JSON.parse(text(result)) as {
			executionPlan: {
				steps: Array<{
					role: string;
					bootContract: { execution_contract: { assigned_path: string } };
				}>;
			};
		};
		const workerPaths = parsed.executionPlan.steps
			.filter((step) => step.role === "worker")
			.map((step) => step.bootContract.execution_contract.assigned_path);
		assert.deepEqual(workerPaths, ["packages/coding-agent/src/core", "vendor/amaze-subagents/src/runs"]);
	});

	it("defaults task-only subagent calls to profiled orchestration", async () => {
		const result = await createExecutor().execute("run-1", {
			id: "mission-default",
			task: "Fix the subagent runtime so profile orchestration is the default path",
		}, new AbortController().signal, undefined, ctx());

		assert.equal(result.isError, undefined);
		const parsed = JSON.parse(text(result)) as {
			missionId: string;
			executionPlan: {
				mode: string;
				childExecution: string;
				steps: Array<{ role: string; action: string }>;
			};
		};
		assert.equal(parsed.missionId, "mission-default");
		assert.equal(parsed.executionPlan.mode, "profiled_orchestration");
		assert.equal(parsed.executionPlan.childExecution, "harness_run_contract_only");
		assert.deepEqual(parsed.executionPlan.steps.map((step) => step.role), ["scout", "planner", "worker", "reviewer"]);
		assert.deepEqual([...new Set(parsed.executionPlan.steps.map((step) => step.action))], ["harness_run_contract"]);
	});

	it("starts mission profiles and persists mission state", async () => {
		const tempDir = path.join(os.tmpdir(), `amaze-harness-mission-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		const result = await createExecutor().execute("run-1", {
			action: "harness_start_mission",
			id: "mission-helm",
			task: "Helm chart에 prod-safe resource policy 넣어줘",
			cwd: tempDir,
		}, new AbortController().signal, undefined, ctx(tempDir));

		assert.equal(result.isError, undefined);
		const parsed = JSON.parse(text(result)) as {
			missionId: string;
			record: { status: string; final_route?: { baseRuntime: string; validatorPack: string } };
			policy: { runtime: string; validatorPack: string };
		};
		assert.equal(parsed.missionId, "mission-helm");
		assert.equal(parsed.record.status, "POLICY_COMPILED");
		assert.equal(parsed.record.final_route?.baseRuntime, "infra-k8s");
		assert.equal(parsed.policy.validatorPack, "infra-k8s");
	});
});
