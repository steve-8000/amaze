/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { appendPathMemoryUpdates, extractMemoryUpdates, pathIdFromFolder, renderPathMemoryPacket, xenoniteNamespaceFromPath } from "../../src/harness/path-memory.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-path-memory-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("path memory packet rendering", () => {
	it("derives stable folder path ids", () => {
		assert.equal(
			pathIdFromFolder("packages/coding-agent/src/runtime"),
			"folder.packages.coding_agent.src.runtime",
		);
		assert.equal(pathIdFromFolder("./charts/my-service"), "folder.charts.my_service");
	});

	it("derives stable Xenonite path namespaces", () => {
		assert.equal(xenoniteNamespaceFromPath("packages/coding-agent/src/runtime"), "path:packages/coding-agent/src/runtime");
		assert.equal(xenoniteNamespaceFromPath("./charts/my-service/"), "path:charts/my-service");
	});

	it("renders path-local profile, conventions, and bounded jsonl experience", () => {
		const repo = makeTempDir();
		const memoryPath = path.join(repo, ".harness", "memory", "paths", "packages", "coding-agent", "src", "runtime");
		fs.mkdirSync(memoryPath, { recursive: true });
		fs.writeFileSync(path.join(memoryPath, "profile.md"), "Runtime path profile");
		fs.writeFileSync(path.join(memoryPath, "conventions.md"), "Persist state before external execution.");
		fs.writeFileSync(path.join(memoryPath, "decisions.jsonl"), [
			JSON.stringify({ type: "decision", summary: "old decision" }),
			JSON.stringify({ type: "decision", summary: "new decision" }),
		].join("\n"));

		const packet = renderPathMemoryPacket({
			packet_id: "ctx-runtime-memory",
			contract_id: "runtime-state-model",
			memory_scope: {
				type: "path",
				path_id: "folder.packages_coding_agent.src.runtime",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
				xenonite_namespace: "path:packages/coding-agent/src/runtime",
			},
			attachments: [{
				path_id: "folder.packages_coding_agent.src.runtime",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
				include: { recent_decisions: 1, known_failures: 0, incidents: 0, contract_summaries: 0 },
			}],
		}, repo);

		assert.equal(packet.warnings.length, 0);
		assert.match(packet.markdown, /# Path Memory Packet/);
		assert.match(packet.markdown, /"xenonite_namespace": "path:packages\/coding-agent\/src\/runtime"/);
		assert.match(packet.markdown, /Runtime path profile/);
		assert.match(packet.markdown, /Persist state before external execution/);
		assert.doesNotMatch(packet.markdown, /old decision/);
		assert.match(packet.markdown, /new decision/);
		assert.match(packet.markdown, /memory_updates/);
		assert.match(packet.markdown, /validator pass/);
	});

	it("extracts and appends memory updates to path-local jsonl after validation gate calls it", () => {
		const repo = makeTempDir();
		const packet = {
			contract_id: "runtime-state-model",
			memory_scope: {
				type: "path" as const,
				path_id: "folder.packages_coding_agent.src.runtime",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
			},
		};
		const updates = extractMemoryUpdates({
			memory_updates: [{
				type: "decision",
				summary: "Persist runtime state before external tool execution.",
				reason: "Avoid losing active contract state.",
				related_files: ["packages/coding-agent/src/runtime/task-runner.ts"],
			}],
		});

		const result = appendPathMemoryUpdates(packet, updates, repo, () => Date.parse("2026-06-17T00:00:00Z"));

		assert.equal(result.written, 1);
		assert.equal(result.skipped, 0);
		assert.equal(result.warnings.length, 0);
		const decisionsPath = path.join(repo, ".harness", "memory", "paths", "packages", "coding-agent", "src", "runtime", "decisions.jsonl");
		const appended = fs.readFileSync(decisionsPath, "utf-8").trim();
		assert.match(appended, /Persist runtime state before external tool execution/);
		assert.match(appended, /runtime-state-model/);
		assert.match(appended, /2026-06-17T00:00:00.000Z/);
	});

	it("does not append memory updates when the contract disables post-validation persistence", () => {
		const repo = makeTempDir();
		const result = appendPathMemoryUpdates({
			apply_updates_after_validation_pass: false,
			memory_scope: {
				type: "path",
				path_id: "folder.packages_coding_agent.src.runtime",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
				xenonite_namespace: "path:packages/coding-agent/src/runtime",
			},
		}, [{ summary: "Do not write" }], repo);

		assert.equal(result.written, 0);
		assert.equal(result.skipped, 1);
		assert.deepEqual(result.files, []);
	});

	it("validates memory updates before appending path-local memory", () => {
		const repo = makeTempDir();
		const result = appendPathMemoryUpdates({
			contract_id: "runtime-state-model",
			apply_updates_after_validation_pass: true,
			memory_scope: {
				type: "path",
				path_id: "folder.packages_coding_agent.src.runtime",
				memory_path: ".harness/memory/paths/packages/coding-agent/src/runtime",
				xenonite_namespace: "path:packages/coding-agent/src/runtime",
			},
		}, [
			{
				type: "decision",
				path_id: "folder.packages_coding_agent.src.runtime",
				contract_id: "runtime-state-model",
				decision: "Persist runtime state before external tool execution",
				related_files: ["packages/coding-agent/src/runtime/state.ts"],
			},
			{
				type: "decision",
				path_id: "folder.packages_coding_agent.src.session",
				decision: "Wrong path id",
			},
			{
				type: "decision",
				xenonite_namespace: "path:packages/coding-agent/src/session",
				decision: "Wrong namespace",
			},
			{
				type: "decision",
				contract_id: "other-contract",
				decision: "Wrong contract",
			},
			{
				type: "decision",
				decision: "Outside boundary",
				related_files: ["packages/coding-agent/src/session/session.ts"],
			},
			{
				type: "change_request",
				decision: "Change requests are not path memory",
			},
		], repo, () => Date.parse("2026-06-17T00:00:00Z"), {
			pathContract: {
				contract_id: "runtime-state-model",
				assigned_path: "packages/coding-agent/src/runtime",
				owned_paths: ["packages/coding-agent/src/runtime/**"],
				write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
			},
		});

		assert.equal(result.written, 1);
		assert.equal(result.skipped, 5);
		assert.equal(result.warnings.length, 5);
		const decisionsPath = path.join(repo, ".harness", "memory", "paths", "packages", "coding-agent", "src", "runtime", "decisions.jsonl");
		const appended = fs.readFileSync(decisionsPath, "utf-8").trim();
		assert.match(appended, /Persist runtime state before external tool execution/);
		assert.doesNotMatch(appended, /Wrong path id|Wrong namespace|Wrong contract|Outside boundary|Change requests/);
	});
});
