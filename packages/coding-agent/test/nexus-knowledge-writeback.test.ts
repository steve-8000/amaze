import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NexusKnowledgeStore } from "@amaze/coding-agent/nexus/knowledge/store";
import {
	applyNexusKnowledgeWriteback,
	validateNexusKnowledgeWriteback,
} from "@amaze/coding-agent/nexus/knowledge/writeback";
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

describe("Nexus knowledge writeback", () => {
	it("rejects unsafe or ungrounded writeback requests", async () => {
		const repoRoot = await makeTempDir("nexus-writeback-repo");
		expect(
			validateNexusKnowledgeWriteback({
				repoRoot,
				repoPath: "../escape.ts",
				content: "export const nope = true;\n",
				provenance: { source: "manual", reason: "" },
			}),
		).toEqual({ ok: false, error: "repoPath must stay within repoRoot." });
		expect(
			validateNexusKnowledgeWriteback({
				repoRoot,
				repoPath: "notes.md",
				content: "   ",
				provenance: { source: "manual", reason: "explicit operator request" },
			}),
		).toEqual({ ok: false, error: "content must be non-empty." });
	});

	it("accepts narrow structured writeback and makes it searchable", async () => {
		const agentDir = await makeTempDir("nexus-writeback-agent");
		const repoRoot = await makeTempDir("nexus-writeback-repo");
		const store = new NexusKnowledgeStore({ agentDir, cwd: repoRoot });
		try {
			const result = applyNexusKnowledgeWriteback(store, {
				repoRoot,
				repoPath: "src/checkout.ts",
				content: [
					"export function checkoutTotal(cents: number) {",
					"\treturn cents + calculateTax(cents);",
					"}",
					"",
					"function calculateTax(cents: number) {",
					"\treturn Math.round(cents * 0.1);",
					"}",
				].join("\n"),
				provenance: { source: "manual", reason: "explicit operator-approved repository knowledge writeback" },
			});
			expect(result.ok).toBe(true);
			expect(store.codeDefinitions({ name: "checkoutTotal", repoRoot })[0]?.path).toBe("src/checkout.ts");
			expect(store.search({ query: "calculateTax", repoRoot })[0]?.document.path).toBe("src/checkout.ts");
		} finally {
			store.close();
		}
	});
});
