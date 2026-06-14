import { describe, expect, it } from "bun:test";
import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as z from "zod/v4";
import { parseKnowledgeRegistryPage } from "../src/agency-brain";
import { Settings } from "../src/config/settings";
import { createMCPToolName } from "../src/mcp/tool-bridge";
import { KnowledgeQueryTool, KnowledgeRegistryTool, createTools, type ToolSession } from "../src/tools";

describe("parseKnowledgeRegistryPage", () => {
	it("parses a valid frontmatter registry", () => {
		const registry = parseKnowledgeRegistryPage(`---
type: knowledge-registry
version: 1
entries:
  - name: lifecycle-email-copywriter
    description: Writes lifecycle email copy
    vertical: lifecycle-email
    knowledge:
      agencySourceId: okf
      clientSourceId: client/acme
    tools: [knowledge_query, read]
    approvals: [publish]
    status: active
---
`);

		expect(registry).toEqual({
			type: "knowledge-registry",
			version: 1,
			entries: [
				{
					name: "lifecycle-email-copywriter",
					description: "Writes lifecycle email copy",
					vertical: "lifecycle-email",
					knowledge: {
						agencySourceId: "okf",
						clientSourceId: "client/acme",
					},
					tools: ["knowledge_query", "read"],
					approvals: ["publish"],
					status: "active",
				},
			],
			warnings: [],
		});
	});

	it("drops invalid entries and exposes warnings", () => {
		const registry = parseKnowledgeRegistryPage(`---
type: knowledge-registry
version: 1
entries:
  - name: missing-description
    tools: [read]
  - description: Missing name
  - not-an-object
  - name: valid-agent
    description: Valid entry
---
`);

		expect(registry.entries).toEqual([
			{
				name: "valid-agent",
				description: "Valid entry",
				vertical: undefined,
				knowledge: undefined,
				tools: [],
				approvals: [],
				status: "draft",
			},
		]);
		expect(registry.warnings).toEqual([
			"Dropped entry missing-description: description is required.",
			"Dropped entry at index 1: name is required.",
			"Dropped entry at index 2: entry must be an object.",
		]);
	});

	it("defaults missing status to draft", () => {
		const registry = parseKnowledgeRegistryPage(`---
type: knowledge-registry
version: 1
entries:
  - name: strategy-agent
    description: Drafts strategy notes
    tools: knowledge_query, read
    approvals: publish, send-email
---
`);

		expect(registry.entries[0]?.status).toBe("draft");
		expect(registry.entries[0]?.tools).toEqual(["knowledge_query", "read"]);
		expect(registry.entries[0]?.approvals).toEqual(["publish", "send-email"]);
	});
});

function createTestSession(settings: Settings, tool?: AgentTool): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings,
		getToolByName: name => (tool && name === tool.name ? tool : undefined),
	};
}

function fakeMcpTool(
	name: string,
	parameters: unknown,
	execute: (params: unknown) => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>,
): AgentTool {
	return {
		name,
		label: name,
		description: "fake MCP tool",
		parameters: parameters as AgentTool["parameters"],
		strict: true,
		execute: async (_toolCallId, params) => execute(params),
	} as AgentTool;
}

function firstText(result: AgentToolResult<unknown>): string {
	const first = result.content.find(part => part.type === "text");
	return first?.type === "text" ? first.text : "";
}

describe("knowledge tools", () => {
	it("keeps knowledge tools unavailable until explicitly enabled", async () => {
		const disabled = await createTools(createTestSession(Settings.isolated({ "knowledge.enabled": false })), [
			"knowledge_query",
			"knowledge_registry",
		]);
		expect(disabled.map(tool => tool.name)).not.toContain("knowledge_query");
		expect(disabled.map(tool => tool.name)).not.toContain("knowledge_registry");

		const enabled = await createTools(createTestSession(Settings.isolated({ "knowledge.enabled": true })), [
			"knowledge_query",
			"knowledge_registry",
		]);
		expect(enabled.map(tool => tool.name)).toEqual(expect.arrayContaining(["knowledge_query", "knowledge_registry"]));
	});

	it("reads the configured registry slug through the configured knowledge MCP get_page tool", async () => {
		const expectedToolName = createMCPToolName("memory-worker", "get_page");
		let capturedParams: unknown;
		const mcpTool = fakeMcpTool(expectedToolName, z.object({}), params => {
			capturedParams = params;
			return { content: [{ type: "text", text: "registry-page" }] };
		});
		const session = createTestSession(
			Settings.isolated({
				"knowledge.enabled": true,
				"knowledge.mcpServer": "memory-worker",
				"knowledge.registrySlug": "okf/custom-registry",
			}),
			mcpTool,
		);

		const result = await new KnowledgeRegistryTool(session).execute("call-1", { fuzzy: false });

		expect(firstText(result)).toBe("registry-page");
		expect(capturedParams).toEqual({ slug: "okf/custom-registry", fuzzy: false });
	});

	it("queries through the configured client source scope instead of raw broad knowledge access", async () => {
		const expectedToolName = createMCPToolName("memory-worker", "query");
		let capturedParams: unknown;
		const mcpTool = fakeMcpTool(
			expectedToolName,
			{
				type: "object",
				required: ["query", "source_id", "limit", "image", "image_mime", "mode", "cross_modal"],
				properties: {
					query: { type: "string" },
					source_id: { type: "string" },
					limit: { type: "integer" },
					image: { type: "string" },
					image_mime: { type: "string" },
					mode: { type: "string", enum: ["conservative", "balanced", "tokenmax"] },
					cross_modal: { type: "string", enum: ["text", "image", "both", "auto"] },
				},
			},
			params => {
				capturedParams = params;
				return { content: [{ type: "text", text: "query-result" }] };
			},
		);
		const session = createTestSession(
			Settings.isolated({
				"knowledge.enabled": true,
				"knowledge.agencySourceId": "okf",
				"knowledge.defaultClientSourceId": "client/default",
				"knowledge.mcpServer": "memory-worker",
			}),
			mcpTool,
		);

		const result = await new KnowledgeQueryTool(session).execute("call-2", {
			query: "lifecycle email examples",
			limit: 3,
		});

		expect(firstText(result)).toBe("query-result");
		expect(capturedParams).toEqual({
			query: "lifecycle email examples",
			source_id: "client/default",
			limit: 3,
			image: "",
			image_mime: "",
			mode: "balanced",
			cross_modal: "text",
		});
	});
});
