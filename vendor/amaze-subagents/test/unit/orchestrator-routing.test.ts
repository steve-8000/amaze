/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createContractDagFromPlanner } from "../../src/harness/orchestrator/planner-gateway.ts";
import { compileMissionPolicy, startMission, acceptPlannerOutput, rerouteMissionAtCheckpoint } from "../../src/harness/orchestrator/mission-orchestrator.ts";
import { compileDelegationDecision } from "../../src/harness/orchestrator/delegation-decision.ts";
import { missionStatePath, transitionMissionState } from "../../src/harness/orchestrator/mission-state-store.ts";
import type { MissionOrchestratorRecord } from "../../src/harness/orchestrator/types.ts";

const tempDirs: string[] = [];

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-orchestrator-routing-test-"));
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

describe("mission orchestrator direct routing", () => {
	it("classifies README typo work but keeps execution on direct agent routing", () => {
		const result = compileMissionPolicy("README 오타 하나 고쳐줘", "mission-readme-typo");
		const text = JSON.stringify(result);

		assert.equal(result.classification.size, "micro");
		assert.equal(result.classification.workPattern, "docs");
		assert.equal(result.route.mode, "agent_direct");
		assert.equal(result.route.agent, "worker");
		assert.equal(result.policy.contractTemplate.agent, result.route.agent);
		assert.ok(result.policy.stopRules.some((rule) => rule.includes("direct agent only")));
		assert.ok(!text.includes("FreshBootContract"));
	});

	it("returns a direct agent decision for micro work without child contracts", () => {
		const result = compileDelegationDecision("README 오타 하나 고쳐줘", {
			missionId: "mission-readme-decision",
			agentCandidates: [
				{ name: "reviewer", description: "Reviews code and plans" },
				{ name: "worker", description: "Implements fixes and patches" },
			],
		});
		const text = JSON.stringify(result);

		assert.equal(result.mode, "agent_direct");
		assert.equal(result.agent, "worker");
		assert.equal(result.task, "README 오타 하나 고쳐줘");
		assert.ok(result.parentInstructions.some((item) => item.includes("Invoke agent 'worker' directly")));
		assert.ok(!text.includes("path_specialist"));
		assert.ok(!text.includes("bootContract"));
		assert.ok(!text.includes("FreshBootContract"));
		assert.ok(!text.includes("delegate"));
	});

	it("returns a direct custom-agent decision for standard work without role fanout", () => {
		const result = compileDelegationDecision("기능 구현해줘", { missionId: "mission-standard-decision", agent: "worker" });
		const text = JSON.stringify(result);

		assert.equal(result.mode, "agent_direct");
		assert.equal(result.agent, "worker");
		assert.ok(!text.includes("\"roles\""));
		assert.ok(!text.includes("path_specialist"));
	});

	it("keeps large runtime work on the same direct agent decision path", () => {
		const result = compileDelegationDecision("orchestrator runtime routing refactor 해줘", {
			missionId: "mission-large-decision",
			agentCandidates: [
				{ name: "planner", description: "Creates implementation plans" },
				{ name: "worker", description: "Implementation agent for normal tasks" },
			],
		});
		const text = JSON.stringify(result);

		assert.equal(result.mode, "agent_direct");
		assert.equal(result.agent, "worker");
		assert.ok(!text.includes("external_delegation_recommended"));
		assert.ok(!text.includes("path_specialist"));
		assert.ok(!text.includes("delegate"));
	});

	it("routes review-shaped direct work to reviewer when available", () => {
		const result = compileDelegationDecision("이 패치 리뷰해줘", {
			missionId: "mission-review-decision",
			agentCandidates: [
				{ name: "reviewer", description: "Versatile review specialist" },
				{ name: "worker", description: "Implementation agent" },
			],
		});

		assert.equal(result.mode, "agent_direct");
		assert.equal(result.agent, "reviewer");
	});

	it("classifies high-risk Helm work without creating overlay routes", () => {
		const result = compileMissionPolicy("Helm chart에 prod-safe resource policy 넣어줘", "mission-helm-prod");
		const text = JSON.stringify(result);

		assert.equal(result.classification.workPattern, "infra");
		assert.equal(result.classification.riskLevel, "high");
		assert.equal(result.route.mode, "agent_direct");
		assert.equal(result.route.agent, "worker");
		assert.equal(result.policy.acceptanceLevel, "reviewed");
		assert.equal(result.policy.validationLevel, "verified");
		assert.ok(!text.includes("k8s-validator-operator"));
	});

	it("classifies resumable runtime work without path-specialist overlays", () => {
		const result = compileMissionPolicy("에이전트 작업 중단 후 resume 가능한 runtime을 만들어줘", "mission-agent-resume");
		const text = JSON.stringify(result);

		assert.equal(result.classification.size, "large");
		assert.equal(result.classification.workPattern, "feature");
		assert.equal(result.route.mode, "agent_direct");
		assert.equal(result.policy.contractTemplate.agent, result.route.agent);
		assert.ok(!text.includes("path-specialist-harness"));
		assert.ok(!text.includes("contract_dag"));
	});

	it("keeps many domain hints on the same direct route shape", () => {
		const result = compileMissionPolicy("agent runtime resume memory mcp orchestrator contract router 구현", "mission-many-overlays");
		const text = JSON.stringify(result);

		assert.equal(result.route.mode, "agent_direct");
		assert.equal(result.route.agent, "worker");
		assert.ok(!text.includes("path-specialist-harness"));
	});

	it("persists mission intake state and accepts a bounded planner DAG", () => {
		const repo = makeRepo();
		const now = () => Date.parse("2026-06-17T00:00:00Z");
		const started = startMission("에이전트 작업 중단 후 resume 가능한 runtime을 만들어줘", {
			missionId: "mission-agent-resume",
			cwd: repo,
			now,
		});

		assert.equal(started.record.status, "POLICY_COMPILED");
		const saved = readJson<MissionOrchestratorRecord>(missionStatePath(repo, "mission-agent-resume"));
		assert.equal(saved.execution_policy?.route.mode, "agent_direct");
		assert.equal(saved.execution_policy?.contractTemplate.agent, saved.final_route?.agent);

		const accepted = acceptPlannerOutput(started.record, started.policy, {
			mission_id: "mission-agent-resume",
			contracts: [{
				contract_id: "runtime-state-model",
				assigned_path: "packages/coding-agent/src/runtime",
				write_allowed_paths: ["packages/coding-agent/src/runtime/**"],
			}],
		}, { cwd: repo, now });

		assert.equal(accepted.record.status, "QUEUED");
		assert.deepEqual(accepted.dag.ready_contracts, ["runtime-state-model"]);
		assert.ok(fs.existsSync(path.join(repo, ".harness", "state", "dags", "mission-agent-resume.json")));
	});

	it("rejects planner output that exceeds maxInitialContracts", () => {
		const repo = makeRepo();
		const result = compileMissionPolicy("README 오타 하나 고쳐줘", "mission-readme-typo");

		assert.throws(() => createContractDagFromPlanner(result.policy, {
			mission_id: "mission-readme-typo",
			contracts: [
				{ contract_id: "doc-1", assigned_path: "README.md", write_allowed_paths: ["README.md"] },
				{ contract_id: "doc-2", assigned_path: "docs", write_allowed_paths: ["docs/**"] },
			],
		}, repo), /above maxInitialContracts=1/);
	});

	it("rejects planner output when policy does not match the mission record", () => {
		const repo = makeRepo();
		const started = startMission("작은 기능 구현해줘", { missionId: "mission-feature", cwd: repo });
		const other = compileMissionPolicy("README 오타 하나 고쳐줘", "mission-other");

		assert.throws(() => acceptPlannerOutput(started.record, other.policy, {
			mission_id: "mission-other",
			contracts: [{ contract_id: "doc-1", assigned_path: "README.md", write_allowed_paths: ["README.md"] }],
		}, { cwd: repo }), /does not match orchestrator record/);
	});

	it("rejects caller-mutated planner policy that would bypass persisted maxInitialContracts", () => {
		const repo = makeRepo();
		const started = startMission("README 오타 하나 고쳐줘", { missionId: "mission-readme-mutate", cwd: repo });
		const mutatedPolicy = {
			...started.policy,
			validationLevel: "none" as const,
		};

		assert.throws(() => acceptPlannerOutput(started.record, mutatedPolicy, {
			mission_id: "mission-readme-mutate",
			contracts: [
				{ contract_id: "doc-1", assigned_path: "README.md", write_allowed_paths: ["README.md"] },
				{ contract_id: "doc-2", assigned_path: "docs", write_allowed_paths: ["docs/**"] },
			],
		}, { cwd: repo }), /does not match the orchestrator record execution policy/);
	});

	it("reroutes only at checkpoints and enforces the route-change budget", () => {
		const repo = makeRepo();
		const now = () => Date.parse("2026-06-17T01:00:00Z");
		const started = startMission("기능 구현해줘", {
			missionId: "mission-reroute",
			cwd: repo,
			now,
		});

		assert.throws(() => rerouteMissionAtCheckpoint(started.record, {
			reason: "premature route change",
			rawRequest: "Helm chart 수정해줘",
			cwd: repo,
			now,
		}), /only allowed at CHECKPOINTED/);

		let checkpoint = transitionMissionState(started.record, "QUEUED", {}, repo, now);
		checkpoint = transitionMissionState(checkpoint, "RUNNING", {}, repo, now);
		checkpoint = transitionMissionState(checkpoint, "CHECKPOINTED", {}, repo, now);
		const rerouted = rerouteMissionAtCheckpoint(checkpoint, {
			reason: "scout found high-risk auth impact",
			rawRequest: "prod auth boundary 수정해줘",
			cwd: repo,
			now,
		});

		assert.equal(rerouted.record.status, "POLICY_COMPILED");
		assert.equal(rerouted.record.route_changes, 1);
		assert.equal(rerouted.policy.route.mode, "agent_direct");
		assert.equal(rerouted.record.routing_history?.[0]?.from_agent, started.route.agent);
		assert.equal(rerouted.record.routing_history?.[0]?.to_agent, rerouted.route.agent);

		const exhausted: MissionOrchestratorRecord = {
			...checkpoint,
			final_route: { mode: "agent_direct", agent: "worker", confidence: 1, reason: "test fixture" },
			route_changes: 2,
		};
		assert.throws(() => rerouteMissionAtCheckpoint(exhausted, {
			reason: "third route change",
			rawRequest: "prod auth boundary 수정해줘",
			cwd: repo,
			now,
		}), /exceeded direct agent route change budget 2/);
	});

	it("covers direct policy acceptance levels", () => {
		const standard = compileMissionPolicy("기능 구현해줘", "mission-standard");
		const strict = compileMissionPolicy("prod auth boundary 수정해줘", "mission-strict");
		const security = compileMissionPolicy("CVE 취약점 security audit 해줘", "mission-security");
		const architecture = compileMissionPolicy("architecture 설계안 만들어줘", "mission-architecture");
		const research = compileMissionPolicy("latest API version 확인해서 구현해줘", "mission-research");

		assert.equal(standard.policy.acceptanceLevel, "checked");
		assert.equal(strict.policy.acceptanceLevel, "reviewed");
		assert.equal(security.classification.workPattern, "security");
		assert.equal(security.policy.acceptanceLevel, "checked");
		assert.equal(architecture.policy.acceptanceLevel, "checked");
		assert.equal(research.classification.requiresResearch, true);
		assert.equal(research.policy.validationLevel, "checked");
	});
});
