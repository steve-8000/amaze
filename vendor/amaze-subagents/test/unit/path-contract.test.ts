/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createActivityBudgetState,
	evaluateActivityBudget,
	evaluateActivityBudgetSnapshot,
	evaluateReadBoundary,
	evaluateToolBoundary,
	extractMutatingToolPaths,
	extractReadingToolPaths,
	parsePathContract,
	renderPathContract,
} from "../../src/harness/path-contract.ts";

describe("path execution contract", () => {
	const contract = parsePathContract({
		contract_id: "runtime-state-model",
		owned_paths: ["packages/coding-agent/src/runtime/**"],
		write_denied_paths: ["packages/coding-agent/src/runtime/generated/**"],
	});

	it("normalizes owned_paths into write_allowed_paths and renders the contract", () => {
		assert.ok(contract);
		assert.deepEqual(contract.write_allowed_paths, ["packages/coding-agent/src/runtime/**"]);
		assert.match(renderPathContract(contract), /Path Execution Contract/);
		assert.match(renderPathContract(contract), /runtime-state-model/);
	});

	it("extracts write targets from mutating file tools", () => {
		assert.deepEqual(extractMutatingToolPaths("write", { path: "packages/coding-agent/src/runtime/state.ts" }), [
			"packages/coding-agent/src/runtime/state.ts",
		]);
		assert.deepEqual(extractMutatingToolPaths("apply_patch", {
			input: [
				"*** Begin Patch",
				"*** Update File: packages/coding-agent/src/runtime/state.ts",
				"@@",
				"-old",
				"+new",
				"*** End Patch",
			].join("\n"),
		}), ["packages/coding-agent/src/runtime/state.ts"]);
	});

	it("extracts and enforces read targets from reading tools", () => {
		const readContract = parsePathContract({
			contract_id: "runtime-state-model",
			owned_paths: ["packages/coding-agent/src/runtime/**"],
			read_allowed_paths: ["packages/coding-agent/src/session/**"],
		});
		assert.ok(readContract);
		assert.deepEqual(extractReadingToolPaths("functions.read", { path: "packages/coding-agent/src/session/session.ts" }), [
			"packages/coding-agent/src/session/session.ts",
		]);
		assert.deepEqual(extractReadingToolPaths("bash", { command: "cat packages/coding-agent/src/session/session.ts" }), [
			"packages/coding-agent/src/session/session.ts",
		]);
		assert.equal(evaluateReadBoundary(readContract, "read", { path: "packages/coding-agent/src/session/session.ts" }, process.cwd()).allowed, true);
		assert.equal(evaluateReadBoundary(readContract, "read", { path: "packages/coding-agent/src/runtime/state.ts" }, process.cwd()).allowed, true);
		const outside = evaluateReadBoundary(readContract, "read", { path: "packages/coding-agent/src/config/config.ts" }, process.cwd());
		assert.equal(outside.allowed, false);
		assert.match(String(outside.reason), /blocks reads outside allowed paths/);
	});

	it("allows writes inside owned paths and blocks writes outside or denied paths", () => {
		assert.ok(contract);
		assert.equal(evaluateToolBoundary(contract, "write", { path: "packages/coding-agent/src/runtime/state.ts" }, process.cwd()).allowed, true);
		const outside = evaluateToolBoundary(contract, "write", { path: "packages/coding-agent/src/session/session.ts" }, process.cwd());
		assert.equal(outside.allowed, false);
		assert.match(String(outside.reason), /blocks writes outside allowed paths/);
		const denied = evaluateToolBoundary(contract, "write", { path: "packages/coding-agent/src/runtime/generated/out.ts" }, process.cwd());
		assert.equal(denied.allowed, false);
	});

	it("enforces activity budgets before tool execution", () => {
		const budgetContract = parsePathContract({
			contract_id: "runtime-state-model",
			owned_paths: ["packages/coding-agent/src/runtime/**"],
			activity_budget: {
				max_tool_uses: 1,
				max_tokens: 10,
				max_elapsed_ms: 100,
			},
		});
		assert.ok(budgetContract);
		const state = createActivityBudgetState(1_000);
		assert.equal(evaluateActivityBudget(budgetContract, state, { usage: { total_tokens: 5 } }, 1_050).allowed, true);
		assert.equal(state.tool_uses, 1);
		assert.equal(state.tokens, 5);
		const toolLimit = evaluateActivityBudget(budgetContract, state, { usage: { total_tokens: 1 } }, 1_060);
		assert.equal(toolLimit.allowed, false);
		assert.match(String(toolLimit.reason), /max_tool_uses=1/);

		const tokenState = createActivityBudgetState(2_000);
		const tokenLimit = evaluateActivityBudget(budgetContract, tokenState, { usage: { total_tokens: 11 } }, 2_010);
		assert.equal(tokenLimit.allowed, false);
		assert.match(String(tokenLimit.reason), /max_tokens=10/);

		const elapsedState = createActivityBudgetState(3_000);
		const elapsedLimit = evaluateActivityBudget(budgetContract, elapsedState, {}, 3_101);
		assert.equal(elapsedLimit.allowed, false);
		assert.match(String(elapsedLimit.reason), /max_elapsed_ms=100/);
	});

	it("evaluates parent runner activity budget snapshots", () => {
		const budgetContract = parsePathContract({
			contract_id: "runtime-state-model",
			owned_paths: ["packages/coding-agent/src/runtime/**"],
			activity_budget: {
				max_tool_uses: 2,
				max_tokens: 20,
				max_elapsed_ms: 500,
			},
		});
		assert.ok(budgetContract);
		assert.equal(evaluateActivityBudgetSnapshot(budgetContract, {
			tool_uses: 2,
			tokens: 20,
			elapsed_ms: 500,
		}).allowed, true);
		assert.match(String(evaluateActivityBudgetSnapshot(budgetContract, {
			tool_uses: 3,
			tokens: 20,
			elapsed_ms: 500,
		}).reason), /max_tool_uses=2/);
		assert.match(String(evaluateActivityBudgetSnapshot(budgetContract, {
			tool_uses: 2,
			tokens: 21,
			elapsed_ms: 500,
		}).reason), /max_tokens=20/);
		assert.match(String(evaluateActivityBudgetSnapshot(budgetContract, {
			tool_uses: 2,
			tokens: 20,
			elapsed_ms: 501,
		}).reason), /max_elapsed_ms=500/);
	});
});
