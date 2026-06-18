import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyRuntimeArchitecturePolicy } from "../../src/runs/shared/runtime-architecture-policy.ts";
import {
	claimReadyContractLease,
	completeContractLease,
	getReadyContracts,
	planContractDag,
	recoverExpiredContractLeases,
} from "../../src/harness/contract-dag.ts";
import { collectRepoEvidence } from "../../src/harness/evidence-scouter.ts";
import { appendPathMemoryUpdates } from "../../src/harness/path-memory.ts";

const agents = [
	{ name: "worker", localName: "worker", description: "worker", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "worker.md", tools: ["read", "write"] },
	{ name: "scout", localName: "scout", description: "scout", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "scout.md", tools: ["read"] },
	{ name: "researcher", localName: "researcher", description: "researcher", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "researcher.md", tools: ["read"] },
	{ name: "planner", localName: "planner", description: "planner", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "planner.md", tools: ["read", "write"] },
	{ name: "context-builder", localName: "context-builder", description: "context-builder", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "context-builder.md", tools: ["read", "write"] },
	{ name: "delegate", localName: "delegate", description: "delegate", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "delegate.md", tools: ["read", "write"] },
	{ name: "oracle", localName: "oracle", description: "oracle", systemPromptMode: "replace", inheritProjectContext: false, inheritSkills: false, systemPrompt: "", source: "project", filePath: "oracle.md", tools: ["read", "write"] },
] as any;

test("runtime policy rejects write-capable work without an owned path", () => {
	const result = applyRuntimeArchitecturePolicy({ agent: "worker", task: "Implement the feature" }, agents);
	assert.match(result.error ?? "", /requires an assigned_path/);
});

test("runtime policy attaches path contract, budget, and mandatory acceptance for owned writes", () => {
	const result = applyRuntimeArchitecturePolicy<any>({ agent: "worker", task: "Fix src/runtime/foo.ts", acceptance: false }, agents);
	assert.equal(result.error, undefined);
	assert.equal(result.params?.pathContract?.assigned_path, "src/runtime/foo.ts");
	assert.deepEqual(result.params?.pathContract?.read_allowed_paths, ["**/*"]);
	assert.deepEqual(result.params?.pathContract?.write_allowed_paths, ["src/runtime/foo.ts"]);
	assert.equal(result.params?.memoryPacket?.memory_scope.path_id, "folder.src.runtime.foo.ts");
	assert.equal(result.params?.memoryPacket?.memory_scope.agent_id, "worker");
	assert.equal(result.params?.memoryPacket?.memory_scope.xenonite_namespace, "path:src/runtime/foo.ts");
	assert.equal(result.params?.memoryPacket?.memory_attachments?.[0]?.budget?.max_bytes, 12_000);
	assert.equal(result.params?.pathContract?.activity_budget?.max_tokens, 270_000);
	assert.notEqual(result.params?.acceptance, false);
});

test("runtime policy gives read-only roles deny-all write contracts and blocks role drift", () => {
	const readOnly = applyRuntimeArchitecturePolicy<any>({ agent: "scout", task: "Scan the repo" }, agents);
	assert.equal(readOnly.error, undefined);
	assert.deepEqual(readOnly.params?.pathContract?.write_allowed_paths, []);
	assert.deepEqual(readOnly.params?.pathContract?.write_denied_paths, ["**/*"]);
	assert.equal(readOnly.params?.memoryPacket?.memory_scope.path_id, "folder.project");
	assert.equal(readOnly.params?.memoryPacket?.memory_scope.agent_id, "scout");
	assert.equal(readOnly.params?.memoryPacket?.memory_scope.xenonite_namespace, "path:project");

	const drift = applyRuntimeArchitecturePolicy({
		agent: "researcher",
		task: "Research and edit src/runtime/foo.ts",
		pathContract: {
			contract_id: "bad",
			assigned_path: "src/runtime/foo.ts",
			write_allowed_paths: ["src/runtime/foo.ts"],
		},
	}, agents);
	assert.match(drift.error ?? "", /blocks read-only role/);
});

test("runtime policy does not treat string false output as a memory path", () => {
	const result = applyRuntimeArchitecturePolicy<any>({
		agent: "scout",
		task: "Scan the repo",
		output: "false",
	}, agents);
	assert.equal(result.error, undefined);
	assert.equal(result.params?.memoryPacket?.memory_scope.path_id, "folder.project");
	assert.equal(result.params?.memoryPacket?.memory_scope.xenonite_namespace, "path:project");
	assert.notEqual(result.params?.memoryPacket?.memory_scope.path_id, "folder.false");
});

test("runtime policy preserves explicit path memory packets", () => {
	const explicit = {
		packet_id: "explicit",
		memory_scope: {
			type: "path" as const,
			path_id: "folder.explicit",
			agent_id: "worker",
			memory_path: ".harness/memory/paths/explicit",
		},
		apply_updates_after_validation_pass: true,
	};
	const result = applyRuntimeArchitecturePolicy<any>({
		agent: "worker",
		task: "Modify src/runtime/foo.ts",
		memoryPacket: explicit,
	}, agents);
	assert.equal(result.error, undefined);
	assert.equal(result.params?.memoryPacket, explicit);
});

test("runtime policy keeps parent-managed output artifacts read-only for scouts", () => {
	const result = applyRuntimeArchitecturePolicy<any>({
		agent: "scout",
		task: "Scan the active config.\n\n---\n**Output:** Return your findings in the final response only. The parent runtime persists that response at the hidden output file: /Users/steve/.subagent-outputs/context.md. No filesystem action is required for this output artifact.",
		output: "/Users/steve/.subagent-outputs/context.md",
	}, agents);

	assert.equal(result.error, undefined);
	assert.notEqual(result.params?.acceptance?.level, "checked");
	assert.deepEqual(result.params?.pathContract?.write_allowed_paths, []);
	assert.deepEqual(result.params?.pathContract?.write_denied_paths, ["**/*"]);
});

test("runtime policy keeps planning and audit agents read-only despite active wording", () => {
	for (const agent of ["planner", "context-builder", "delegate", "oracle"]) {
		const result = applyRuntimeArchitecturePolicy({
			agent,
			task: "Live smoke test only. Build or audit a concise plan. Do not modify files.",
		}, agents);
		const params = result.params as any;

		assert.equal(result.error, undefined, `${agent} should not require assigned_path`);
		assert.notEqual(params?.acceptance?.level, "checked", `${agent} should not get write acceptance`);
		assert.deepEqual(params?.pathContract?.write_allowed_paths, [], `${agent} should not get write paths`);
		assert.deepEqual(params?.pathContract?.write_denied_paths, ["**/*"], `${agent} should deny writes`);
	}
});

test("contract DAG leases recover expired running work and complete durable queue state", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-dag-"));
	planContractDag({
		mission_id: "mission",
		contracts: [
			{ contract_id: "a", assigned_path: "src/a.ts", write_allowed_paths: ["src/a.ts"] },
			{ contract_id: "b", assigned_path: "src/b.ts", write_allowed_paths: ["src/b.ts"], depends_on: ["a"] },
		],
	}, cwd);
	assert.deepEqual(getReadyContracts("mission", cwd), ["a"]);
	const lease = claimReadyContractLease("mission", cwd, { workerId: "worker-1", leaseMs: 10, now: () => 1_000 });
	assert.equal(lease?.contract_id, "a");
	assert.deepEqual(getReadyContracts("mission", cwd), []);
	const recovered = recoverExpiredContractLeases("mission", cwd, () => 20_000);
	assert.equal(recovered.recovered.length, 1);
	assert.deepEqual(getReadyContracts("mission", cwd), ["a"]);
	const lease2 = claimReadyContractLease("mission", cwd, { workerId: "worker-1", leaseMs: 10, now: () => 21_000 });
	assert.equal(lease2?.attempt, 1);
	completeContractLease(lease2!, cwd, "completed", () => 22_000);
	assert.deepEqual(getReadyContracts("mission", cwd), ["b"]);
});

test("scouter writes incremental delta scan with dependency and symbol indexes", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-scout-"));
	fs.mkdirSync(path.join(cwd, "src"));
	fs.writeFileSync(path.join(cwd, "src", "a.ts"), "import './b';\nexport function alpha() { return 1; }\n");
	fs.writeFileSync(path.join(cwd, "src", "b.ts"), "export const beta = 2;\n");
	const first = await collectRepoEvidence({
		recon_plan_id: "plan",
		mission_id: "mission",
		questions: ["q"],
		repo_queries: ["src"],
		symbol_queries: ["alpha"],
	}, cwd, { maxFiles: 20, now: () => 1_000 });
	assert.equal(first.delta_scan?.added_files.includes("src/a.ts"), true);
	assert.equal(first.dependency_graph?.edges.some((edge) => edge.from === "src/a.ts" && edge.to === "./b"), true);
	assert.equal(first.symbol_index?.symbols.some((symbol) => symbol.name === "alpha"), true);
	fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export function alpha() { return 2; }\n");
	const second = await collectRepoEvidence({
		recon_plan_id: "plan",
		mission_id: "mission",
		questions: ["q"],
		repo_queries: ["src"],
		symbol_queries: ["alpha"],
	}, cwd, { maxFiles: 20, now: () => 2_000 });
	assert.equal(second.delta_scan?.previous_index_id, first.scan_id);
	assert.equal(second.delta_scan?.changed_files.includes("src/a.ts"), true);
});

test("path memory stores summaries separately and appends unified path-local history", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-memory-"));
	const memoryPath = path.join(cwd, "memory", "src");
	const result = appendPathMemoryUpdates({
		contract_id: "contract-1",
		memory_scope: {
			type: "path",
			path_id: "folder.src",
			agent_id: "agent.src",
			memory_path: memoryPath,
			xenonite_namespace: "path:src",
		},
	}, [
		{ type: "summary", summary: "Validated runtime architecture." },
	]);
	assert.equal(result.written, 1);
	assert.equal(fs.existsSync(path.join(memoryPath, "summaries.jsonl")), true);
	const history = fs.readFileSync(path.join(memoryPath, "history.jsonl"), "utf-8");
	assert.match(history, /"history_type":"summary"/);
	assert.match(history, /"path_id":"folder.src"/);
	assert.match(history, /"agent_id":"agent.src"/);
});
