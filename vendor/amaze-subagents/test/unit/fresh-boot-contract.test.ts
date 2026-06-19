/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	FRESH_BOOT_CONTRACT_ENV,
	freshBootContractToPathContract,
	freshBootContractToPathMemoryPacket,
	parseFreshBootContract,
	renderFreshBootContract,
	type FreshBootContract,
} from "../../src/harness/fresh-boot-contract.ts";
import { PATH_CONTRACT_ENV } from "../../src/harness/path-contract.ts";
import { PATH_MEMORY_PACKET_ENV } from "../../src/harness/path-memory.ts";
import { buildPiArgs } from "../../src/runs/shared/amaze-args.ts";
import { rewriteSubagentPrompt } from "../../src/runs/shared/subagent-prompt-runtime.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-fresh-boot-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function contractInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
			include: {
				profile: true,
				conventions: true,
				recent_decisions: 10,
				known_failures: 5,
				incidents: 3,
				contract_summaries: 5,
			},
			mode: "read_only",
			budget: { max_tokens: 6000 },
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
		...overrides,
	};
}

function makeContract(overrides: Record<string, unknown> = {}): FreshBootContract {
	const parsed = parseFreshBootContract(contractInput(overrides));
	assert.ok(parsed);
	return parsed;
}

describe("fresh boot contract", () => {
	it("accepts only fresh boot contracts with no parent inheritance", () => {
		const contract = makeContract();
		assert.equal(contract.boot_mode, "fresh");
		assert.deepEqual(contract.parent_context, {
			inherit_conversation: false,
			inherit_system_prompt: false,
			inherit_tools: false,
			inherit_skills: false,
		});
		assert.deepEqual(contract.execution_contract.tool_policy, {
			xenonite_first: true,
			core_tools_available: true,
			skills_available: true,
			parent_tool_inheritance: false,
		});
		assert.deepEqual(contract.execution_contract.coordination, {
			irc_required: true,
			orchestrator_contact: "intercom",
			goal_updates_allowed: true,
		});
		assert.match(renderFreshBootContract(contract), /Harness Fresh Boot Contract/);

		assert.equal(parseFreshBootContract(contractInput({ boot_mode: "fork" })), undefined);
		assert.equal(parseFreshBootContract(contractInput({
			parent_context: {
				inherit_conversation: true,
				inherit_system_prompt: false,
				inherit_tools: false,
				inherit_skills: false,
			},
		})), undefined);
	});

	it("derives path memory and write boundary contracts from the boot contract", () => {
		const contract = makeContract();
		const memoryPacket = freshBootContractToPathMemoryPacket(contract);
		assert.equal(memoryPacket.packet_id, "ctx-runtime-001");
		assert.equal(memoryPacket.contract_id, "runtime-state-model");
		assert.equal(memoryPacket.memory_scope?.path_id, "folder.packages_coding_agent.src.runtime");
		assert.equal(memoryPacket.memory_scope?.xenonite_namespace, "path:packages/coding-agent/src/runtime");
		assert.equal(memoryPacket.memory_attachments?.[0]?.mode, "read_only");

		const pathContract = freshBootContractToPathContract(contract);
		assert.equal(pathContract.contract_id, "runtime-state-model");
		assert.equal(pathContract.assigned_worker, "folder.packages_coding_agent.src.runtime");
		assert.deepEqual(pathContract.read_allowed_paths, ["packages/coding-agent/src/session/**"]);
		assert.deepEqual(pathContract.write_allowed_paths, ["packages/coding-agent/src/runtime/**"]);
		assert.deepEqual(pathContract.activity_budget, {
			max_tool_uses: 40,
			max_tokens: 80_000,
			max_elapsed_ms: 180_000,
		});
	});

	it("builds fresh-only child args and injects derived packet files", () => {
		const repo = makeTempDir();
		const contract = makeContract();
		const { args, env, tempDir } = buildPiArgs({
			baseArgs: ["-p"],
			task: "Implement the contract.",
			sessionEnabled: true,
			sessionFile: path.join(repo, "parent-session.jsonl"),
			model: undefined,
			thinking: undefined,
			systemPromptMode: "append",
			inheritProjectContext: true,
			inheritSkills: true,
			tools: ["read", "subagent"],
			extensions: [],
			cwd: repo,
			bootContract: contract,
		});
		if (tempDir) tempDirs.push(tempDir);

		assert.ok(args.includes("--no-session"));
		assert.equal(args.includes("--session"), false);
		assert.ok(args.includes("--no-context-files"));
		assert.equal(args.includes("--no-skills"), false);
		assert.equal(env.PI_SUBAGENT_INHERIT_PROJECT_CONTEXT, "0");
		assert.equal(env.PI_SUBAGENT_INHERIT_SKILLS, "0");
		assert.equal(env.PI_SUBAGENT_FANOUT_CHILD, "0");
		assert.ok(env[FRESH_BOOT_CONTRACT_ENV]);
		assert.ok(env[PATH_MEMORY_PACKET_ENV]);
		assert.ok(env[PATH_CONTRACT_ENV]);
		assert.match(fs.readFileSync(env[FRESH_BOOT_CONTRACT_ENV]!, "utf-8"), /Harness Fresh Boot Contract/);
		assert.match(fs.readFileSync(env[PATH_MEMORY_PACKET_ENV]!, "utf-8"), /Path Memory Packet/);
		assert.match(fs.readFileSync(env[PATH_CONTRACT_ENV]!, "utf-8"), /Path Execution Contract/);
	});

	it("renders the fresh boot packet into the child prompt without parent inheritance", () => {
		const rewritten = rewriteSubagentPrompt([
			"base before",
			"",
			"# Project Context",
			"",
			"Project-specific instructions and guidelines:",
			"",
			"legacy-project-context",
			"",
			"Current date: 2026-06-17",
			"",
			"base after",
		].join("\n"), {
			inheritProjectContext: false,
			inheritSkills: false,
			freshBootContractPacket: renderFreshBootContract(makeContract()),
		});

		assert.match(rewritten, /FreshBootContract/);
		assert.match(rewritten, /Harness Fresh Boot Contract/);
		assert.doesNotMatch(rewritten, /legacy-project-context/);
	});
});
