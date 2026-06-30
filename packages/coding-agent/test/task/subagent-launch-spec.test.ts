import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@steve-z8k/pi-agent-core";
import {
	buildSubagentLaunchSpec,
	isSubagentModelProfileKey,
	SUBAGENT_MODEL_PROFILE_KEYS,
} from "@steve-z8k/pi-coding-agent/task/subagent-launch-spec";
import type { AgentDefinition } from "@steve-z8k/pi-coding-agent/task/types";

const agent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	source: "bundled",
	tools: ["read", "yield"],
	spawns: [],
};

describe("SubagentLaunchSpec", () => {
	it("recognizes the user-facing model profile keys", () => {
		expect(SUBAGENT_MODEL_PROFILE_KEYS).toEqual(["ultra", "deep", "flash", "spark"]);
		for (const key of SUBAGENT_MODEL_PROFILE_KEYS) {
			expect(isSubagentModelProfileKey(key)).toBe(true);
		}
		expect(isSubagentModelProfileKey("codexHigh")).toBe(false);
	});

	it("builds a contract launch spec with explicit context and revival policy", () => {
		const spec = buildSubagentLaunchSpec({
			id: "AuditOne",
			agent,
			displayName: "Risk audit",
			modelSelector: "deep",
			thinkingLevel: ThinkingLevel.High,
			taskDepth: 1,
			task: "Assignment:\nCheck the risky path.",
			assignment: "Check the risky path.",
			context: "Shared context.",
			tools: ["read", "yield"],
			spawns: "",
		});

		expect(spec).toEqual({
			id: "AuditOne",
			agentName: "task",
			displayName: "Risk audit",
			modelProfile: {
				key: "deep",
				selector: "deep",
				thinkingLevel: ThinkingLevel.High,
			},
			taskDepth: 1,
			contextProfile: "contract",
			contract: {
				task: "Assignment:\nCheck the risky path.",
				assignment: "Check the risky path.",
				context: "Shared context.",
			},
			tools: {
				allow: ["read", "yield"],
				deny: [],
			},
			irc: {
				enabled: true,
				revivable: false,
			},
			memory: {
				mode: "off",
			},
			extensions: {
				allowContextHooks: false,
			},
			contextAudit: [
				{
					status: "allowed",
					source: "thin-subagent-system-prompt",
					reason: "contract subagents receive only the thin runtime prompt",
				},
				{
					status: "allowed",
					source: "task-contract",
					reason: "assignment is the subagent's explicit contract",
				},
				{
					status: "allowed",
					source: "selected-tools",
					reason: "tool surface is selected from the agent definition and task depth",
				},
				{
					status: "allowed",
					source: "live-irc",
					reason: "IRC is allowed only while the contract subagent is running",
				},
				{
					status: "denied",
					source: "parent-full-system-prompt",
					reason: "contract subagents must not inherit the parent prompt stack",
				},
				{
					status: "denied",
					source: "parent-context-files",
					reason: "AGENTS.md and context files are not forwarded into the subagent provider context",
				},
				{
					status: "denied",
					source: "parent-workspace-tree",
					reason: "workspace tree summaries are not forwarded into the subagent provider context",
				},
				{
					status: "denied",
					source: "memory-instructions",
					reason: "contract subagents disable memory-backed system prompt additions by default",
				},
				{
					status: "denied",
					source: "autolearn",
					reason: "contract subagents do not schedule auto-learn follow-up context",
				},
				{
					status: "denied",
					source: "eager-task-todo-preludes",
					reason: "contract subagents do not receive eager delegation or todo nudges by default",
				},
				{
					status: "denied",
					source: "extension-context-hooks",
					reason: "extension context and before-provider hooks are disabled by default",
				},
			],
			spawns: "",
		});
	});
});
