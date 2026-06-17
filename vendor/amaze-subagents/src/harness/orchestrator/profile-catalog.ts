/// <reference types="node" />

import type {
	BaseRuntime,
	DomainOverlayProfile,
	ProfileManifest,
	RuntimeProfileBody,
	ValidatorPack,
	ValidatorPackProfile,
	WorkPattern,
	WorkPatternProfile,
} from "./types.ts";

export const MAX_DOMAIN_OVERLAYS = 2;
export const MAX_RUNTIME_ROUTE_CHANGES = 2;

export const BASE_RUNTIME_MANIFESTS: ProfileManifest[] = [
	{
		id: "micro-direct",
		kind: "base_runtime",
		summary: "Single-file typo, docs, tiny config, or obvious localized fixes.",
		positive_triggers: ["typo", "오타", "readme", "single file", "한 파일", "작은 수정"],
		negative_triggers: ["architecture", "kubernetes", "helm", "terraform", "multi-path"],
		cost_class: "low",
		default_validator_pack: "basic-diff",
	},
	{
		id: "standard-contract",
		kind: "base_runtime",
		summary: "Normal bugfix, small feature, localized refactor, or unclear impact fallback.",
		positive_triggers: ["bug", "fix", "feature", "refactor", "test", "standard"],
		cost_class: "medium",
		default_validator_pack: "standard-code",
	},
	{
		id: "large-mission",
		kind: "base_runtime",
		summary: "Broad feature, multi-path change, runtime work, checkpointed mission, or agent harness work.",
		positive_triggers: ["runtime", "resume", "checkpoint", "agent", "orchestrator", "mission", "dag", "large"],
		cost_class: "high",
		default_validator_pack: "integration-heavy",
	},
	{
		id: "research-first",
		kind: "base_runtime",
		summary: "External docs, release notes, current API behavior, or unknown version research first.",
		positive_triggers: ["research", "latest", "docs", "release notes", "api version", "web"],
		cost_class: "medium",
		default_validator_pack: "research-evidence",
	},
	{
		id: "infra-k8s",
		kind: "base_runtime",
		summary: "Helm, Kubernetes, Terraform, deployment, and validator infrastructure changes.",
		positive_triggers: ["helm", "k8s", "kubernetes", "terraform", "chart.yaml", "values.yaml", "ingress", "deployment"],
		negative_triggers: ["frontend only", "docs only"],
		cost_class: "medium",
		default_validator_pack: "infra-k8s",
	},
	{
		id: "architecture-design",
		kind: "base_runtime",
		summary: "Architecture-first design where code execution is delayed or absent.",
		positive_triggers: ["architecture", "design", "설계", "proposal", "plan"],
		cost_class: "medium",
		default_validator_pack: "architecture-review",
	},
	{
		id: "emergency-hotfix",
		kind: "base_runtime",
		summary: "Urgent breakage, outage, or minimal patch under time pressure.",
		positive_triggers: ["urgent", "emergency", "hotfix", "outage", "장애", "긴급"],
		cost_class: "medium",
		default_validator_pack: "standard-code",
	},
	{
		id: "exploration-only",
		kind: "base_runtime",
		summary: "Read-only investigation, scouting, and repo understanding.",
		positive_triggers: ["investigate", "look into", "explore", "파악", "조사만", "no edit"],
		cost_class: "low",
		default_validator_pack: "basic-diff",
	},
];

export const RUNTIME_PROFILES: Record<BaseRuntime, RuntimeProfileBody> = {
	"micro-direct": {
		id: "micro-direct",
		scouter: { depth: "minimal" },
		researcher: { mode: "off" },
		planner: {
			mode: "direct_contract",
			maxInitialContracts: 1,
			contractGranularity: "file",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: false,
		},
		context: { packetBudgetTokens: 2_000, includePathMemory: false, includeResearch: false },
		agents: { maxAgents: 1, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 1, changeRequestsBeforeReplan: 1, escalationRuntime: "standard-contract" },
	},
	"standard-contract": {
		id: "standard-contract",
		scouter: { depth: "targeted", includeDependencyGraph: true },
		researcher: { mode: "on_demand" },
		planner: {
			mode: "contract_list",
			maxInitialContracts: 3,
			contractGranularity: "path",
			allowParallelGroups: true,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 5_000, includePathMemory: false, includeResearch: false },
		agents: { maxAgents: 3, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 2, changeRequestsBeforeReplan: 2, escalationRuntime: "large-mission" },
	},
	"large-mission": {
		id: "large-mission",
		scouter: { depth: "deep", includeDependencyGraph: true, includeSymbolGraph: true, includeRecentChanges: true },
		researcher: { mode: "on_demand" },
		planner: {
			mode: "contract_dag",
			maxInitialContracts: 5,
			contractGranularity: "path",
			allowParallelGroups: true,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 8_000, includePathMemory: true, includeResearch: false },
		agents: { maxAgents: 6, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 2, changeRequestsBeforeReplan: 3 },
	},
	"research-first": {
		id: "research-first",
		scouter: { depth: "targeted", includeDependencyGraph: true },
		researcher: { mode: "required", sourcePreference: ["official_docs", "release_notes", "provider_docs"] },
		planner: {
			mode: "contract_list",
			maxInitialContracts: 3,
			contractGranularity: "path",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 6_000, includePathMemory: false, includeResearch: true },
		agents: { maxAgents: 3, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 2, changeRequestsBeforeReplan: 2, escalationRuntime: "large-mission" },
	},
	"infra-k8s": {
		id: "infra-k8s",
		scouter: { depth: "targeted", includeDependencyGraph: true },
		researcher: { mode: "required_if_version_unknown", sourcePreference: ["official_docs", "release_notes", "provider_docs"] },
		planner: {
			mode: "infra_contract",
			maxInitialContracts: 3,
			contractGranularity: "path",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 6_000, includePathMemory: false, includeResearch: true },
		agents: { maxAgents: 3, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 2, changeRequestsBeforeReplan: 2, escalationRuntime: "large-mission" },
	},
	"architecture-design": {
		id: "architecture-design",
		scouter: { depth: "deep", includeDependencyGraph: true, includeSymbolGraph: true, includeRecentChanges: true },
		researcher: { mode: "on_demand" },
		planner: {
			mode: "architecture_plan",
			maxInitialContracts: 2,
			contractGranularity: "feature",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 8_000, includePathMemory: false, includeResearch: false },
		agents: { maxAgents: 2, reuseExistingAgents: true, createMissingPathAgents: false, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 0, validatorFailuresBeforeReplan: 1, changeRequestsBeforeReplan: 2 },
	},
	"emergency-hotfix": {
		id: "emergency-hotfix",
		scouter: { depth: "minimal" },
		researcher: { mode: "off" },
		planner: {
			mode: "direct_contract",
			maxInitialContracts: 1,
			contractGranularity: "file",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: true,
		},
		context: { packetBudgetTokens: 3_000, includePathMemory: false, includeResearch: false },
		agents: { maxAgents: 1, reuseExistingAgents: true, createMissingPathAgents: true, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 1, validatorFailuresBeforeReplan: 1, changeRequestsBeforeReplan: 1, escalationRuntime: "standard-contract" },
	},
	"exploration-only": {
		id: "exploration-only",
		scouter: { depth: "targeted", includeDependencyGraph: true },
		researcher: { mode: "on_demand" },
		planner: {
			mode: "architecture_plan",
			maxInitialContracts: 0,
			contractGranularity: "feature",
			allowParallelGroups: false,
			requireChangeRequestsForCrossPath: false,
		},
		context: { packetBudgetTokens: 5_000, includePathMemory: false, includeResearch: false },
		agents: { maxAgents: 1, reuseExistingAgents: true, createMissingPathAgents: false, writeScope: "owned_path_only" },
		failure: { sameWorkerRetries: 0, validatorFailuresBeforeReplan: 1, changeRequestsBeforeReplan: 1 },
	},
};

export const WORK_PATTERN_PROFILES: Record<WorkPattern, WorkPatternProfile> = {
	bugfix: { id: "bugfix", summary: "Reproduce, locate, patch, and add regression coverage.", contractSequence: ["reproduce", "locate", "patch", "regression_test"] },
	feature: { id: "feature", summary: "Model/state, API or integration, consumer, and tests.", contractSequence: ["model_state", "integration", "consumer", "tests"] },
	refactor: { id: "refactor", summary: "Dependency map, compatibility seam, internals move, and regression.", contractSequence: ["dependency_map", "compatibility_seam", "move_internals", "regression"] },
	migration: { id: "migration", summary: "Inventory, compatibility, staged change, and validation.", contractSequence: ["inventory", "compatibility", "staged_change", "validation"] },
	infra: { id: "infra", summary: "Inventory infra manifests, patch safely, render, and dry-run when available.", contractSequence: ["inventory", "patch", "render", "dry_run"] },
	test: { id: "test", summary: "Identify behavior, add deterministic tests, and run focused suite.", contractSequence: ["behavior_map", "test_patch", "focused_run"] },
	docs: { id: "docs", summary: "Locate docs, patch content, and verify diff.", contractSequence: ["locate_doc", "patch_doc", "diff_check"] },
	architecture: { id: "architecture", summary: "Scout design constraints, evaluate options, and produce architecture plan.", contractSequence: ["scout", "evaluate", "plan"] },
	cleanup: { id: "cleanup", summary: "Inventory stale code, remove safely, and run regression checks.", contractSequence: ["inventory", "remove", "regression"] },
	performance: { id: "performance", summary: "Measure, isolate bottleneck, patch, and compare.", contractSequence: ["measure", "isolate", "patch", "compare"] },
	security: { id: "security", summary: "Identify boundary, patch defensively, and audit validation.", contractSequence: ["boundary", "patch", "audit"] },
};

export const DOMAIN_OVERLAY_PROFILES: Record<string, DomainOverlayProfile> = {
	"path-specialist-harness": {
		id: "path-specialist-harness",
		summary: "Prefer path-owned contracts, fresh specialists, and explicit write boundaries.",
		triggers: ["path", "specialist", "harness", "contract", "boundary"],
		policyHints: { includePathMemory: true },
	},
	"persistent-agent-runtime": {
		id: "persistent-agent-runtime",
		summary: "Runtime/checkpoint/resume work should preserve long-running state and restart safety.",
		triggers: ["runtime", "resume", "checkpoint", "persistent", "session"],
		policyHints: { includePathMemory: true },
	},
	"memory-first-agent": {
		id: "memory-first-agent",
		summary: "Prefer path-local memory packets and durable learning after validation.",
		triggers: ["memory", "메모리", "path memory", "durable"],
		policyHints: { includePathMemory: true },
	},
	"mcp-orchestrator-builder": {
		id: "mcp-orchestrator-builder",
		summary: "MCP/tool orchestration and runtime routing lens.",
		triggers: ["mcp", "tool", "router", "orchestrator"],
	},
	"local-llm-router": {
		id: "local-llm-router",
		summary: "Local LLM provider routing and model policy lens.",
		triggers: ["local llm", "provider", "model router", "ollama"],
	},
	"k8s-validator-operator": {
		id: "k8s-validator-operator",
		summary: "Kubernetes/Helm/operator safety, rendering, and rollback lens.",
		triggers: ["helm", "k8s", "kubernetes", "terraform", "operator", "validator"],
	},
	"final-architecture-first": {
		id: "final-architecture-first",
		summary: "Hold implementation until architecture is explicitly planned.",
		triggers: ["architecture", "design", "설계", "final plan"],
	},
};

export const VALIDATOR_PACK_PROFILES: Record<ValidatorPack, ValidatorPackProfile> = {
	"basic-diff": {
		id: "basic-diff",
		summary: "Diff and boundary evidence for tiny changes.",
		acceptance: { level: "checked", evidence: ["changed-files", "diff-summary", "no-staged-files"] },
	},
	"standard-code": {
		id: "standard-code",
		summary: "Boundary, typecheck, and relevant tests for normal code changes.",
		acceptance: { level: "checked", evidence: ["changed-files", "commands-run", "validation-output", "residual-risks"] },
	},
	"strict-boundary": {
		id: "strict-boundary",
		summary: "Strict ownership and no cross-path writes without change requests.",
		acceptance: {
			level: "checked",
			criteria: [{ id: "boundary", must: "All writes remain inside assigned path or have an explicit change request.", evidence: ["changed-files", "manual-notes"] }],
			evidence: ["changed-files", "validation-output"],
		},
	},
	"integration-heavy": {
		id: "integration-heavy",
		summary: "Typecheck, tests, integration checks, and residual risk reporting.",
		acceptance: {
			level: "checked",
			evidence: ["changed-files", "commands-run", "validation-output", "residual-risks"],
			criteria: [{ id: "integration", must: "Run the smallest meaningful integration or unit coverage for affected runtime behavior.", evidence: ["commands-run", "validation-output"] }],
		},
	},
	"infra-k8s": {
		id: "infra-k8s",
		summary: "Helm/template/terraform/kube validation when tools are available.",
		acceptance: {
			level: "checked",
			evidence: ["changed-files", "commands-run", "validation-output", "manual-notes"],
			criteria: [{ id: "rollback-note", must: "Include rollback or deployment safety note for production-facing infra changes.", evidence: ["manual-notes"] }],
		},
	},
	"security-audit": {
		id: "security-audit",
		summary: "Security-sensitive validation with explicit audit findings.",
		acceptance: { level: "reviewed", evidence: ["changed-files", "review-findings", "validation-output", "residual-risks"] },
	},
	"research-evidence": {
		id: "research-evidence",
		summary: "Requires cited external or repository evidence before planning changes.",
		acceptance: { level: "checked", evidence: ["manual-notes", "validation-output"], criteria: [{ id: "research", must: "Record the source evidence that justifies the plan.", evidence: ["manual-notes"] }] },
	},
	"architecture-review": {
		id: "architecture-review",
		summary: "Plan/review evidence for architecture-first work.",
		acceptance: { level: "attested", evidence: ["manual-notes", "review-findings"] },
	},
};

export function getRuntimeProfile(id: BaseRuntime): RuntimeProfileBody {
	return RUNTIME_PROFILES[id];
}

export function getWorkPatternProfile(id: WorkPattern): WorkPatternProfile {
	return WORK_PATTERN_PROFILES[id];
}

export function getDomainOverlayProfile(id: string): DomainOverlayProfile | undefined {
	return DOMAIN_OVERLAY_PROFILES[id];
}

export function getValidatorPackProfile(id: ValidatorPack): ValidatorPackProfile {
	return VALIDATOR_PACK_PROFILES[id];
}
