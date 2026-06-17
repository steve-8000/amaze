/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFreshBootContract } from "../../src/harness/fresh-boot-contract.ts";
import {
	deriveHarnessValidatorContract,
	validateHarnessValidatorContract,
} from "../../src/harness/validator-contract.ts";

function bootContract(overrides: Record<string, unknown> = {}) {
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
		...overrides,
	};
}

function parse(input: Record<string, unknown>) {
	const contract = parseFreshBootContract(input);
	assert.ok(contract);
	return contract;
}

describe("validator contract", () => {
	it("derives a validator contract from FreshBootContract subcontracts", () => {
		const contract = parse(bootContract());
		const validator = deriveHarnessValidatorContract(contract);

		assert.equal(validator.contract_id, "runtime-state-model");
		assert.equal(validator.assigned_specialist, "folder.packages_coding_agent.src.runtime");
		assert.deepEqual(validator.checks.path_boundaries.write_allowed_paths, ["packages/coding-agent/src/runtime/**"]);
		assert.deepEqual(validator.checks.output_required, ["summary", "files_changed", "tests_run", "risks", "change_requests", "memory_updates"]);
		assert.equal(validator.checks.memory_updates.read_only_attachments, true);
		assert.equal(validator.checks.memory_updates.attachment_count, 1);
		assert.equal(validator.checks.memory_updates.xenonite_namespace, "path:packages/coding-agent/src/runtime");
	});

	it("reports valid contracts with no errors", () => {
		const report = validateHarnessValidatorContract(parse(bootContract()));

		assert.equal(report.status, "valid");
		assert.deepEqual(report.errors, []);
		assert.equal(report.validator_contract.checks.activity_budget.max_tool_uses, 40);
	});

	it("rejects mismatched specialist, memory attachment, and budget subcontracts", () => {
		const report = validateHarnessValidatorContract(parse(bootContract({
			memory_attachments: [{
				attachment_id: "mem-session-001",
				path_id: "folder.packages_coding_agent.src.session",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/session",
				xenonite_namespace: "path:packages/coding-agent/src/session",
				include: {},
				mode: "read_only",
				budget: {},
			}],
			execution_contract: {
				...(bootContract().execution_contract as Record<string, unknown>),
				assigned_specialist: "folder.packages_coding_agent.src.session",
				activity_budget: {
					max_tool_uses: 0,
					max_tokens: 80_000,
					max_elapsed_ms: 180_000,
				},
			},
		})));

		assert.equal(report.status, "invalid");
		assert.match(report.errors.join("\n"), /assigned_specialist must match specialist\.path_id/);
		assert.match(report.errors.join("\n"), /memory_attachments\[0\]\.path_id/);
		assert.match(report.errors.join("\n"), /xenonite_namespace/);
		assert.match(report.errors.join("\n"), /max_tool_uses must be greater than zero/);
	});
});
