/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const contextBuilderPath = path.join(projectRoot, "agents", "context-builder.md");

function readContextBuilderAgent(): string {
	return fs.readFileSync(contextBuilderPath, "utf-8");
}

function extractJsonExample(source: string): Record<string, unknown> {
	const match = source.match(/```json\r?\n([\s\S]*?)\r?\n```/);
	if (!match) throw new Error("expected context-builder prompt to include a JSON contract example");
	const parsed = JSON.parse(match[1]!);
	assert.equal(typeof parsed, "object");
	assert.ok(parsed !== null);
	assert.equal(Array.isArray(parsed), false);
	return parsed as Record<string, unknown>;
}

describe("context-builder runtime instruction contract", () => {
	it("positions context-builder as a runtime contract compiler, not a summary agent", () => {
		const source = readContextBuilderAgent();

		assert.match(source, /requirements-to-runtime-contract subagent/);
		assert.match(source, /runtime-aware instruction contract/);
		assert.match(source, /target runtime, agent, or chain/);
	});

	it("requires a JSON runtime instruction contract with stable execution fields", () => {
		const source = readContextBuilderAgent();
		const contract = extractJsonExample(source);

		assert.match(source, /runtime-instruction-contract\.json/);
		assert.equal(contract.contract_type, "runtime_instruction_contract");
		assert.equal(contract.schema_version, "1.0");

		for (const key of [
			"intent",
			"target_runtime",
			"routing",
			"execution",
			"goal",
			"scope",
			"context",
			"instructions",
			"validation",
			"permissions",
			"memory",
			"escalation",
			"output_contract",
			"handoff",
		]) {
			assert.ok(key in contract, `expected contract to include ${key}`);
		}
	});

	it("makes the JSON contract the source of truth for the runtime-facing prompt", () => {
		const source = readContextBuilderAgent();

		assert.match(source, /generate this from `runtime-instruction-contract\.json`/);
		assert.match(source, /The JSON object is the source of truth/);
		assert.match(source, /markdown prompt is the runtime-facing rendering/);
	});

	it("guards fresh narrow delegation and memory fallback policy", () => {
		const source = readContextBuilderAgent();
		const contract = extractJsonExample(source);
		const execution = contract.execution as { context_mode?: unknown; delegation_limits?: { token_budget?: unknown } };
		const memory = contract.memory as { fallback_when_unavailable?: unknown };

		assert.match(source, /Default delegated agents to `fresh`/);
		assert.match(source, /pass required state through this JSON contract/);
		assert.match(source, /Scout tasks should stay narrow/);
		assert.equal(execution.context_mode, "fresh");
		assert.match(String(execution.delegation_limits?.token_budget ?? ""), /do not inherit broad conversation context/);
		assert.match(String(memory.fallback_when_unavailable ?? ""), /Report memory candidates/);
	});
});
