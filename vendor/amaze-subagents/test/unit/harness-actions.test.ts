/// <reference types="node" />

import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createSubagentExecutor } from "../../src/runs/foreground/subagent-executor.ts";

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

function ctx() {
	return {
		cwd: process.cwd(),
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
});
