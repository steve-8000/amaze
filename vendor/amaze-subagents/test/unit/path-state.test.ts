/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	beginPathContractRun,
	finalizePathContractRun,
	lockPathsForContract,
	type MissionStateRecord,
	PathLockConflictError,
	type ContractStateRecord,
} from "../../src/harness/path-state.ts";

const tempDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-path-state-test-"));
	tempDirs.push(dir);
	return dir;
}

function readJson<T>(filePath: string): T {
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("path contract state and locks", () => {
	it("derives lock paths from write_allowed_paths, owned_paths, or assigned_path", () => {
		assert.deepEqual(lockPathsForContract({ write_allowed_paths: ["packages/a/**", "packages/a/**"] }), ["packages/a"]);
		assert.deepEqual(lockPathsForContract({ owned_paths: ["packages/b/**"] }), ["packages/b"]);
		assert.deepEqual(lockPathsForContract({ assigned_path: "packages/c" }), ["packages/c"]);
	});

	it("creates running contract state and releases locks on finalize", () => {
		const repo = makeRepo();
		const run = beginPathContractRun({
			contract_id: "runtime-state-model",
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		}, repo, {
			runId: "run-1",
			agent: "worker",
			task: "implement runtime state",
			now: () => Date.parse("2026-06-17T00:00:00Z"),
		});

		assert.ok(run);
		assert.equal(run.locks.length, 1);
		assert.equal(fs.readdirSync(path.join(repo, ".harness", "state", "locks")).length, 1);
		const running = readJson<ContractStateRecord>(run.contractStatePath);
		assert.equal(running.status, "running");
		assert.equal(running.run_id, "run-1");

		finalizePathContractRun(run, "completed", { exitCode: 0 }, () => Date.parse("2026-06-17T00:01:00Z"));

		assert.equal(fs.readdirSync(path.join(repo, ".harness", "state", "locks")).length, 0);
		const completed = readJson<ContractStateRecord>(run.contractStatePath);
		assert.equal(completed.status, "completed");
		assert.equal(completed.exit_code, 0);
		assert.equal(completed.updated_at, "2026-06-17T00:01:00.000Z");
	});

	it("blocks overlapping write locks until the first run finalizes", () => {
		const repo = makeRepo();
		const first = beginPathContractRun({
			contract_id: "runtime-state-model",
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		}, repo);
		assert.ok(first);

		assert.throws(() => beginPathContractRun({
			contract_id: "runtime-state-followup",
			write_allowed_paths: ["packages/coding-agent/src/runtime/state.ts"],
		}, repo), PathLockConflictError);

		finalizePathContractRun(first, "failed", { error: "test cleanup" });
		const second = beginPathContractRun({
			contract_id: "runtime-state-followup",
			write_allowed_paths: ["packages/coding-agent/src/runtime/state.ts"],
		}, repo);
		assert.ok(second);
		finalizePathContractRun(second, "completed", { exitCode: 0 });
	});

	it("updates mission state, queues, and events for validation outcomes", () => {
		const repo = makeRepo();
		const first = beginPathContractRun({
			mission_id: "mission-resume",
			contract_id: "runtime-state-model",
			parallel_group: "A",
			depends_on: [],
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		}, repo, {
			now: () => Date.parse("2026-06-17T00:00:00Z"),
		});
		assert.ok(first);

		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "running.json")), ["runtime-state-model"]);
		const runningMission = readJson<MissionStateRecord>(path.join(repo, ".harness", "state", "missions", "mission-resume.json"));
		assert.equal(runningMission.status, "running");
		assert.equal(runningMission.contracts["runtime-state-model"], "running");

		finalizePathContractRun(first, "completed", { exitCode: 0 }, () => Date.parse("2026-06-17T00:02:00Z"));

		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "running.json")), []);
		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "completed.json")), ["runtime-state-model"]);
		const completedMission = readJson<MissionStateRecord>(path.join(repo, ".harness", "state", "missions", "mission-resume.json"));
		assert.equal(completedMission.status, "completed");
		assert.equal(completedMission.contracts["runtime-state-model"], "completed");
		const events = fs.readFileSync(path.join(repo, ".harness", "state", "events", "events.jsonl"), "utf-8");
		assert.match(events, /ContractAssigned/);
		assert.match(events, /ValidationPassed/);

		const failed = beginPathContractRun({
			mission_id: "mission-resume",
			contract_id: "session-resume-bootstrap",
			depends_on: ["runtime-state-model"],
			write_allowed_paths: ["packages/coding-agent/src/session/**"],
		}, repo, {
			now: () => Date.parse("2026-06-17T00:03:00Z"),
		});
		assert.ok(failed);
		finalizePathContractRun(failed, "failed", { exitCode: 1, error: "acceptance failed" }, () => Date.parse("2026-06-17T00:04:00Z"));

		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "failed.json")), ["session-resume-bootstrap"]);
		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "pending.json")), ["session-resume-bootstrap-retry-1"]);
		assert.ok(fs.existsSync(path.join(repo, ".harness", "state", "retries", "session-resume-bootstrap-retry-1.json")));
		const failedMission = readJson<MissionStateRecord>(path.join(repo, ".harness", "state", "missions", "mission-resume.json"));
		assert.equal(failedMission.status, "failed");
		assert.equal(failedMission.contracts["session-resume-bootstrap"], "failed");
		const failedEvents = fs.readFileSync(path.join(repo, ".harness", "state", "events", "events.jsonl"), "utf-8");
		assert.match(failedEvents, /ValidationFailed/);
		assert.match(failedEvents, /ValidationRetryRequested/);
	});

	it("removes stale locks before acquiring a new run", () => {
		const repo = makeRepo();
		const first = beginPathContractRun({
			contract_id: "old-runtime-lock",
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		}, repo, {
			now: () => Date.parse("2026-06-17T00:00:00Z"),
		});
		assert.ok(first);

		const second = beginPathContractRun({
			contract_id: "new-runtime-lock",
			write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
		}, repo, {
			staleLockMs: 1_000,
			now: () => Date.parse("2026-06-17T00:01:00Z"),
		});
		assert.ok(second);
		assert.equal(fs.readdirSync(path.join(repo, ".harness", "state", "locks")).length, 1);
		finalizePathContractRun(second, "completed", { exitCode: 0 });
	});
});
