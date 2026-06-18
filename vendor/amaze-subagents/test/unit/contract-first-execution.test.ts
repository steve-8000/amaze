/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeContractFirstExecution } from "../../src/runs/foreground/subagent-executor.ts";

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

describe("contract-first execution normalization", () => {
	it("derives single-run agent and task from a top-level FreshBootContract", () => {
		const normalized = normalizeContractFirstExecution({ bootContract: bootContract() }, []);

		assert.equal(normalized.error, undefined);
		assert.equal(normalized.params.agent, "folder.packages_coding_agent.src.runtime");
		assert.equal(normalized.params.context, "fresh");
		assert.match(String(normalized.params.task), /Add durable runtime task state model/);
		assert.match(String(normalized.params.task), /Required output fields: summary, files_changed, tests_run, risks, change_requests, memory_updates/);
		assert.match(String(normalized.params.task), /acceptance_report/);
		assert.equal(normalized.agents.length, 1);
		assert.equal(normalized.agents[0]?.name, "folder.packages_coding_agent.src.runtime");
		assert.equal(normalized.agents[0]?.defaultContext, "fresh");
		assert.equal(normalized.agents[0]?.inheritProjectContext, false);
		assert.equal(normalized.agents[0]?.inheritSkills, false);
	});

	it("reuses an existing agent when the contract specialist is already registered", () => {
		const existing = {
			name: "folder.packages_coding_agent.src.runtime",
			localName: "folder.packages_coding_agent.src.runtime",
			description: "existing path specialist",
			systemPrompt: "existing",
			systemPromptMode: "replace" as const,
			inheritProjectContext: false,
			inheritSkills: false,
			defaultContext: "fresh" as const,
			source: "project" as const,
			filePath: "agents/runtime.md",
		};
		const normalized = normalizeContractFirstExecution({ bootContract: bootContract() }, [existing]);

		assert.equal(normalized.error, undefined);
		assert.equal(normalized.agents.length, 1);
		assert.equal(normalized.agents[0], existing);
	});

	it("rejects non-fresh or incomplete boot contracts before execution", () => {
		const invalid = normalizeContractFirstExecution({
			bootContract: { ...bootContract(), boot_mode: "fork" },
		}, []);

		assert.match(String(invalid.error), /Invalid FreshBootContract/);
		assert.equal(invalid.params.agent, undefined);
		assert.equal(invalid.agents.length, 0);
	});
});
