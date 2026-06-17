/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	getReadyContracts,
	planContractDag,
	routeChangeRequest,
	type ContractDagRecord,
	type ChangeRequestRecord,
} from "../../src/harness/contract-dag.ts";

const tempDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-contract-dag-test-"));
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

describe("contract DAG planner", () => {
	it("persists DAG artifacts, pending queue, and initially ready contracts", () => {
		const repo = makeRepo();
		const dag = planContractDag({
			mission_id: "mission-resume",
			evidence_packet_id: "scan-mission-resume-001",
			scan_id: "scan-mission-resume-001",
			contracts: [
				{
					contract_id: "runtime-state-model",
					assigned_path: "packages/coding-agent/src/runtime",
					write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
				},
				{
					contract_id: "session-resume-bootstrap",
					assigned_path: "packages/coding-agent/src/session",
					depends_on: ["runtime-state-model"],
					write_allowed_paths: ["packages/coding-agent/src/session/**"],
				},
			],
		}, repo, () => Date.parse("2026-06-17T00:00:00Z"));

		assert.deepEqual(dag.edges, [{ from: "runtime-state-model", to: "session-resume-bootstrap" }]);
		assert.equal(dag.scan_id, "scan-mission-resume-001");
		assert.deepEqual(dag.ready_contracts, ["runtime-state-model"]);
		const saved = readJson<ContractDagRecord>(path.join(repo, ".harness", "state", "dags", "mission-resume.json"));
		assert.equal(saved.contracts.length, 2);
		const registry = readJson<{ paths: Array<{ path_id: string; memory_path: string }> }>(path.join(repo, ".harness", "knowledge", "path-registry.json"));
		assert.deepEqual(registry.paths.map((entry) => entry.path_id).sort(), [
			"folder.packages.coding_agent.src.runtime",
			"folder.packages.coding_agent.src.session",
		]);
		assert.ok(registry.paths.every((entry) => (entry as { evidence?: { scan_id?: string } }).evidence?.scan_id === "scan-mission-resume-001"));
		assert.ok(fs.existsSync(path.join(repo, ".harness", "memory", "paths", "packages", "coding-agent", "src", "runtime", "profile.md")));
		assert.deepEqual(readJson<string[]>(path.join(repo, ".harness", "state", "queues", "pending.json")), [
			"runtime-state-model",
			"session-resume-bootstrap",
		]);
		assert.match(fs.readFileSync(path.join(repo, ".harness", "state", "events", "events.jsonl"), "utf-8"), /ContractDAGCreated/);
	});

	it("returns newly ready contracts after dependency completion", () => {
		const repo = makeRepo();
		planContractDag({
			mission_id: "mission-resume",
			contracts: [
				{ contract_id: "runtime-state-model", write_allowed_paths: ["packages/coding-agent/src/runtime/**"] },
				{ contract_id: "session-resume-bootstrap", depends_on: ["runtime-state-model"], write_allowed_paths: ["packages/coding-agent/src/session/**"] },
			],
		}, repo);
		fs.writeFileSync(path.join(repo, ".harness", "state", "queues", "pending.json"), JSON.stringify(["session-resume-bootstrap"], null, 2));
		fs.writeFileSync(path.join(repo, ".harness", "state", "queues", "completed.json"), JSON.stringify(["runtime-state-model"], null, 2));

		assert.deepEqual(getReadyContracts("mission-resume", repo), ["session-resume-bootstrap"]);
	});

	it("rejects missing dependencies and dependency cycles", () => {
		const repo = makeRepo();
		assert.throws(() => planContractDag({
			mission_id: "mission-bad",
			contracts: [{ contract_id: "a", depends_on: ["missing"], write_allowed_paths: ["a/**"] }],
		}, repo), /depends on missing contract/);
		assert.throws(() => planContractDag({
			mission_id: "mission-cycle",
			contracts: [
				{ contract_id: "a", depends_on: ["b"], write_allowed_paths: ["a/**"] },
				{ contract_id: "b", depends_on: ["a"], write_allowed_paths: ["b/**"] },
			],
		}, repo), /dependency cycle/);
	});
});

describe("change request routing", () => {
	it("persists a change request and routes it into a target path contract", () => {
		const repo = makeRepo();
		planContractDag({
			mission_id: "mission-resume",
			evidence_packet_id: "packet-mission-resume-001",
			scan_id: "scan-mission-resume-001",
			contracts: [{
				contract_id: "runtime-state-model",
				assigned_worker: "folder.packages_coding_agent.src.runtime",
				assigned_path: "packages/coding-agent/src/runtime",
				write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
			}],
		}, repo, () => Date.parse("2026-06-17T00:00:00Z"));

		const routed = routeChangeRequest({
			change_request_id: "cr-runtime-to-session-001",
			mission_id: "mission-resume",
			from_contract: "runtime-state-model",
			from_worker: "folder.packages_coding_agent.src.runtime",
			target_path: "packages/coding-agent/src/session",
			reason: "Session bootstrap must load pending runtime task.",
			requested_behavior: ["Load pending task before planning."],
			blocking: true,
			evidence: ["Runtime state exposes loadPendingTask()."],
		}, repo, () => Date.parse("2026-06-17T00:01:00Z"));

		assert.equal(routed.contract.assigned_worker, "folder.packages.coding_agent.src.session");
		assert.deepEqual(routed.contract.depends_on, ["runtime-state-model"]);
		assert.equal(routed.contract.evidence_packet_id, "packet-mission-resume-001");
		assert.equal(routed.contract.scan_id, "scan-mission-resume-001");
		assert.deepEqual(routed.contract.write_allowed_paths, ["packages/coding-agent/src/session/**"]);
		const cr = readJson<ChangeRequestRecord>(path.join(repo, ".harness", "state", "change-requests", "cr-runtime-to-session-001.json"));
		assert.equal(cr.generated_contract_id, "cr-runtime-to-session-001-contract");
		const registry = readJson<{ paths: Array<{ path_id: string; created_from: string; evidence?: { scan_id?: string; contract_id?: string } }> }>(path.join(repo, ".harness", "knowledge", "path-registry.json"));
		const sessionEntry = registry.paths.find((entry) => entry.path_id === "folder.packages.coding_agent.src.session");
		assert.equal(sessionEntry?.evidence?.scan_id, "scan-mission-resume-001");
		assert.equal(sessionEntry?.evidence?.contract_id, "cr-runtime-to-session-001-contract");
		const dag = readJson<ContractDagRecord>(path.join(repo, ".harness", "state", "dags", "mission-resume.json"));
		assert.equal(dag.evidence_packet_id, "packet-mission-resume-001");
		const routedContract = dag.contracts.find((contract) => contract.contract_id === "cr-runtime-to-session-001-contract");
		assert.equal(routedContract?.scan_id, "scan-mission-resume-001");
		assert.match(fs.readFileSync(path.join(repo, ".harness", "state", "events", "events.jsonl"), "utf-8"), /ChangeRequestCreated/);
	});
});
