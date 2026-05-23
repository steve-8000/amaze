import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@amaze/utils";
import { indexNexusRepository } from "@amaze/coding-agent/nexus/knowledge/indexer";
import { NexusKnowledgeStore } from "@amaze/coding-agent/nexus/knowledge/store";

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

	it("searches indexed chunks with FTS", async () => {
		const agentDir = await makeTempDir("nexus-search-agent");
		const repoRoot = await makeTempDir("nexus-search-repo");
		await Bun.write(path.join(repoRoot, "notes.md"), "Retry policy uses bounded backoff for API calls.\n");
		await Bun.write(path.join(repoRoot, "other.txt"), "Completely different content.\n");

		await indexNexusRepository({ agentDir, cwd: repoRoot, repoRoot });
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			const results = store.search({ query: "bounded backoff", repoRoot, limit: 5 });
			expect(results).toHaveLength(1);
			expect(results[0]?.document.path).toBe("notes.md");
			expect(results[0]?.chunk.content).toContain("bounded backoff");
		} finally {
			store.close();
		}
	});

	it("finds definitions, references, callers, and callees for simple code queries", async () => {
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
				"export function runWorkflow(raw: string): string {",
				"\tconst parsed = parseInput(raw);",
				"\treturn parsed.toUpperCase();",
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
			expect(references.some(reference => reference.line === 6 && reference.snippet.includes("parseInput(raw)"))).toBe(true);

			const callers = store.codeCallers({ name: "parseInput", repoRoot });
			expect(callers.some(caller => caller.caller?.name === "runWorkflow")).toBe(true);

			const callees = store.codeCallees({ name: "runWorkflow", repoRoot });
			expect(callees.some(callee => callee.name === "parseInput")).toBe(true);
		} finally {
			store.close();
		}
	});
});
