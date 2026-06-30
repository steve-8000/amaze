/**
 * System prompt section layer: default context constructors and render-data builder.
 *
 * Owns the all-empty defaults for the additive prompt seams plus the helper that
 * turns prepared system-prompt inputs into the typed render-data object. Keeping
 * these constructors here means callers never hand-roll the empty shapes or the
 * final data object, and the "behavior-neutral by default" guarantee lives in
 * one place.
 */

import type { Skill } from "../../../extensibility/skills";
import type { WorkspaceTree } from "../../../workspace-tree";
import type { AlwaysApplyRule, SystemPromptRenderData } from "./types";

export interface BuildSystemPromptRenderDataInput {
	systemPromptCustomization: string;
	customPrompt: string | undefined;
	appendPrompt: string | undefined;
	tools: string[];
	toolInfo: Array<{ name: string; internalName: string; label: string; description: string }>;
	toolInventory: string;
	inlineToolDescriptors: boolean;
	toolListMode: boolean;
	toolRefs: Record<string, string>;
	environment: Array<{ label: string; value: string }>;
	contextFiles: Array<{ path: string; content: string; depth?: number }>;
	agentsMdFiles: string[];
	workspaceTree: WorkspaceTree;
	skills: Skill[];
	rules: Array<{ name: string; description?: string; path: string; globs?: string[] }>;
	alwaysApplyRules: AlwaysApplyRule[];
	date: string;
	dateTime: string;
	cwd: string;
	model: string;
	personality: string;
	intentTracing: boolean;
	intentField: string;
	mcpDiscoveryMode: boolean;
	hasMCPDiscoveryServers: boolean;
	mcpDiscoveryServerSummaries: string[];
	eagerTasks: boolean;
	eagerTasksAlways: boolean;
	taskBatch: boolean;
	secretsEnabled: boolean;
	hasObsidian: boolean;
	includeWorkspaceTree: boolean;
}

/** Construct an all-empty {@link SystemPromptAddenda}. */
export function emptyPromptAddenda(): import("./types").SystemPromptAddenda {
	return { model: [], editMode: [] };
}

/** Construct all-empty {@link SharedTailSlots}; assembling these is a no-op. */
export function emptySharedTailSlots(): import("./types").SharedTailSlots {
	return { lead: [], trail: [] };
}

/**
 * Build the typed render-data object handed to the system prompt templates.
 *
 * `agentsMdFiles` stays as a prepared input so the helper can keep the output
 * shape aligned with the existing template contract without callers having to
 * assemble the nested `agentsMdSearch` object themselves.
 */
export function buildSystemPromptRenderData(input: BuildSystemPromptRenderDataInput): SystemPromptRenderData {
	const { agentsMdFiles, ...renderData } = input;
	return {
		...renderData,
		appendPrompt: input.appendPrompt ?? "",
		agentsMdSearch: { files: agentsMdFiles },
		promptAddenda: emptyPromptAddenda(),
	};
}
