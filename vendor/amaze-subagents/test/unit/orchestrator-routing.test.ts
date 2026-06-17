/// <reference types="node" />

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createContractDagFromPlanner } from "../../src/harness/orchestrator/planner-gateway.ts";
import { compileMissionPolicy, startMission, acceptPlannerOutput, rerouteMissionAtCheckpoint } from "../../src/harness/orchestrator/mission-orchestrator.ts";
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

describe("mission orchestrator profile routing", () => {
	it("routes tiny README typo work to micro-direct docs with basic diff validation", () => {
		const result = compileMissionPolicy("README 오타 하나 고쳐줘", "mission-readme-typo");

		assert.equal(result.classification.size, "micro");
		assert.equal(result.classification.workPattern, "docs");
		assert.equal(result.route.baseRuntime, "micro-direct");
		assert.equal(result.route.validatorPack, "basic-diff");
		assert.deepEqual(result.route.domainOverlays, []);
		assert.equal(result.policy.plannerPolicy.maxInitialContracts, 1);
		assert.equal(result.policy.researchPolicy.mode, "off");
		assert.deepEqual(result.policy.plannerPolicy.workPatternSequence, ["locate_doc", "patch_doc", "diff_check"]);
	});

	it("routes Helm production resource policy work to infra-k8s with the k8s validator overlay", () => {
		const result = compileMissionPolicy("Helm chart에 prod-safe resource policy 넣어줘", "mission-helm-prod");

		assert.equal(result.classification.workPattern, "infra");
		assert.equal(result.classification.riskLevel, "high");
		assert.equal(result.route.baseRuntime, "infra-k8s");
		assert.equal(result.route.validatorPack, "infra-k8s");
		assert.deepEqual(result.route.domainOverlays, ["k8s-validator-operator"]);
		assert.equal(result.policy.researchPolicy.mode, "required_if_version_unknown");
		assert.equal(result.policy.plannerPolicy.maxInitialContracts, 3);
		assert.deepEqual(result.policy.plannerPolicy.workPatternSequence, ["inventory", "patch", "render", "dry_run"]);
	});

	it("routes resumable agent runtime work to large mission with path-specialist runtime overlays", () => {
		const result = compileMissionPolicy("에이전트 작업 중단 후 resume 가능한 runtime을 만들어줘", "mission-agent-resume");

		assert.equal(result.classification.size, "large");
		assert.equal(result.classification.workPattern, "feature");
		assert.equal(result.route.baseRuntime, "large-mission");
		assert.equal(result.route.validatorPack, "integration-heavy");
		assert.deepEqual(result.route.domainOverlays, ["persistent-agent-runtime", "path-specialist-harness"]);
		assert.equal(result.policy.plannerPolicy.mode, "contract_dag");
		assert.equal(result.policy.plannerPolicy.maxInitialContracts, 5);
		assert.deepEqual(result.policy.plannerPolicy.workPatternSequence, ["model_state", "integration", "consumer", "tests"]);
		assert.equal(result.policy.contextPolicy.includePathMemory, true);
	});

	it("limits active domain overlays to two even when many domain hints match", () => {
		const result = compileMissionPolicy("agent runtime resume memory mcp orchestrator contract router 구현", "mission-many-overlays");

		assert.equal(result.route.baseRuntime, "large-mission");
		assert.ok(result.route.domainOverlays.length <= 2);
		assert.deepEqual(result.route.domainOverlays, ["persistent-agent-runtime", "path-specialist-harness"]);
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
		assert.equal(saved.execution_policy?.runtime, "large-mission");

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
			plannerPolicy: {
				...started.policy.plannerPolicy,
				maxInitialContracts: 2,
			},
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
			reason: "scout found Helm chart impact",
			rawRequest: "Helm chart에 prod-safe resource policy 넣어줘",
			cwd: repo,
			now,
		});

		assert.equal(rerouted.record.status, "POLICY_COMPILED");
		assert.equal(rerouted.record.route_changes, 1);
		assert.equal(rerouted.policy.runtime, "infra-k8s");
		assert.equal(rerouted.record.routing_history?.[0]?.from_runtime, "standard-contract");
		assert.equal(rerouted.record.routing_history?.[0]?.to_runtime, "infra-k8s");

		const exhausted: MissionOrchestratorRecord = {
			...checkpoint,
			route_changes: 2,
		};
		assert.throws(() => rerouteMissionAtCheckpoint(exhausted, {
			reason: "third route change",
			rawRequest: "에이전트 작업 중단 후 resume 가능한 runtime을 만들어줘",
			cwd: repo,
			now,
		}), /exceeded runtime route change budget 2/);
	});

	it("covers non-default validator packs in compiled policies", () => {
		const standard = compileMissionPolicy("기능 구현해줘", "mission-standard");
		const strict = compileMissionPolicy("prod auth boundary 수정해줘", "mission-strict");
		const security = compileMissionPolicy("CVE 취약점 security audit 해줘", "mission-security");
		const architecture = compileMissionPolicy("architecture 설계안 만들어줘", "mission-architecture");
		const research = compileMissionPolicy("latest API version 확인해서 구현해줘", "mission-research");

		assert.equal(standard.route.validatorPack, "standard-code");
		assert.deepEqual(standard.policy.acceptance, {
			level: "checked",
			evidence: ["changed-files", "commands-run", "validation-output", "residual-risks"],
		});
		assert.equal(strict.route.validatorPack, "strict-boundary");
		assert.deepEqual(strict.policy.acceptance, {
			level: "checked",
			criteria: [{ id: "boundary", must: "All writes remain inside assigned path or have an explicit change request.", evidence: ["changed-files", "manual-notes"] }],
			evidence: ["changed-files", "validation-output"],
		});
		assert.equal(security.classification.workPattern, "security");
		assert.equal(security.route.validatorPack, "security-audit");
		assert.deepEqual(security.policy.acceptance, {
			level: "reviewed",
			evidence: ["changed-files", "review-findings", "validation-output", "residual-risks"],
		});
		assert.equal(architecture.route.validatorPack, "architecture-review");
		assert.deepEqual(architecture.policy.acceptance, {
			level: "attested",
			evidence: ["manual-notes", "review-findings"],
		});
		assert.equal(research.route.validatorPack, "research-evidence");
		assert.deepEqual(research.policy.acceptance, {
			level: "checked",
			evidence: ["manual-notes", "validation-output"],
			criteria: [{ id: "research", must: "Record the source evidence that justifies the plan.", evidence: ["manual-notes"] }],
		});
	});
});
