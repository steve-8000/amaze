import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@amaze/coding-agent/config/settings";
import type { NexusLlmClient } from "@amaze/coding-agent/nexus/llm-client";
import { runNexusPipeline } from "@amaze/coding-agent/nexus/pipeline";
import { NexusStore } from "@amaze/coding-agent/nexus/store";
import { ProposalStore } from "../../src/learning";

async function withStores<T>(
	fn: (stores: { nexusStore: NexusStore; proposalStore: ProposalStore }) => Promise<T>,
): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-routing-"));
	const cwd = path.join(dir, "repo");
	await fs.mkdir(cwd, { recursive: true });
	const nexusStore = new NexusStore({ agentDir: dir, cwd });
	const proposalStore = new ProposalStore(path.join(dir, "proposals.db"));
	try {
		return await fn({ nexusStore, proposalStore });
	} finally {
		proposalStore.close();
		nexusStore.close();
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function addSkillCandidateMemories(store: NexusStore): string[] {
	const sourceIds: string[] = [];
	for (const content of [
		"Before editing Nexus routing, collect source memory ids.",
		"After editing Nexus routing, write a review-gated proposal.",
		"For repeated Nexus routing memories, keep provenance on skill rows.",
	]) {
		const result = store.add({ target: "project", content, memoryType: "workflow" });
		expect(result.success).toBe(true);
		expect(result.entry).toBeDefined();
		sourceIds.push(result.entry!.id);
	}
	return sourceIds;
}

function fakeSkillLlm(sourceIds: string[]): NexusLlmClient {
	return {
		provider: "fake",
		model: "fake",
		async complete() {
			return { ok: false, error: "unused" };
		},
		async completeJson() {
			return {
				ok: true,
				value: {
					name: "review-gated-routing-skill",
					content: "Route conceptual skills through review-gated proposals before eval-pending upsert.",
					sourceMemoryIds: sourceIds,
				} as never,
			};
		},
	};
}

function conceptualSkillSettings(): Settings {
	return Settings.isolated({
		"memory.backend": "nexus",
		"nexus.conceptualSkills.enabled": true,
		"nexus.dream.enabled": false,
		"nexus.healing.enabled": false,
		"nexus.hypothesisVerification.enabled": false,
	});
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

describe("nexus conceptual skill proposal routing", () => {
	it("routes conceptual skill promotions through ProposalStore when provided", async () => {
		await withStores(async ({ nexusStore, proposalStore }) => {
			const sourceIds = addSkillCandidateMemories(nexusStore);

			const result = await runNexusPipeline(nexusStore, conceptualSkillSettings(), {
				llmClient: fakeSkillLlm(sourceIds),
				embeddingClient: null,
				proposalStore,
			});

			expect(result.conceptualSkills).toBe(1);
			expect(skillStatus(nexusStore, "review-gated-routing-skill")).toBe("eval_pending");
			const proposals = proposalStore.listByType("skill");
			expect(proposals).toHaveLength(1);
			expect(proposals[0]?.gate).toBe("review");
			expect(proposals[0]?.type === "skill" ? proposals[0].sourceMemoryIds : undefined).toEqual(sourceIds);
			expect(proposals[0]?.evidence).toEqual({
				sessionIds: [],
				eventRefs: [],
				sampleN: sourceIds.length,
				ruleFindings: [],
			});
		});
	});

	it("keeps legacy eval-pending skill upsert when ProposalStore is absent", async () => {
		await withStores(async ({ nexusStore, proposalStore }) => {
			const sourceIds = addSkillCandidateMemories(nexusStore);

			const result = await runNexusPipeline(nexusStore, conceptualSkillSettings(), {
				llmClient: fakeSkillLlm(sourceIds),
				embeddingClient: null,
			});

			expect(result.conceptualSkills).toBe(1);
			expect(skillStatus(nexusStore, "review-gated-routing-skill")).toBe("eval_pending");
			expect(proposalStore.listByType("skill")).toEqual([]);
		});
	});
});
