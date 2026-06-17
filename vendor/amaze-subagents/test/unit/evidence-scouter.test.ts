/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { collectRepoEvidence, type RepoEvidencePacket } from "../../src/harness/evidence-scouter.ts";

const tempDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-evidence-scouter-test-"));
	tempDirs.push(dir);
	fs.mkdirSync(path.join(dir, "packages", "coding-agent", "src", "runtime"), { recursive: true });
	fs.mkdirSync(path.join(dir, "packages", "coding-agent", "tests"), { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
		scripts: {
			test: "node --test",
			typecheck: "tsc --noEmit",
			lint: "eslint .",
		},
	}, null, 2));
	fs.writeFileSync(path.join(dir, "packages", "coding-agent", "src", "runtime", "task-runner.ts"), "export class TaskRunner { checkpoint() {} }\n");
	fs.writeFileSync(path.join(dir, "packages", "coding-agent", "tests", "runtime.test.ts"), "TaskRunner recovery test\n");
	return dir;
}

function readJson<T>(filePath: string): T {
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("scouter evidence packets", () => {
	it("persists recon plans and filesystem fallback scan evidence", async () => {
		const repo = makeRepo();
		const packet = await collectRepoEvidence({
			recon_plan_id: "recon-resume-001",
			mission_id: "mission-resume",
			questions: ["Where is runtime task execution represented?"],
			repo_queries: ["runtime task runner"],
			symbol_queries: ["TaskRunner"],
			required_artifacts: ["packages/coding-agent/src/runtime/task-runner.ts"],
		}, repo, {
			useXenonite: false,
			now: () => Date.parse("2026-06-17T00:00:00Z"),
		});

		assert.equal(packet.scan_id, "scan-mission-resume-20260617000000");
		assert.equal(packet.index_status, "filesystem_fallback");
		assert.equal(packet.commands.test, "npm run test");
		assert.ok(packet.candidate_paths.some((entry) => entry.files.includes("packages/coding-agent/src/runtime/task-runner.ts")));
		assert.ok(fs.existsSync(path.join(repo, ".harness", "intelligence", "recon-plans", "recon-resume-001.json")));
		const savedPlan = readJson<Record<string, unknown>>(path.join(repo, ".harness", "intelligence", "recon-plans", "recon-resume-001.json"));
		assert.deepEqual(savedPlan.required_artifacts, ["packages/coding-agent/src/runtime/task-runner.ts"]);
		const saved = readJson<RepoEvidencePacket>(path.join(repo, ".harness", "intelligence", "scans", "scan-mission-resume-20260617000000.json"));
		assert.equal(saved.recon_plan_id, "recon-resume-001");
		assert.deepEqual(saved.candidate_paths, packet.candidate_paths);
		assert.deepEqual(saved.commands, packet.commands);
	});

	it("calls Xenonite code engine with repo and symbol queries when available", async () => {
		const repo = makeRepo();
		const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
		const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { op: string; args: Record<string, unknown> };
			calls.push(body);
			return {
				async json() {
					return { result: { ok: true, op: body.op, query: body.args.query } };
				},
			} as Response;
		}) as typeof fetch;

		const packet = await collectRepoEvidence({
			recon_plan_id: "recon-resume-001",
			mission_id: "mission-resume",
			repo_queries: ["runtime task runner"],
			symbol_queries: ["TaskRunner"],
		}, repo, {
			xenoniteBaseUrl: "http://127.0.0.1:9999",
			fetchImpl: fakeFetch,
			now: () => Date.parse("2026-06-17T00:00:00Z"),
		});

		assert.equal(packet.index_status, "xenonite");
		assert.deepEqual(calls.map((call) => call.op), ["codebase_search", "codebase_symbol"]);
		assert.equal(calls[0]?.args.projectPath, repo);
		assert.equal(packet.xenonite?.status, "ok");
		const saved = readJson<RepoEvidencePacket>(path.join(repo, ".harness", "intelligence", "scans", `${packet.scan_id}.json`));
		assert.equal(saved.index_status, "xenonite");
		assert.deepEqual(saved.xenonite?.results.map((result) => result.op), ["codebase_search", "codebase_symbol"]);
	});
});
