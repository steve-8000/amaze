import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function file(path) {
	return join(root, path);
}

function read(path) {
	return readFileSync(file(path), "utf8");
}

function exists(path) {
	return existsSync(file(path));
}

function includes(path, needles) {
	if (!exists(path)) return { ok: false, detail: `${path} is missing` };
	const text = read(path);
	const missing = needles.filter((needle) => !text.includes(needle));
	return {
		ok: missing.length === 0,
		detail: missing.length === 0 ? `${path} contains required evidence` : `${path} missing: ${missing.join(", ")}`,
	};
}

function excludes(path, needles) {
	if (!exists(path)) return { ok: true, detail: `${path} is absent` };
	const text = read(path);
	const present = needles.filter((needle) => text.includes(needle));
	return {
		ok: present.length === 0,
		detail: present.length === 0 ? `${path} excludes removed markers` : `${path} still contains: ${present.join(", ")}`,
	};
}

const checks = [
	{
		name: "Orchestrator uses direct role-agent routing",
		weight: 14,
		...includes("vendor/amaze-subagents/src/harness/orchestrator/agent-router.ts", [
			"routeDirectAgent",
			"ROLE_AGENTS",
			"agent_direct",
			"MAX_DIRECT_AGENT_ROUTE_CHANGES",
		]),
	},
	{
		name: "Orchestrator profile modules are removed",
		weight: 12,
		ok:
			!exists("vendor/amaze-subagents/src/harness/orchestrator/profile-catalog.ts") &&
			!exists("vendor/amaze-subagents/src/harness/orchestrator/profile-router.ts") &&
			!exists("vendor/amaze-subagents/src/harness/orchestrator/profiled-orchestration-plan.ts"),
		detail: "profile catalog/router/plan files are absent",
	},
	{
		name: "Child tool allowlist forwarding is removed",
		weight: 12,
		ok:
			!exists("vendor/amaze-subagents/src/runs/shared/mcp-direct-tool-allowlist.ts") &&
			excludes("vendor/amaze-subagents/src/runs/shared/amaze-args.ts", ["--tools"]).ok,
		detail: "no mcp direct allowlist module and buildPiArgs does not emit --tools",
	},
	{
		name: "Bundled agents do not declare fixed tool lists",
		weight: 8,
		ok: [
			"context-builder",
			"delegate",
			"oracle",
			"planner",
			"researcher",
			"reviewer",
			"scout",
			"worker",
		].every((agent) => excludes(`vendor/amaze-subagents/agents/${agent}.md`, ["\ntools:"]).ok),
		detail: "bundled agent frontmatter has no tools allowlist",
	},
	{
		name: "Repeated tool-call guard is implemented and tested",
		weight: 10,
		ok:
			includes("vendor/amaze-subagents/src/runs/shared/repeated-tool-call-guard.ts", ["createRepeatedToolCallGuard", "toolCallSignature"]).ok &&
			includes("vendor/amaze-subagents/test/unit/repeated-tool-call-guard.test.ts", ["detects repeated identical tool calls", "normalizes object key order"]).ok,
		detail: "subagent repeated tool-call guard and tests exist",
	},
	{
		name: "Read-loop guard is implemented and tested",
		weight: 10,
		ok:
			includes("packages/coding-agent/src/core/extensions/builtin/compaction/read-loop-guard.ts", ["ReadLoopGuard", "Blocked repeated read", "overlaps"]).ok &&
			includes("packages/coding-agent/test/compaction/read-loop-guard.test.ts", ["blocks identical read calls", "blocks overlapping read ranges"]).ok,
		detail: "coding-agent read-loop guard and tests exist",
	},
	{
		name: "Core automatic memory reranker is removed",
		weight: 10,
		ok:
			!exists("packages/coding-agent/src/core/memory-reranker.ts") &&
			!exists("packages/coding-agent/test/memory-reranker.test.ts") &&
			!exists("packages/coding-agent/test/agent-session-memory-rerank.test.ts") &&
			excludes("packages/coding-agent/src/core/agent-session.ts", ["recallMemoryForTurn", "storeMemoryFact"]).ok,
		detail: "memory reranker files and automatic turn memory hooks are absent",
	},
	{
		name: "Rocky tools remain registered while legacy names stay inactive",
		weight: 10,
		ok:
			includes("packages/coding-agent/src/core/tools/xenonite.ts", ["ROCKY_TOOL_SPECS", "rocky_search", "rocky_memory_recall", "xenoniteToolNames = ROCKY_TOOL_SPECS"]).ok &&
			includes("packages/coding-agent/test/xenonite-core-tools.test.ts", ["rocky_search", "mem_recall", "context_engine", "toBeUndefined"]).ok,
		detail: "Rocky specs are active and tests assert legacy tools are not exposed",
	},
	{
		name: "Path memory profile injection is removed",
		weight: 8,
		ok:
			excludes("vendor/amaze-subagents/src/harness/path-memory.ts", ["profile.md", "profile?:"]).ok &&
			excludes("vendor/amaze-subagents/src/harness/path-registry.ts", ["profile.md"]).ok,
		detail: "path memory no longer reads or bootstraps profile.md",
	},
	{
		name: "Runtime docs describe the direct non-profile state",
		weight: 6,
		ok:
			includes("AGENTS.md", ["direct single-agent dispatch helper", "must not create intermediate routing plans"]).ok &&
			includes("README.md", ["No automatic memory middleware", "Rocky-backed tools are registered through the amaze extension/tool layer"]).ok,
		detail: "operator-facing docs match runtime constraints",
	},
];

let score = 0;
for (const check of checks) {
	if (check.ok) score += check.weight;
	console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} (${check.weight}): ${check.detail}`);
}

console.log(`Agent runtime verifier score: ${score}/100`);
if (score < 98) {
	process.exitCode = 1;
}
