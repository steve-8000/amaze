import type { ThinkingLevel } from "@amaze/pi-agent-core";
import type { AgentDefinition } from "./types";

export const SUBAGENT_MODEL_PROFILE_KEYS = [
	"claude_high",
	"claude_low",
	"codex_high",
	"codex_low",
	"xai",
	"local_llm",
] as const;

export type SubagentModelProfileKey = (typeof SUBAGENT_MODEL_PROFILE_KEYS)[number];
export type SubagentContextProfile = "contract";
export type SubagentMemoryMode = "off";

export interface SubagentModelProfile {
	key?: SubagentModelProfileKey;
	selector?: string | string[];
	thinkingLevel?: ThinkingLevel;
}

export interface SubagentContract {
	task: string;
	assignment?: string;
	context?: string;
}

export type SubagentContextAuditStatus = "allowed" | "denied";

export interface SubagentContextAuditEntry {
	status: SubagentContextAuditStatus;
	source: string;
	reason: string;
}

export interface SubagentLaunchSpec {
	id: string;
	agentName: string;
	displayName: string;
	modelProfile: SubagentModelProfile;
	taskDepth: number;
	contextProfile: SubagentContextProfile;
	contract: SubagentContract;
	tools: {
		allow: string[];
		deny: string[];
	};
	irc: {
		enabled: boolean;
		revivable: boolean;
	};
	memory: {
		mode: SubagentMemoryMode;
	};
	extensions: {
		allowContextHooks: boolean;
	};
	contextAudit: SubagentContextAuditEntry[];
	spawns: string;
}

export interface BuildSubagentLaunchSpecOptions {
	id: string;
	agent: AgentDefinition;
	displayName: string;
	modelSelector?: string | string[];
	thinkingLevel?: ThinkingLevel;
	taskDepth: number;
	task: string;
	assignment?: string;
	context?: string;
	tools?: string[];
	spawns?: string;
	ircEnabled?: boolean;
}

const SUBAGENT_MODEL_PROFILE_KEY_SET = new Set<string>(SUBAGENT_MODEL_PROFILE_KEYS);

export function isSubagentModelProfileKey(value: string | undefined): value is SubagentModelProfileKey {
	return value !== undefined && SUBAGENT_MODEL_PROFILE_KEY_SET.has(value);
}

function resolveModelProfileKey(selector: string | string[] | undefined): SubagentModelProfileKey | undefined {
	if (typeof selector === "string") {
		return isSubagentModelProfileKey(selector) ? selector : undefined;
	}
	const firstProfile = selector?.find(isSubagentModelProfileKey);
	return firstProfile;
}

export function buildSubagentLaunchSpec(options: BuildSubagentLaunchSpecOptions): SubagentLaunchSpec {
	const ircEnabled = options.ircEnabled ?? true;
	return {
		id: options.id,
		agentName: options.agent.name,
		displayName: options.displayName,
		modelProfile: {
			key: resolveModelProfileKey(options.modelSelector),
			selector: options.modelSelector,
			thinkingLevel: options.thinkingLevel,
		},
		taskDepth: options.taskDepth,
		contextProfile: "contract",
		contract: {
			task: options.task,
			assignment: options.assignment,
			context: options.context,
		},
		tools: {
			allow: options.tools ?? options.agent.tools ?? [],
			deny: [],
		},
		irc: {
			enabled: options.ircEnabled ?? true,
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
			...(ircEnabled
				? [
						{
							status: "allowed" as const,
							source: "live-irc",
							reason: "IRC is allowed only while the contract subagent is running",
						},
					]
				: []),
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
		spawns: options.spawns ?? "",
	};
}
