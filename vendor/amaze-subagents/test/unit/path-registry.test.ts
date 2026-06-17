/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	ownedPathFromContract,
	pathIdFromFolder,
	readPathRegistry,
	registerPathSpecialist,
	registerPathSpecialistsForContracts,
} from "../../src/harness/path-registry.ts";

const tempDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-path-registry-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("path specialist registry", () => {
	it("derives stable path specialist ids and owned paths", () => {
		assert.equal(pathIdFromFolder("packages/coding-agent/src/runtime"), "folder.packages.coding_agent.src.runtime");
		assert.equal(pathIdFromFolder("./charts/my-service"), "folder.charts.my_service");
		assert.equal(ownedPathFromContract({ assigned_path: "packages/coding-agent/src/runtime" }), "packages/coding-agent/src/runtime");
		assert.equal(ownedPathFromContract({ write_allowed_paths: ["packages/coding-agent/src/session/**"] }), "packages/coding-agent/src/session");
	});

	it("registers a path specialist and bootstraps path memory files", () => {
		const repo = makeRepo();
		const entry = registerPathSpecialist({
			owned_path: "packages/coding-agent/src/runtime",
			write_globs: ["packages/coding-agent/src/runtime/**"],
			created_from: "planner",
			evidence: { contract_id: "runtime-state-model", reason: "Runtime state model" },
		}, repo, () => Date.parse("2026-06-17T00:00:00Z"), {
			contract_id: "runtime-state-model",
			mission_id: "mission-resume",
			assigned_path: "packages/coding-agent/src/runtime",
		});

		assert.equal(entry.path_id, "folder.packages.coding_agent.src.runtime");
		const registry = readPathRegistry(repo);
		assert.equal(registry?.paths.length, 1);
		assert.equal(registry?.paths[0]?.memory_path, ".harness/memory/paths/packages/coding-agent/src/runtime");
		const memoryRoot = path.join(repo, ".harness", "memory", "paths", "packages", "coding-agent", "src", "runtime");
		assert.match(fs.readFileSync(path.join(memoryRoot, "profile.md"), "utf-8"), /folder\.packages\.coding_agent\.src\.runtime/);
		assert.ok(fs.existsSync(path.join(memoryRoot, "conventions.md")));
		assert.ok(fs.existsSync(path.join(memoryRoot, "decisions.jsonl")));
		assert.match(fs.readFileSync(path.join(memoryRoot, "contracts.jsonl"), "utf-8"), /runtime-state-model/);
	});

	it("updates existing entries without deleting path memory", () => {
		const repo = makeRepo();
		registerPathSpecialist({ owned_path: "packages/coding-agent/src/runtime", write_globs: ["packages/coding-agent/src/runtime/**"] }, repo);
		registerPathSpecialist({ owned_path: "packages/coding-agent/src/runtime", write_globs: ["packages/coding-agent/src/runtime/generated/**"] }, repo);

		const registry = readPathRegistry(repo);
		assert.equal(registry?.paths.length, 1);
		assert.deepEqual(registry?.paths[0]?.write_globs, [
			"packages/coding-agent/src/runtime/**",
			"packages/coding-agent/src/runtime/generated/**",
		]);
	});

	it("registers specialists for planned contracts", () => {
		const repo = makeRepo();
		const entries = registerPathSpecialistsForContracts([
			{
				contract_id: "runtime-state-model",
				mission_id: "mission-resume",
				assigned_path: "packages/coding-agent/src/runtime",
				write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
			},
			{
				contract_id: "session-resume-bootstrap",
				mission_id: "mission-resume",
				write_allowed_paths: ["packages/coding-agent/src/session/**"],
			},
		], repo);

		assert.deepEqual(entries.map((entry) => entry.path_id).sort(), [
			"folder.packages.coding_agent.src.runtime",
			"folder.packages.coding_agent.src.session",
		]);
		assert.equal(readPathRegistry(repo)?.paths.length, 2);
	});
});
