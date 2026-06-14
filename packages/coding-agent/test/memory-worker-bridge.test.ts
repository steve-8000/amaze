import { afterEach, describe, expect, it } from "bun:test";
import type { AgentTool, AgentToolResult } from "@amaze/agent-core";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { createMCPToolName } from "../src/mcp/tool-bridge";
import {
	KnowledgeQueryTool,
	KnowledgeRegistryTool,
	OkfBenchmarkRecordTool,
	OkfHealthTool,
	OkfPageGetTool,
	OkfQueryTool,
	OkfRecordTool,
	OkfToolMethodQueryTool,
	createTools,
	type ToolSession,
} from "../src/tools";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempOkfRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-memory-worker-"));
	cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

function createSession(settings: Settings, toolRegistry = new Map<string, AgentTool>()): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings,
		getToolByName: name => toolRegistry.get(name),
	};
}

function firstText(result: AgentToolResult<unknown>): string {
	const first = result.content.find(part => part.type === "text");
	return first?.type === "text" ? first.text : "";
}

function writeOkfPage(root: string, relativePath: string, claim: string): void {
	const target = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(
		target,
		[
			"---",
			`id: ${JSON.stringify(relativePath.replace(/\.md$/, ""))}`,
			"scope: global",
			"sourceRefs:",
			"  - kind: file",
			`    uri: ${JSON.stringify(relativePath)}`,
			"    contentHash: null",
			"    observedAt: null",
			"confidence: high",
			"filePath: null",
			"contentHash: null",
			"supersedes: null",
			"supersededBy: null",
			"staleAt: null",
			"tags:",
			"createdAt: 1",
			"updatedAt: 1",
			"---",
			"",
			claim,
			"",
		].join("\n"),
		"utf8",
	);
}

function okfTag(tag: string): string {
	return tag.replaceAll(":", "-");
}

function memoryWorkerSettings(root: string, extra: Record<string, unknown> = {}): Settings {
	return Settings.isolated({
		"knowledge.enabled": true,
		"knowledge.provider": "okf",
		"knowledge.okfPath": root,
		"knowledge.defaultClientSourceId": "__all__",
		"knowledge.mcpServer": "memory-worker",
		...extra,
	});
}

describe("local memory-worker bridge", () => {
	it("lets knowledge_query read matching local OKF data without an external MCP server", async () => {
		const root = tempOkfRoot();
		writeOkfPage(root, "client/acme/email-playbook.md", "Lifecycle email examples should use concise subject lines.");
		writeOkfPage(root, "client/acme/launch-plan.md", "Launch plans should list verifier evidence.");
		const settings = Settings.isolated({
			"knowledge.enabled": true,
			"knowledge.provider": "okf",
			"knowledge.okfPath": root,
			"knowledge.defaultClientSourceId": "__all__",
			"knowledge.mcpServer": "memory-worker",
		});
		const session = createSession(settings);
		const tools = await createTools(session, ["mcp__memory_worker_query"]);
		const registry = new Map(tools.map(tool => [tool.name, tool]));
		const queryTool = new KnowledgeQueryTool(createSession(settings, registry));

		const result = await queryTool.execute("call-query", { query: "lifecycle subject", limit: 5 });
		const text = firstText(result);

		expect(result.isError).toBeUndefined();
		expect(registry.has(createMCPToolName("memory-worker", "query"))).toBe(true);
		expect(text).toContain("Lifecycle email examples should use concise subject lines.");
		expect(text).not.toContain("Launch plans should list verifier evidence.");
	});

	it("lets knowledge_registry retrieve the configured local OKF page without an external MCP server", async () => {
		const root = tempOkfRoot();
		writeOkfPage(root, "okf/knowledge-registry.md", "Registry page: lifecycle-copywriter uses knowledge_query.");
		const settings = Settings.isolated({
			"knowledge.enabled": true,
			"knowledge.provider": "okf",
			"knowledge.okfPath": root,
			"knowledge.registrySlug": "okf/knowledge-registry",
			"knowledge.mcpServer": "memory-worker",
		});
		const session = createSession(settings);
		const tools = await createTools(session, ["mcp__memory_worker_get_page"]);
		const registry = new Map(tools.map(tool => [tool.name, tool]));
		const registryTool = new KnowledgeRegistryTool(createSession(settings, registry));

		const result = await registryTool.execute("call-registry", { fuzzy: false });
		const text = firstText(result);

		expect(result.isError).toBeUndefined();
		expect(registry.has(createMCPToolName("memory-worker", "get_page"))).toBe(true);
		expect(text).toContain("Registry page: lifecycle-copywriter uses knowledge_query.");
	});

	it("reports malformed OKF markdown through okf_health without throwing", async () => {
		const root = tempOkfRoot();
		writeOkfPage(root, "okf/knowledge-registry.md", "Registry page.");
		fs.writeFileSync(path.join(root, "broken.md"), "plain markdown is not an OKF document\n", "utf8");
		const tool = new OkfHealthTool(createSession(memoryWorkerSettings(root)));

		const result = await tool.execute("call-health", {});
		const text = firstText(result);

		expect(result.isError).toBeUndefined();
		expect(text).toContain("Invalid markdown: 1");
		const tools = await createTools(createSession(memoryWorkerSettings(root)), ["okf_health"]);
		expect(tools.map(tool => tool.name)).toContain("okf_health");
		expect(text).toContain("broken.md");
		expect(result.details).toMatchObject({
			root,
			registryExists: true,
			markdownCount: 2,
			invalidMarkdownCount: 1,
		});
	});

	it("records provenance defaults instead of leaving source metadata null", async () => {
		const root = tempOkfRoot();
		const sourcePath = path.join(root, "source.txt");
		fs.writeFileSync(sourcePath, "source body", "utf8");
		const session = createSession(memoryWorkerSettings(root));

		const recordResult = await new OkfRecordTool(session).execute("call-record-file", {
			claim: "File-backed OKF claim.",
			source_uri: sourcePath,
			source_kind: "file",
			id: "file-backed",
		});
		const pageResult = await new OkfPageGetTool(session).execute("call-page", { slug: "file-backed", fuzzy: false });
		const text = firstText(pageResult);

		expect(recordResult.isError).toBeUndefined();
		expect(text).toContain("contentHash:");
		expect(text).not.toContain("contentHash: null");
		expect(text).toContain("observedAt:");
		expect(text).not.toContain("observedAt: null");
	});

	it("rejects invalid OKF source kinds before persistence", async () => {
		const root = tempOkfRoot();
		const session = createSession(memoryWorkerSettings(root));

		const result = await new OkfRecordTool(session).execute("call-record-invalid-kind", {
			claim: "Invalid source kind should not persist.",
			source_uri: "invalid:test",
			source_kind: "not-a-kind",
			id: "invalid-kind",
		} as never);

		expect(result.isError).toBe(true);
		expect(firstText(result)).toContain("Invalid OKF source ref kind");
		expect(fs.existsSync(path.join(root, "invalid-kind.md"))).toBe(false);
	});


	it("reports OKF quality warnings separately from malformed markdown", async () => {
		const root = tempOkfRoot();
		writeOkfPage(root, "okf/knowledge-registry.md", "Registry page.");
		fs.writeFileSync(
			path.join(root, "url.md"),
			[
				"---",
				'id: "url-quality"',
				"scope: global",
				"sourceRefs:",
				"  - kind: url",
				'    uri: "https://example.test/doc"',
				"    contentHash: null",
				"    observedAt: null",
				"confidence: high",
				"filePath: null",
				"contentHash: null",
				"supersedes: null",
				"supersededBy: null",
				"staleAt: null",
				"tags:",
				"createdAt: 1",
				"updatedAt: 1",
				"---",
				"",
				"URL-backed claim.",
				"",
			].join("\n"),
			"utf8",
		);
		const result = await new OkfHealthTool(createSession(memoryWorkerSettings(root))).execute("call-health", {});
		const text = firstText(result);

		expect(result.isError).toBeUndefined();
		expect(text).toContain("Invalid markdown: 0");
		expect(text).toContain("Quality warnings:");
		expect(result.details).toMatchObject({
			invalidMarkdownCount: 0,
		});
		expect(result.details?.qualityIssueCount).toBeGreaterThan(0);
		expect(text).toContain("sourceRefs.observedAt");
		expect(text).toContain("staleAt");
	});

	it("records and queries scoped OKF documents with source filtering before limiting", async () => {
		const root = tempOkfRoot();
		const settings = memoryWorkerSettings(root);
		const session = createSession(settings);
		for (let index = 0; index < 30; index++) {
			await new OkfRecordTool(session).execute("call-record-other", {
				claim: `Shared retrieval needle belongs to other source ${index}`,
				source_uri: `other:${index}`,
				id: `other-${index}`,
			});
		}
		const recordResult = await new OkfRecordTool(session).execute("call-record-target", {
			claim: "Shared retrieval needle belongs to acme source",
			source_uri: "client:acme",
			tags: [okfTag("client:acme")],
			id: "target-acme",
		});

		const queryResult = await new OkfQueryTool(session).execute("call-okf-query", {
			query: "Shared retrieval needle",
			source_id: "client:acme",
			limit: 1,
		});
		const text = firstText(queryResult);

		expect(recordResult.isError).toBeUndefined();
		expect(queryResult.isError).toBeUndefined();
		expect(text).toContain("Shared retrieval needle belongs to acme source");
		expect(text).not.toContain("other source");
	});

	it("queries tool-method OKF documents by required tool tags", async () => {
		const root = tempOkfRoot();
		const session = createSession(memoryWorkerSettings(root));
		await new OkfRecordTool(session).execute("call-record-read", {
			claim: "Read tool method: prefer read for file inspection.",
			source_uri: "tool-method:read",
			tags: [okfTag("okf:type:tool-method"), okfTag("tool:read")],
			id: "tool-read-method",
		});
		await new OkfRecordTool(session).execute("call-record-bash", {
			claim: "Bash tool method: use for process execution.",
			source_uri: "tool-method:bash",
			tags: [okfTag("okf:type:tool-method"), okfTag("tool:bash")],
			id: "tool-bash-method",
		});

		const result = await new OkfToolMethodQueryTool(session).execute("call-tool-method-query", {
			query: "tool method",
			tool: "read",
			limit: 5,
		});
		const text = firstText(result);

		expect(result.isError).toBeUndefined();
		expect(text).toContain("Read tool method: prefer read for file inspection.");
		expect(text).not.toContain("Bash tool method");
	});

	it("records benchmark results as persistent OKF documents", async () => {
		const root = tempOkfRoot();
		const session = createSession(memoryWorkerSettings(root));

		const recordResult = await new OkfBenchmarkRecordTool(session).execute("call-benchmark-record", {
			suite: "tool-routing",
			case_id: "case-1",
			passed: false,
			summary: "Selected bash instead of read.",
			expected_tool: "read",
			actual_tool: "bash",
			source_id: "client:acme",
		});
		const queryResult = await new OkfQueryTool(session).execute("call-benchmark-query", {
			query: "Selected bash",
			source_id: "benchmark:tool-routing:case-1",
			tags: [okfTag("okf:type:benchmark-result"), okfTag("benchmark:tool-routing"), okfTag("result:fail"), okfTag("client:acme")],
			limit: 1,
		});
		const text = firstText(queryResult);

		expect(recordResult.isError).toBeUndefined();
		expect(queryResult.isError).toBeUndefined();
		expect(text).toContain("Benchmark tool-routing/case-1 failed: Selected bash instead of read.");
		expect(text).toContain("Expected tool: read");
		expect(text).toContain("Actual tool: bash");
	});
});
