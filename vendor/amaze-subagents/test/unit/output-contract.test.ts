/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFreshBootContract } from "../../src/harness/fresh-boot-contract.ts";
import {
	outputSchemaForFreshBootContract,
	validateFreshBootOutputContract,
} from "../../src/harness/output-contract.ts";
import { validateStructuredOutputValue } from "../../src/runs/shared/structured-output.ts";

function makeBootContract() {
	const contract = parseFreshBootContract({
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
	});
	assert.ok(contract);
	return contract;
}

describe("fresh boot output contract", () => {
	it("derives a structured output schema from output_required", () => {
		const schema = outputSchemaForFreshBootContract(makeBootContract());

		assert.equal(schema.type, "object");
		assert.deepEqual(schema.required, ["summary", "files_changed", "tests_run", "risks", "change_requests", "memory_updates"]);
		assert.equal(validateStructuredOutputValue(schema, {
			summary: "Implemented runtime state.",
			files_changed: ["packages/coding-agent/src/runtime/state.ts"],
			tests_run: ["npm run test:unit"],
			risks: [],
			change_requests: [],
			memory_updates: [],
			acceptance_report: {
				criteriaSatisfied: [{ id: "contract-output", status: "satisfied", evidence: "validated" }],
				changedFiles: ["packages/coding-agent/src/runtime/state.ts"],
				testsAddedOrUpdated: [],
				commandsRun: [{ command: "npm run test:unit", result: "passed", summary: "passed" }],
				validationOutput: ["passed"],
				residualRisks: [],
				noStagedFiles: true,
			},
		}).status, "valid");
		const invalid = validateStructuredOutputValue(schema, {
			summary: "Missing fields",
			files_changed: [],
		});
		assert.equal(invalid.status, "invalid");
		if (invalid.status === "invalid") assert.match(invalid.message, /tests_run|risks|change_requests|memory_updates/);
	});

	it("merges boot required fields with an explicit outputSchema", () => {
		const schema = outputSchemaForFreshBootContract(makeBootContract(), {
			type: "object",
			properties: {
				summary: { type: "string", minLength: 10 },
				extra_metric: { type: "number" },
			},
			required: ["extra_metric"],
			additionalProperties: false,
		});

		assert.deepEqual(schema.required, ["extra_metric", "summary", "files_changed", "tests_run", "risks", "change_requests", "memory_updates"]);
		assert.deepEqual((schema.properties as Record<string, unknown>).summary, { type: "string", minLength: 10 });
		assert.equal(schema.additionalProperties, false);
		assert.equal(validateStructuredOutputValue(schema, {
			summary: "Implemented runtime state.",
			extra_metric: 1,
			files_changed: [],
			tests_run: [],
			risks: [],
			change_requests: [],
			memory_updates: [],
			acceptance_report: {
				criteriaSatisfied: [{ id: "extra", status: "satisfied", evidence: "validated" }],
				commandsRun: [],
				residualRisks: [],
				noStagedFiles: true,
			},
		}).status, "valid");
	});

	it("validates completed structured output against the FreshBootContract fields", () => {
		const contract = makeBootContract();

		assert.deepEqual(validateFreshBootOutputContract(contract, {
			summary: "Implemented runtime state.",
			files_changed: [],
			tests_run: [],
			risks: [],
			change_requests: [],
			memory_updates: [],
		}), { status: "valid" });
		const invalid = validateFreshBootOutputContract(contract, {
			summary: "",
			files_changed: [],
			tests_run: [],
			risks: [],
			change_requests: [],
		});
		assert.equal(invalid.status, "invalid");
		if (invalid.status === "invalid") {
			assert.match(invalid.message, /summary must be a non-empty string/);
			assert.match(invalid.message, /memory_updates is required/);
		}
	});
});
