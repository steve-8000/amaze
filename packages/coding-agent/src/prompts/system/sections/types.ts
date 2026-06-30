/**
 * System prompt section layer: typed prompt data.
 *
 * This module owns the typed view of the data object handed to the system
 * prompt templates. It was extracted from `system-prompt.ts` so the prompt
 * data contract lives in one place that the assembly layer can depend on
 * without pulling in the full builder. Field shapes match what the templates
 * already consume, so this adds compile-time guarantees without altering
 * rendered output.
 */

import type { Skill } from "../../../extensibility/skills";
import type { WorkspaceTree } from "../../../workspace-tree";

/** Rule with `alwaysApply=true`; its full content is injected into the prompt. */
export interface AlwaysApplyRule {
	name: string;
	content: string;
	path: string;
}

/**
 * Default-empty seam reserved for future model/edit-mode prompt notes.
 * Both buckets render to nothing today; populating them later lets callers
 * append model- or edit-mode-specific guidance without reshaping the data object.
 */
export interface SystemPromptAddenda {
	/** Notes tied to the active model. Empty by default. */
	model: string[];
	/** Notes tied to the active edit mode. Empty by default. */
	editMode: string[];
}

/**
 * Default-empty slot placeholders for the shared-system-prompt tail.
 *
 * The shared tail is currently a single rendered block. These slots let the
 * assembly layer splice additional content before/after that block without
 * reshaping the renderer. Both buckets are empty by default, so the assembled
 * tail is byte-for-byte identical to rendering the template alone.
 */
export interface SharedTailSlots {
	/** Blocks rendered before the shared tail body. Empty by default. */
	lead: string[];
	/** Blocks rendered after the shared tail body. Empty by default. */
	trail: string[];
}

/**
 * Typed view of the data object handed to the system prompt templates.
 * Mirrors the inline object built in `buildSystemPrompt`; field shapes
 * match what the templates already consume, so this adds compile-time guarantees
 * without altering rendered output.
 */
export type SystemPromptRenderData = {
	systemPromptCustomization: string;
	customPrompt: string | undefined;
	appendPrompt: string;
	tools: string[];
	toolInfo: Array<{ name: string; internalName: string; label: string; description: string }>;
	toolInventory: string;
	inlineToolDescriptors: boolean;
	toolListMode: boolean;
	toolRefs: Record<string, string>;
	environment: Array<{ label: string; value: string }>;
	contextFiles: Array<{ path: string; content: string; depth?: number }>;
	agentsMdSearch: { files: string[] };
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
	/**
	 * Default-empty seam for future model/edit-mode prompt notes. Templates do not
	 * reference it yet, so it has no effect on current output.
	 */
	promptAddenda: SystemPromptAddenda;
};
