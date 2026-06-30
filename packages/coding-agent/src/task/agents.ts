/**
 * Bundled agent definitions.
 *
 * Agents are embedded at build time via Bun's import with { type: "text" }.
 */
import { Effort } from "@steve-z8k/pi-ai";
import { parseFrontmatter, prompt } from "@steve-z8k/pi-utils";
import { parseAgentFields } from "../discovery/helpers";
import contractAgentMd from "../prompts/agents/contract.md" with { type: "text" };
// Embed agent markdown files at build time
import agentFrontmatterTemplate from "../prompts/agents/frontmatter.md" with { type: "text" };

import type { AgentDefinition, AgentSource } from "./types";

interface AgentFrontmatter {
	name: string;
	description: string;
	tools?: string[];
	spawns?: string;
	model?: string | string[];
	thinkingLevel?: string;
	blocking?: boolean;
}

interface EmbeddedAgentDef {
	fileName: string;
	frontmatter?: AgentFrontmatter;
	template: string;
}

function buildAgentContent(def: EmbeddedAgentDef): string {
	const body = prompt.render(def.template);
	if (!def.frontmatter) return body;
	return prompt.render(agentFrontmatterTemplate, { ...def.frontmatter, body });
}

const EMBEDDED_AGENT_DEFS: EmbeddedAgentDef[] = [
	{
		fileName: "ultra.md",
		frontmatter: {
			name: "ultra",
			description: "Highest-capability user-invoked agent for hard architecture, root cause, and implementation",
			tools: [
				"read",
				"search",
				"find",
				"mcp__circle_graph",
				"mcp__circle_search",
				"mcp__circle_snippet",
				"mcp__circle_trace",
				"mcp__circle_architecture",
				"skill_search",
				"skill_get",
				"bash",
				"web_search",
				"ast_grep",
			],
			model: "pi/ultra",
			thinkingLevel: Effort.XHigh,
		},
		template: contractAgentMd,
	},
	{
		fileName: "deep.md",
		frontmatter: {
			name: "deep",
			description: "Auditor for validation, merge synthesis, final fixes, and quality gates",
			tools: [
				"read",
				"search",
				"find",
				"mcp__circle_graph",
				"mcp__circle_search",
				"mcp__circle_snippet",
				"mcp__circle_trace",
				"mcp__circle_architecture",
				"skill_search",
				"skill_get",
				"bash",
				"edit",
				"write",
				"ast_grep",
				"ast_edit",
				"report_finding",
			],
			model: "pi/deep",
			thinkingLevel: Effort.High,
		},
		template: contractAgentMd,
	},
	{
		fileName: "flash.md",
		frontmatter: {
			name: "flash",
			description: "Fast sandbox coding worker for independent implementation attempts",
			model: "pi/flash",
			thinkingLevel: Effort.Medium,
		},
		template: contractAgentMd,
	},
	{
		fileName: "spark.md",
		frontmatter: {
			name: "spark",
			description: "Specialist for GitHub commit workflows and web information search",
			tools: [
				"read",
				"search",
				"find",
				"mcp__circle_graph",
				"mcp__circle_search",
				"mcp__circle_snippet",
				"mcp__circle_trace",
				"mcp__circle_architecture",
				"skill_search",
				"skill_get",
				"bash",
				"web_search",
				"github",
				"ast_grep",
			],
			model: "pi/spark",
			thinkingLevel: Effort.Medium,
		},
		template: contractAgentMd,
	},
];

// Computed lazily on first loadBundledAgents() call to avoid eager prompt.render at module load.

export class AgentParsingError extends Error {
	constructor(
		error: Error,
		readonly source?: unknown,
	) {
		super(`Failed to parse agent: ${error.message}`, { cause: error });
		this.name = "AgentParsingError";
	}

	toString(): string {
		const details: string[] = [this.message];
		if (this.source !== undefined) {
			details.push(`Source: ${JSON.stringify(this.source)}`);
		}
		if (this.cause && typeof this.cause === "object" && "stack" in this.cause && this.cause.stack) {
			details.push(`Stack:\n${this.cause.stack}`);
		} else if (this.stack) {
			details.push(`Stack:\n${this.stack}`);
		}
		return details.join("\n\n");
	}
}

/**
 * Parse an agent from embedded content.
 */
export function parseAgent(
	filePath: string,
	content: string,
	source: AgentSource,
	level: "fatal" | "warn" | "off" = "fatal",
): AgentDefinition {
	const { frontmatter, body } = parseFrontmatter(content, {
		location: filePath,
		level,
	});
	const fields = parseAgentFields(frontmatter);
	if (!fields) {
		throw new AgentParsingError(new Error(`Invalid agent field: ${filePath}\n${content}`), filePath);
	}
	return {
		...fields,
		systemPrompt: body,
		source,
		filePath,
	};
}

/** Cache for bundled agents */
let bundledAgentsCache: AgentDefinition[] | null = null;

/**
 * Load all bundled agents from embedded content.
 * Results are cached after first load.
 */
export function loadBundledAgents(): AgentDefinition[] {
	if (bundledAgentsCache !== null) {
		return bundledAgentsCache;
	}
	bundledAgentsCache = EMBEDDED_AGENT_DEFS.map(def =>
		parseAgent(`embedded:${def.fileName}`, buildAgentContent(def), "bundled"),
	);
	return bundledAgentsCache;
}

/**
 * Get a bundled agent by name.
 */
export function getBundledAgent(name: string): AgentDefinition | undefined {
	return loadBundledAgents().find(a => a.name === name);
}

/**
 * Get all bundled agents as a map keyed by name.
 */
export function getBundledAgentsMap(): Map<string, AgentDefinition> {
	const map = new Map<string, AgentDefinition>();
	for (const agent of loadBundledAgents()) {
		map.set(agent.name, agent);
	}
	return map;
}

/**
 * Clear the bundled agents cache (for testing).
 */
export function clearBundledAgentsCache(): void {
	bundledAgentsCache = null;
}

// Re-export for backward compatibility
export const BUNDLED_AGENTS = loadBundledAgents;
