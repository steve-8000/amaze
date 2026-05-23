import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NexusKnowledgeStore } from "@amaze/coding-agent/nexus/knowledge/store";
import { createTools } from "@amaze/coding-agent/tools";
import { Snowflake } from "@amaze/utils";

const createdDirs = new Set<string>();

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${Snowflake.next()}`);
	await fs.mkdir(dir, { recursive: true });
	createdDirs.add(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of createdDirs) {
		await fs.rm(dir, { recursive: true, force: true });
	}
	createdDirs.clear();
});

describe("Nexus compatibility tools", () => {

	it("exposes and invokes Nexus repository knowledge tools", async () => {
		const agentDir = await makeTempDir("nexus-repo-tools-agent");
		const cwd = await makeTempDir("nexus-repo-tools-cwd");
		const settings = {
			get: (key: string) => {
				if (key === "memory.backend") return "nexus";
				if (key === "nexus.searchResultMaxEntries") return 5;
				if (key === "nexus.searchEntryMaxChars") return 480;
				if (key === "nexus.searchResultMaxChars") return 2400;
				return undefined;
			},
			getAgentDir: () => agentDir,
		};
		const store = new NexusKnowledgeStore({ agentDir, cwd });
		try {
			store.upsertDocument({
				repoRoot: cwd,
				path: "src/widget.ts",
				absolutePath: path.join(cwd, "src/widget.ts"),
				kind: "code",
				language: "typescript",
				contentHash: "widget-hash",
				sizeBytes: 128,
				chunks: [
					{
						chunkIndex: 0,
						startLine: 1,
						endLine: 6,
						content: "function createWidgetConfig() {\n\treturn { mode: 'test' };\n}\nexport function WidgetFactory() {\n\treturn createWidgetConfig();\n}\nWidgetFactory();",
						contentHash: "widget-chunk-hash",
					},
				],
				symbols: [
					{
						name: "createWidgetConfig",
						kind: "function",
						exported: false,
						line: 1,
						endLine: 3,
						column: 10,
						signature: "function createWidgetConfig()",
						parentSymbol: null,
					},
					{
						name: "WidgetFactory",
						kind: "function",
						exported: true,
						line: 4,
						endLine: 6,
						column: 17,
						signature: "export function WidgetFactory()",
						parentSymbol: null,
					},
				],
			});
			store.upsertDocument({
				repoRoot: cwd,
				path: "src/widget.test.ts",
				absolutePath: path.join(cwd, "src/widget.test.ts"),
				kind: "code",
				language: "typescript",
				contentHash: "widget-test-hash",
				sizeBytes: 96,
				chunks: [
					{
						chunkIndex: 0,
						startLine: 1,
						endLine: 5,
						content: "import { WidgetFactory } from './widget';\nexport { WidgetFactory as WidgetFactoryAlias };\n\nexport function runWidgetSpec() {\n\treturn WidgetFactory();\n}",
						contentHash: "widget-test-chunk-hash",
					},
				],
				symbols: [
					{
						name: "runWidgetSpec",
						kind: "function",
						exported: true,
						line: 4,
						endLine: 5,
						column: 17,
						signature: "export function runWidgetSpec()",
						parentSymbol: null,
					},
				],
			});
		} finally {
			store.close();
		}

		const toolSession = {
			cwd,
			hasUI: false,
			contextFiles: [],
			getSessionFile: () => null,
			getSessionSpawns: () => null,
			settings,
		} as any;
		const tools = await createTools(toolSession, ["repo_search", "code_def", "code_refs", "code_callers", "code_callees"]);
		const toolNames = tools.map(tool => tool.name);
		expect(toolNames).toContain("repo_search");
		expect(toolNames).toContain("code_def");
		expect(toolNames).toContain("code_refs");
		expect(toolNames).toContain("code_callers");
		expect(toolNames).toContain("code_callees");

		const repoSearch = tools.find(tool => tool.name === "repo_search")!;
		const codeDef = tools.find(tool => tool.name === "code_def")!;
		const codeRefs = tools.find(tool => tool.name === "code_refs")!;
		const codeCallers = tools.find(tool => tool.name === "code_callers")!;
		const codeCallees = tools.find(tool => tool.name === "code_callees")!;
		const searchResult = await repoSearch.execute("repo-search-1", { query: "WidgetFactory", explain: true });
		const defResult = await codeDef.execute("code-def-1", { symbol: "WidgetFactory" });
		const refsResult = await codeRefs.execute("code-refs-1", { symbol: "WidgetFactory", path: "src/widget.test.ts" });
		const callersResult = await codeCallers.execute("code-callers-1", { symbol: "WidgetFactory" });
		const calleesResult = await codeCallees.execute("code-callees-1", { symbol: "WidgetFactory", path: "src/widget.ts" });
		expect((searchResult.content[0] as any).text).toContain("src/widget.ts");
		expect((searchResult.content[0] as any).text).toContain("symbol_match");
		expect((defResult.content[0] as any).text).toContain("WidgetFactory :: export function WidgetFactory");
		expect((refsResult.content[0] as any).text).toContain("chunk 0 1-5");
		expect((callersResult.content[0] as any).text).toContain("runWidgetSpec");
		expect((calleesResult.content[0] as any).text).toContain("createWidgetConfig");
	});
});
