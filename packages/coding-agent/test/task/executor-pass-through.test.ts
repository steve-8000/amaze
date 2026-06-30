/**
 * Verifies parent-discovered rules, extensions, and custom tools are forwarded
 * to `createAgentSession` so subagents skip the FS scans the parent already
 * paid for. Regression guard for issue #2190.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Rule } from "@steve-z8k/pi-coding-agent/capability/rule";
import type { ModelRegistry } from "@steve-z8k/pi-coding-agent/config/model-registry";
import { Settings } from "@steve-z8k/pi-coding-agent/config/settings";
import type { ToolPathWithSource } from "@steve-z8k/pi-coding-agent/extensibility/custom-tools";
import type { LoadExtensionsResult } from "@steve-z8k/pi-coding-agent/extensibility/extensions/types";
import type { CreateAgentSessionResult } from "@steve-z8k/pi-coding-agent/sdk";
import * as sdkModule from "@steve-z8k/pi-coding-agent/sdk";
import type { AgentSession, AgentSessionEvent, PromptOptions } from "@steve-z8k/pi-coding-agent/session/agent-session";
import { createSubagentSettings, runSubprocess } from "@steve-z8k/pi-coding-agent/task/executor";
import { buildSubagentLaunchSpec } from "@steve-z8k/pi-coding-agent/task/subagent-launch-spec";
import type { AgentDefinition } from "@steve-z8k/pi-coding-agent/task/types";
import { EventBus } from "@steve-z8k/pi-coding-agent/utils/event-bus";

function createMockSession(onPrompt: (params: { emit: (event: AgentSessionEvent) => void }) => void): AgentSession {
	const listeners: Array<(event: AgentSessionEvent) => void> = [];
	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const session = {
		state: { messages: [] },
		agent: { state: { systemPrompt: ["test"] } },
		model: undefined,
		extensionRunner: undefined,
		sessionManager: { appendSessionInit: () => {} },
		getActiveToolNames: () => ["read", "yield"],
		setActiveToolsByName: async (_toolNames: string[]) => {},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		prompt: async (_text: string, _options?: PromptOptions) => {
			onPrompt({ emit });
		},
		waitForIdle: async () => {},
		getLastAssistantMessage: () => undefined,
		abort: async () => {},
		dispose: async () => {},
	};
	return session as unknown as AgentSession;
}

function yieldEmittingSession(): AgentSession {
	return createMockSession(({ emit }) => {
		emit({
			type: "tool_execution_end",
			toolCallId: "tool-pass-through",
			toolName: "yield",
			result: {
				content: [{ type: "text", text: "Result submitted." }],
				details: { status: "success", data: { ok: true } },
			},
			isError: false,
		});
	});
}

function createSessionResult(session: AgentSession): CreateAgentSessionResult {
	return {
		session,
		extensionsResult: { extensions: [], errors: [], runtime: {} as unknown } as unknown as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	};
}

const baseAgent: AgentDefinition = {
	name: "task",
	description: "test",
	systemPrompt: "test",
	source: "bundled",
};

const baseOptions = {
	cwd: "/tmp",
	agent: baseAgent,
	task: "do work",
	index: 0,
	id: "subagent-pass-through",
	settings: Settings.isolated(),
	modelRegistry: { refresh: async () => {} } as unknown as ModelRegistry,
};

describe("runSubprocess parent-discovery pass-through (issue #2190)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("turns off main-session autolearn and eager prompts in subagent settings", () => {
		const settings = createSubagentSettings(
			Settings.isolated({
				"autolearn.enabled": true,
				"todo.reminders": true,
				"todo.eager": "always",
				"task.eager": "always",
			}),
		);

		expect(settings.get("autolearn.enabled")).toBe(false);
		expect(settings.get("todo.eager")).toBe("default");
		expect(settings.get("task.eager")).toBe("default");
	});

	it("forwards rules, preloadedExtensionPaths, and preloadedCustomToolPaths while stripping parent context payloads", async () => {
		const session = yieldEmittingSession();
		const spy = vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue(createSessionResult(session));

		const rules: Rule[] = [{ name: "rule-a" } as unknown as Rule];
		const preloadedExtensionPaths = ["/abs/parent/.amaze/extensions/foo.ts"];
		const preloadedCustomToolPaths: ToolPathWithSource[] = [
			{ path: "tools/x.ts", source: { provider: "config", providerName: "Config", level: "project" } },
		];
		const contextFiles = [{ path: "/tmp/AGENTS.md", content: "# parent context" }];
		const workspaceTree = {
			rootPath: "/tmp",
			rendered: "parent tree",
			truncated: false,
			totalLines: 7,
			agentsMdFiles: ["/tmp/AGENTS.md"],
		};

		const result = await runSubprocess({
			...baseOptions,
			rules,
			preloadedExtensionPaths,
			preloadedCustomToolPaths,
			contextFiles,
			workspaceTree,
		});

		expect(result.exitCode).toBe(0);
		expect(spy).toHaveBeenCalledTimes(1);
		const forwarded = spy.mock.calls[0]?.[0];
		// Identity, not equality: passing a clone would defeat the perf fix.
		expect(forwarded?.rules).toBe(rules);
		expect(forwarded?.preloadedExtensionPaths).toBe(preloadedExtensionPaths);
		expect(forwarded?.preloadedCustomToolPaths).toBe(preloadedCustomToolPaths);
		expect(forwarded?.contextFiles).toEqual([]);
		expect(forwarded?.allowExtensionContextHooks).toBe(false);
		expect(forwarded?.workspaceTree).toEqual({
			rootPath: "/tmp",
			rendered: "",
			truncated: false,
			totalLines: 0,
			agentsMdFiles: [],
		});
	});

	it("maps the contract launch spec extension policy into session creation", async () => {
		const session = yieldEmittingSession();
		const spy = vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue(createSessionResult(session));
		const launchSpec = buildSubagentLaunchSpec({
			id: "subagent-policy",
			agent: baseAgent,
			displayName: "task",
			taskDepth: 0,
			task: "do work",
		});

		const result = await runSubprocess({
			...baseOptions,
			id: "subagent-policy",
			launchSpec,
		});

		expect(result.exitCode).toBe(0);
		expect(spy.mock.calls[0]?.[0]?.allowExtensionContextHooks).toBe(false);
	});

	it("forwards undefined when the parent has not pre-discovered state", async () => {
		const session = yieldEmittingSession();
		const spy = vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue(createSessionResult(session));

		const result = await runSubprocess({ ...baseOptions });

		expect(result.exitCode).toBe(0);
		const forwarded = spy.mock.calls[0]?.[0];
		expect(forwarded?.rules).toBeUndefined();
		expect(forwarded?.preloadedExtensionPaths).toBeUndefined();
		expect(forwarded?.preloadedCustomToolPaths).toBeUndefined();
	});

	it("records the spawning agent as parentAgentId, distinct from the child's own id and prefix", async () => {
		const session = yieldEmittingSession();
		const spy = vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue(createSessionResult(session));

		const result = await runSubprocess({
			...baseOptions,
			id: "ChildAgent",
			parentAgentId: "SpawnerAgent",
		});

		expect(result.exitCode).toBe(0);
		const forwarded = spy.mock.calls[0]?.[0];
		// The registry parent is the spawning agent — never the child itself (the
		// self-parent bug). The child's own id still drives both its agent id and
		// its artifact/output-id prefix; those must not double as the parent link.
		expect(forwarded?.parentAgentId).toBe("SpawnerAgent");
		expect(forwarded?.agentId).toBe("ChildAgent");
		expect(forwarded?.parentTaskPrefix).toBe("ChildAgent");
	});
});
