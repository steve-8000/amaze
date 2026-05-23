import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "@amaze/coding-agent/config/settings";
import { nexusBackend } from "@amaze/coding-agent/memory-backend/nexus-backend";
import type { NexusEmbeddingClient } from "@amaze/coding-agent/nexus/embedding-client";
import type { NexusLlmClient } from "@amaze/coding-agent/nexus/llm-client";
import { runNexusBehavioralAb } from "@amaze/coding-agent/nexus/behavioral-ab";
import { runNexusOnlineConsolidation, runNexusPipeline } from "@amaze/coding-agent/nexus/pipeline";
import { NexusStore } from "@amaze/coding-agent/nexus/store";
import { NexusMemoryExplainTool } from "@amaze/coding-agent/tools/nexus-memory-explain";
import { Snowflake } from "@amaze/utils";

const tempDirs = new Set<string>();

async function makeTempDir(prefix: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `${prefix}-${Snowflake.next()}`);
	await fs.mkdir(dir, { recursive: true });
	tempDirs.add(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
	tempDirs.clear();
});

describe("Nexus AGI roadmap features", () => {
	it("online consolidation persists a turn boundary without waiting for next startup", async () => {
		const agentDir = await makeTempDir("nexus-online");
		const cwd = await makeTempDir("nexus-online-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.onlineConsolidation.enabled": true,
			"nexus.llm.enabled": false,
			"nexus.embeddings.enabled": false,
		});
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		const session = {
			settings,
			agent: {
				state: {
					messages: [
						{ role: "user", content: "Always reply in concise Korean." },
						{ role: "assistant", content: "Use bun test before edits; memory.backend should be nexus." },
					],
				},
			},
			sessionManager: {
				getCwd: () => cwd,
				getSessionId: () => "sess-online",
			},
		} as any;

		nexusBackend.onTurnEnd?.(session, { type: "turn_end", message: { role: "assistant", content: "Use bun test before edits; memory.backend should be nexus." } } as any);

		let entries = 0;
		for (let i = 0; i < 30; i += 1) {
			await Bun.sleep(20);
			const store = new NexusStore({ agentDir, cwd });
			try {
				entries = store.list({ scope: "all", limit: 20 }).length;
				if (entries > 0) break;
			} finally {
				store.close();
			}
		}
		expect(entries).toBeGreaterThan(0);
	});

	it("online consolidation skips expensive cross-memory abstraction jobs", async () => {
		const agentDir = await makeTempDir("nexus-online-light");
		const cwd = await makeTempDir("nexus-online-light-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.onlineConsolidation.enabled": true,
			"nexus.conceptualSkills.enabled": true,
			"nexus.hypothesisVerification.enabled": true,
			"nexus.llm.enabled": true,
			"nexus.maxLlmCalls": 10,
			"nexus.embeddings.enabled": false,
		});
		const store = new NexusStore({ agentDir, cwd });
		let llmCalls = 0;
		const fakeLlm: NexusLlmClient = {
			provider: "fake",
			model: "fake",
			async complete() {
				return { ok: true, content: "{\"memories\":[]}" };
			},
			async completeJson(input) {
				llmCalls += 1;
				if (input.system?.includes("Create one reusable procedural skill")) {
					return { ok: true, value: { name: "should-not-run", content: "expensive online job" } as never };
				}
				return { ok: true, value: { memories: [] } as never };
			},
		};
		try {
			for (let i = 0; i < 3; i += 1) {
				store.add({
					target: "project",
					memoryType: "skill_candidate",
					category: "insight",
					content: `Repeated candidate ${i}: prefer lightweight online consolidation.`,
				});
			}
			const result = await runNexusOnlineConsolidation(
				store,
				settings,
				"sess-online-light:turn:1",
				[{ role: "assistant", content: "Confirmed Nexus should not run conceptual abstraction on every turn." }],
				{ llmClient: fakeLlm, embeddingClient: null },
			);
			expect(result.llmCalls).toBe(1);
			expect(llmCalls).toBe(1);
			expect(result.conceptualSkills).toBe(0);
		} finally {
			store.close();
		}
	});

	it("hypothesis verification cycle accepts or rejects proposed hypotheses", async () => {
		const agentDir = await makeTempDir("nexus-hv");
		const cwd = await makeTempDir("nexus-hv-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.hypothesisVerification.enabled": true,
			"nexus.dream.enabled": false,
			"nexus.conceptualSkills.enabled": false,
		});
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Use bun test as the canonical test command." });
			store.createHypothesis("Should we use bun test?", "Use bun test as the canonical test command.");
			const fakeLlm: NexusLlmClient = {
				provider: "fake",
				model: "fake",
				async complete() {
					return { ok: false, error: "unused" };
				},
				async completeJson(input) {
					const text = input.messages[0]?.content ?? "";
					if (text.includes("Use bun test as the canonical test command.")) {
						return { ok: true, value: { status: "accepted", reason: "Active memory matches the hypothesis verbatim." } as never };
					}
					return { ok: true, value: { status: "expired", reason: "Unknown." } as never };
				},
			};
			const result = await runNexusPipeline(store, settings, { llmClient: fakeLlm, embeddingClient: null });
			expect(result.hypothesesVerified).toBe(1);
			expect(store.listHypotheses("accepted", 10)).toHaveLength(1);
		} finally {
			store.close();
		}
	});

	it("goal-conditioned recall re-ranks memories toward the current goal", async () => {
		const agentDir = await makeTempDir("nexus-goal-rank");
		const cwd = await makeTempDir("nexus-goal-rank-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Use bun test before edits." });
			store.add({ target: "project", content: "Deployments are executed via the ops subagent." });
			store.add({ target: "user", content: "Reply in concise Korean." });
			const ranked = store.search({ query: "*", goal: "deploy production via ops", scope: "current_project", limit: 5 });
			expect(ranked[0]?.content).toContain("ops subagent");
		} finally {
			store.close();
		}
	});

	it("auto recall retrieves natural-language memory under hard caps", async () => {
		const agentDir = await makeTempDir("nexus-auto-recall");
		const cwd = await makeTempDir("nexus-auto-recall-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.autoRecall": true,
			"nexus.autoRecallLimit": 3,
			"nexus.searchEntryMaxChars": 80,
			"nexus.searchResultMaxChars": 200,
			"nexus.llm.enabled": false,
			"nexus.embeddings.enabled": false,
		});
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({
				target: "project",
				content: "Nexus active recall is enabled with autoRecallLimit 3 and searchResultMaxChars 1200 to prevent context growth.",
			});
		} finally {
			store.close();
		}
		const session = {
			settings,
			sessionManager: {
				getCwd: () => cwd,
				getSessionId: () => "sess-auto-recall",
			},
			getGoalModeState: () => ({ goal: { objective: "use Nexus memory active recall safely" } }),
		} as any;
		const recall = await nexusBackend.beforeAgentStartPrompt!(session, "How is Nexus active recall limited?");
		expect(recall).toContain("## Relevant Nexus Context");
		expect(recall).toContain("### Operational memory");
		expect(recall).toContain("Nexus active recall");
		expect(recall!.length).toBeLessThanOrEqual(200);
	});

	it("conceptual abstraction skill promotion synthesizes a reusable skill via LLM clustering", async () => {
		const agentDir = await makeTempDir("nexus-skill-cluster");
		const cwd = await makeTempDir("nexus-skill-cluster-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.conceptualSkills.enabled": true,
			"nexus.dream.enabled": false,
			"nexus.hypothesisVerification.enabled": false,
		});
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Use bun test before edits.", memoryType: "workflow" });
			store.add({ target: "project", content: "Run bun test after schema changes.", memoryType: "workflow" });
			store.add({ target: "project", content: "Use bun test before merging memory backend changes.", memoryType: "command" });
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
							name: "bun-test-validation",
							content: "## Procedure\n1. Run bun test before edits.\n2. Re-run after schema changes.\n3. Confirm memory backend changes with bun test.",
							sourceMemoryIds: store.listSkillCandidateEntries(10).map(entry => entry.id),
						} as never,
					};
				},
			};
			const result = await runNexusPipeline(store, settings, { llmClient: fakeLlm, embeddingClient: null });
			expect(result.conceptualSkills).toBeGreaterThan(0);
			const sqlite = await import("bun:sqlite");
			const db = new sqlite.Database(store.dbPath);
			try {
				const row = db.prepare("SELECT name, content FROM memory_skills WHERE name = ?").get("bun-test-validation") as { name?: string; content?: string } | undefined;
				expect(row?.name).toBe("bun-test-validation");
				expect(row?.content).toContain("Run bun test before edits");
			} finally {
				db.close(false);
			}
		} finally {
			store.close();
		}
	});

	it("conceptual abstraction does not repeatedly summarize the same or oversized memories", async () => {
		const agentDir = await makeTempDir("nexus-skill-dedupe");
		const cwd = await makeTempDir("nexus-skill-dedupe-cwd");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.conceptualSkills.enabled": true,
			"nexus.dream.enabled": false,
			"nexus.hypothesisVerification.enabled": false,
		});
		const store = new NexusStore({ agentDir, cwd });
		let llmCalls = 0;
		const fakeLlm: NexusLlmClient = {
			provider: "fake",
			model: "fake",
			async complete() {
				return { ok: false, error: "unused" };
			},
			async completeJson() {
				llmCalls += 1;
				return { ok: true, value: { name: "bounded-skill", content: "Use concise repeated evidence only.", sourceMemoryIds: store.listSkillCandidateEntries(10).map(entry => entry.id) } as never };
			},
		};
		try {
			store.add({ target: "project", content: "Short repeated workflow one.", memoryType: "workflow" });
			store.add({ target: "project", content: "Short repeated workflow two.", memoryType: "workflow" });
			store.add({ target: "project", content: "Short repeated workflow three.", memoryType: "workflow" });
			store.add({ target: "project", content: `# Rockey Memory Summary\n\n${"legacy summary ".repeat(300)}`, memoryType: "workflow" });
			const first = await runNexusPipeline(store, settings, { llmClient: fakeLlm, embeddingClient: null });
			const second = await runNexusPipeline(store, settings, { llmClient: fakeLlm, embeddingClient: null });
			expect(first.conceptualSkills).toBe(1);
			expect(second.conceptualSkills).toBe(0);
			expect(llmCalls).toBe(1);
		} finally {
			store.close();
		}
	});

	it("memory_explain returns provenance graph for a stored memory", async () => {
		const agentDir = await makeTempDir("nexus-explain");
		const cwd = await makeTempDir("nexus-explain-cwd");
		const settings = Settings.isolated({ "memory.backend": "nexus" });
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		const store = new NexusStore({ agentDir, cwd });
		let id = "";
		try {
			const add = store.add({ target: "project", content: "Use bun test before edits.", provenance: "manual:test" });
			id = add.entry!.id;
			store.recordUsage([id], "thread-1", "turn-1", "memory_search");
		} finally {
			store.close();
		}
		const tool = NexusMemoryExplainTool.createIf({
			settings,
			getSessionId: () => "sess-explain",
			cwd,
			sessionManager: { getCwd: () => cwd },
		} as any);
		expect(tool).not.toBeNull();
		const result = await tool!.execute("call-1", { id });
		expect(result.details && typeof result.details === "object").toBeTruthy();
		expect(String((result.details as any).found)).toBe("true");
		expect(result.content[0]?.type).toBe("text");
		expect((result.content[0] as any).text).toContain("Nexus Memory Explanation");
	});

	it("behavioral A/B harness shows higher success with memory context than without", async () => {
		const agentDir = await makeTempDir("nexus-ab");
		const cwd = await makeTempDir("nexus-ab-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Use bun test as the canonical test command." });
			store.add({ target: "project", content: "Deployments are executed via the ops subagent." });
			const fakeLlm: NexusLlmClient = {
				provider: "fake",
				model: "fake",
				async complete(input) {
					const system = input.system ?? "";
					const question = input.messages[0]?.content ?? "";
					if (question.includes("test command")) {
						return { ok: true, content: system.includes("bun test") ? "Use bun test." : "unknown" };
					}
					if (question.includes("deployments")) {
						return { ok: true, content: system.includes("ops subagent") ? "Use the ops subagent." : "unknown" };
					}
					return { ok: true, content: "unknown" };
				},
				async completeJson() {
					return { ok: false, error: "unused" };
				},
			};
			const result = await runNexusBehavioralAb(store, fakeLlm, [
				{ id: "t1", question: "What test command should I run?", expectedAny: ["bun test"] },
				{ id: "t2", question: "Which agent handles deployments?", expectedAny: ["ops subagent"] },
			]);
			expect(result.withMemorySuccessRate).toBe(1);
			expect(result.withoutMemorySuccessRate).toBe(0);
		} finally {
			store.close();
		}
	});
});
