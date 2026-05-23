import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import type { NexusLlmClient } from "@amaze/coding-agent/nexus/llm-client";
import { runNexusPipeline } from "@amaze/coding-agent/nexus/pipeline";
import { NexusStore } from "@amaze/coding-agent/nexus/store";

async function withStore<T>(fn: (store: NexusStore, dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-skill-lifecycle-"));
	const cwd = path.join(dir, "repo");
	await fs.mkdir(cwd, { recursive: true });
	const store = new NexusStore({ agentDir: dir, cwd });
	try {
		return await fn(store, dir);
	} finally {
		store.close();
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function skillStatus(store: NexusStore, name: string): string | undefined {
	const db = new Database(store.dbPath);
	try {
		return (
			db.prepare("SELECT status FROM memory_skills WHERE name = ?").get(name) as { status?: string } | undefined
		)?.status;
	} finally {
		db.close(false);
	}
}

describe("skill lifecycle ceiling", () => {
	it("stores LLM conceptual promotions as eval_pending", async () => {
		await withStore(async store => {
			const sourceIds: string[] = [];
			for (const content of [
				"Run targeted tests before merging.",
				"Run targeted tests after edits.",
				"Run tests for changed files.",
			]) {
				const result = store.add({ target: "project", content, memoryType: "workflow" });
				expect(result.success).toBe(true);
				expect(result.entry).toBeDefined();
				sourceIds.push(result.entry!.id);
			}
			const fakeLlm: NexusLlmClient = {
				provider: "fake",
				model: "fake",
				async complete() {
					return { ok: false, error: "unused" };
				},
				async completeJson() {
					return {
						ok: true,
						value: {
							name: "targeted-test-loop",
							content: "Run targeted tests before and after changing files.",
							sourceMemoryIds: sourceIds,
						} as never,
					};
				},
			};
			const settings = Settings.isolated({
				"memory.backend": "nexus",
				"nexus.conceptualSkills.enabled": true,
				"nexus.dream.enabled": false,
				"nexus.healing.enabled": false,
				"nexus.hypothesisVerification.enabled": false,
			});

			const result = await runNexusPipeline(store, settings, { llmClient: fakeLlm, embeddingClient: null });

			expect(result.conceptualSkills).toBe(1);
			expect(skillStatus(store, "targeted-test-loop")).toBe("eval_pending");
		});
	});

	it("does not write eval_pending skills to disk", async () => {
		await withStore(async store => {
			store.upsertSkill(store.scope.id, "Pending Skill", "Do not publish yet.", [], "eval_pending");

			await store.renderArtifacts();

			await expect(fs.stat(path.join(store.artifactRoot, "skills", "pending-skill", "SKILL.md"))).rejects.toThrow();
		});
	});

	it("writes active and validated skills to disk", async () => {
		await withStore(async store => {
			store.upsertSkill(store.scope.id, "Active Skill", "Publish active skill.", [], "active");
			store.upsertSkill(store.scope.id, "Validated Skill", "Publish validated skill.", [], "validated");

			await store.renderArtifacts();

			await expect(
				fs.stat(path.join(store.artifactRoot, "skills", "active-skill", "SKILL.md")),
			).resolves.toBeDefined();
			await expect(
				fs.stat(path.join(store.artifactRoot, "skills", "validated-skill", "SKILL.md")),
			).resolves.toBeDefined();
		});
	});
});
