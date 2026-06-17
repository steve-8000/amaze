/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { routeValidationFailure } from "../../src/harness/validation-routing.ts";
import type { ContractStateRecord } from "../../src/harness/path-state.ts";

const tempDirs: string[] = [];

function makeStateRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-validation-routing-test-"));
	tempDirs.push(dir);
	const stateRoot = path.join(dir, ".harness", "state");
	fs.mkdirSync(stateRoot, { recursive: true });
	return stateRoot;
}

function state(overrides: Partial<ContractStateRecord> = {}): ContractStateRecord {
	return {
		contract_id: "runtime-state-model",
		mission_id: "mission-resume",
		status: "failed",
		created_at: "2026-06-17T00:00:00.000Z",
		updated_at: "2026-06-17T00:01:00.000Z",
		path_contract: {
			contract_id: "runtime-state-model",
			mission_id: "mission-resume",
			assigned_worker: "folder.packages.coding_agent.src.runtime",
			assigned_path: "packages/coding-agent/src/runtime",
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		},
		locks: [],
		error: "acceptance failed",
		...overrides,
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("validation retry/replan routing", () => {
	it("routes the first validation failure back to the same worker as a retry contract", () => {
		const stateRoot = makeStateRoot();
		const result = routeValidationFailure(stateRoot, state(), { max_retries: 1 }, () => Date.parse("2026-06-17T00:02:00Z"));

		assert.equal(result.type, "return_to_same_worker");
		assert.equal(result.retry_contract_id, "runtime-state-model-retry-1");
		const retryPath = path.join(stateRoot, "retries", "runtime-state-model-retry-1.json");
		const retry = JSON.parse(fs.readFileSync(retryPath, "utf-8")) as { path_contract: { contract_id: string; depends_on: string[] } };
		assert.equal(retry.path_contract.contract_id, "runtime-state-model-retry-1");
		assert.deepEqual(retry.path_contract.depends_on, ["runtime-state-model"]);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateRoot, "queues", "pending.json"), "utf-8")), ["runtime-state-model-retry-1"]);
		assert.match(fs.readFileSync(path.join(stateRoot, "events", "events.jsonl"), "utf-8"), /ValidationRetryRequested/);
	});

	it("routes repeated validation failures to replan after retry budget is exhausted", () => {
		const stateRoot = makeStateRoot();
		routeValidationFailure(stateRoot, state(), { max_retries: 1 }, () => Date.parse("2026-06-17T00:02:00Z"));
		const result = routeValidationFailure(stateRoot, state(), { max_retries: 1 }, () => Date.parse("2026-06-17T00:03:00Z"));

		assert.equal(result.type, "replan");
		assert.equal(result.replan_request_id, "runtime-state-model-replan-2");
		assert.ok(fs.existsSync(path.join(stateRoot, "replans", "runtime-state-model-replan-2.json")));
		assert.match(fs.readFileSync(path.join(stateRoot, "events", "events.jsonl"), "utf-8"), /ReplanRequested/);
	});
});
