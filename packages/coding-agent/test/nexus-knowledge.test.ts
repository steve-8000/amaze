import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { chunkContent, indexNexusRepository } from "@amaze/coding-agent/nexus/knowledge/indexer";
import { NexusKnowledgeStore } from "@amaze/coding-agent/nexus/knowledge/store";
import { Snowflake } from "@amaze/utils";

const createdDirs = new Set<string>();

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${Snowflake.next()}`);
	await fs.mkdir(dir, { recursive: true });
	createdDirs.add(dir);
	return dir;
}

describe("NexusKnowledgeStore", () => {
	afterEach(async () => {
		for (const dir of createdDirs) {
			await fs.rm(dir, { recursive: true, force: true });
		}
		createdDirs.clear();
	});

	it("indexes repository files and records JavaScript and TypeScript symbols", async () => {
		const agentDir = await makeTempDir("nexus-knowledge-agent");
		const repoRoot = await makeTempDir("nexus-knowledge-repo");
		await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
		await Bun.write(
			path.join(repoRoot, "src", "math.ts"),
			[
				"export function addTax(cents: number): number {",
				"\treturn cents + calculateTax(cents);",
				"}",
				"",
				"const calculateTax = (cents: number): number => Math.round(cents * 0.1);",
				"",
				"export class InvoiceTotals {}",
			].join("\n"),
		);
		await Bun.write(path.join(repoRoot, "README.md"), "# Billing\nThe repository computes invoice totals.\n");
		await fs.mkdir(path.join(repoRoot, "node_modules", "ignored"), { recursive: true });
		await Bun.write(path.join(repoRoot, "node_modules", "ignored", "skip.ts"), "export function ignored() {}\n");

		const stats = await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			expect(stats.indexedFiles).toBe(2);
			expect(stats.skippedFiles).toBe(0);
			expect(stats.chunks).toBeGreaterThanOrEqual(2);
			expect(stats.symbols).toBe(3);
			expect(store.codeDefinitions({ name: "addTax", repoRoot })).toHaveLength(1);
			expect(store.codeDefinitions({ name: "calculateTax", repoRoot })[0]?.kind).toBe("const");
			expect(store.codeDefinitions({ name: "InvoiceTotals", repoRoot })[0]?.kind).toBe("class");
			expect(store.codeDefinitions({ name: "ignored", repoRoot })).toHaveLength(0);
		} finally {
			store.close();
		}
	});

	it("searches indexed chunks with path and symbol-aware ranking diagnostics", async () => {
		const agentDir = await makeTempDir("nexus-search-agent");
		const repoRoot = await makeTempDir("nexus-search-repo");
		await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
		await Bun.write(
			path.join(repoRoot, "src", "widget.ts"),
			"export function WidgetFactory() {\n\treturn { ok: true };\n}\n",
		);
		await Bun.write(path.join(repoRoot, "notes.md"), "Retry policy uses bounded backoff for API calls.\n");
		await Bun.write(path.join(repoRoot, "other.txt"), "Completely different content.\n");

		await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			const textResults = store.search({ query: "bounded backoff", repoRoot, limit: 5 });
			expect(textResults).toHaveLength(1);
			expect(textResults[0]?.document.path).toBe("notes.md");
			expect(textResults[0]?.diagnostics).toContain("exact_text");

			const pathResults = store.search({ query: "src/widget.ts", repoRoot, limit: 5 });
			expect(pathResults[0]?.document.path).toBe("src/widget.ts");
			expect(pathResults[0]?.matchKind).toBe("path");
			expect(pathResults[0]?.diagnostics).toContain("exact_path");

			const symbolResults = store.search({ query: "WidgetFactory", repoRoot, limit: 5 });
			expect(symbolResults[0]?.document.path).toBe("src/widget.ts");
			expect(symbolResults[0]?.matchKind).toBe("mixed");
			expect(symbolResults[0]?.diagnostics).toContain("symbol_match");
		} finally {
			store.close();
		}
	});

	it("extracts methods aliases and default exports for JS and TS code", async () => {
		const agentDir = await makeTempDir("nexus-symbols-agent");
		const repoRoot = await makeTempDir("nexus-symbols-repo");
		await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
		await Bun.write(
			path.join(repoRoot, "src", "api.ts"),
			[
				"export default function makeApi() {",
				"\treturn helpers.build();",
				"}",
				"",
				"class CartService {",
				"\trenderTotal() {",
				"\t\treturn makeApi();",
				"\t}",
				"}",
				"",
				"const helpers = {",
				"\tbuild: () => ({ ok: true }),",
				"\tformat: function formatCurrency() { return '$'; },",
				"};",
				"",
				"const internalHelper = () => helpers.build();",
				"export { internalHelper as publicHelper };",
				"export default internalHelper;",
			].join("\n"),
		);

		await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			expect(store.codeDefinitions({ name: "makeApi", repoRoot })[0]?.exported).toBe(true);
			expect(store.codeDefinitions({ name: "CartService.renderTotal", repoRoot })[0]?.parentSymbol).toBe(
				"CartService",
			);
			expect(store.codeDefinitions({ name: "helpers.build", repoRoot })[0]?.parentSymbol).toBe("helpers");
			expect(store.codeDefinitions({ name: "publicHelper", repoRoot })[0]?.kind).toBe("alias");
			expect(store.codeDefinitions({ name: "internalHelper", repoRoot })[0]?.exported).toBe(true);
		} finally {
			store.close();
		}
	});

	it("finds definitions references callers and callees with tighter attribution", async () => {
		const agentDir = await makeTempDir("nexus-code-agent");
		const repoRoot = await makeTempDir("nexus-code-repo");
		await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
		await Bun.write(
			path.join(repoRoot, "src", "workflow.ts"),
			[
				"export function parseInput(value: string): string {",
				"\treturn value.trim();",
				"}",
				"",
				"function unrelated() {",
				"\treturn 'noop';",
				"}",
				"",
				"export function runWorkflow(raw: string): string {",
				"\tconst parsed = parseInput(raw);",
				"\treturn parsed.toUpperCase();",
				"}",
			].join("\n"),
		);
		await Bun.write(
			path.join(repoRoot, "src", "workflow.test.ts"),
			[
				"import { parseInput } from './workflow';",
				"export { parseInput as parseInputAlias };",
				"",
				"export function runSpec() {",
				"\treturn parseInput(' hi ');",
				"}",
			].join("\n"),
		);

		await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			const definitions = store.codeDefinitions({ name: "parseInput", repoRoot });
			expect(definitions[0]?.path).toBe("src/workflow.ts");
			expect(definitions[0]?.line).toBe(1);

			const references = store.codeReferences({ name: "parseInput", repoRoot });
			expect(
				references.some(
					reference =>
						reference.path === "src/workflow.ts" && reference.line === 10 && reference.kind === "reference",
				),
			).toBe(true);
			expect(references.some(reference => reference.path === "src/workflow.test.ts" && reference.line === 5)).toBe(
				true,
			);
			expect(references.some(reference => reference.line === 1 || reference.line === 2)).toBe(false);

			const callers = store.codeCallers({ name: "parseInput", repoRoot });
			expect(callers.some(caller => caller.caller?.name === "runWorkflow")).toBe(true);
			expect(callers.some(caller => caller.caller?.name === "runSpec")).toBe(true);
			expect(callers.some(caller => caller.caller?.name === "unrelated")).toBe(false);

			const callees = store.codeCallees({ name: "runWorkflow", repoRoot });
			expect(callees.some(callee => callee.name === "parseInput")).toBe(true);
			expect(callees.some(callee => callee.name === "unrelated")).toBe(false);
		} finally {
			store.close();
		}
	});

	it("indexes incrementally and prunes stale files", async () => {
		const agentDir = await makeTempDir("nexus-incremental-agent");
		const repoRoot = await makeTempDir("nexus-incremental-repo");
		await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
		await Bun.write(path.join(repoRoot, "src", "keep.ts"), "export const keep = true;\n");
		await Bun.write(path.join(repoRoot, "src", "drop.ts"), "export const drop = true;\n");

		const first = await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		expect(first.indexedFiles).toBe(2);

		await fs.rm(path.join(repoRoot, "src", "drop.ts"));
		const second = await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const third = await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			expect(second.prunedFiles).toBe(1);
			expect(store.codeDefinitions({ name: "drop", repoRoot })).toHaveLength(0);
			expect(third.unchangedFiles).toBe(1);
			expect(third.indexedFiles).toBe(0);
		} finally {
			store.close();
		}
	});

	it("chunks markdown by heading boundaries", () => {
		const chunks = chunkContent(
			["# Intro", "Overview text.", "", "## Details", "More detail.", "Even more detail."].join("\n"),
			{ maxLines: 10, maxChars: 200, language: "markdown", kind: "text" },
		);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.startLine).toBe(1);
		expect(chunks[0]?.endLine).toBe(3);
		expect(chunks[1]?.startLine).toBe(4);
	});
});
