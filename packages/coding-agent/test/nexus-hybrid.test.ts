import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "@amaze/coding-agent/config/settings";
import type { NexusEmbeddingClient, NexusEmbeddingResult } from "@amaze/coding-agent/nexus/embedding-client";
import type { NexusLlmClient } from "@amaze/coding-agent/nexus/llm-client";
import { runNexusPipeline } from "@amaze/coding-agent/nexus/pipeline";
import { NexusStore } from "@amaze/coding-agent/nexus/store";
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

/**
 * Deterministic fake embedding: lowercase the text, count occurrences of a
 * fixed vocabulary, normalise. Two strings with the same keyword profile
 * receive nearly-identical vectors regardless of surrounding words.
 */
function fakeEmbed(text: string): Float32Array {
	const vocab = ["korean", "concise", "bun", "pnpm", "error", "test", "memory", "nexus", "skill", "command"];
	const vec = new Float32Array(vocab.length);
	const lower = text.toLowerCase();
	vocab.forEach((word, idx) => {
		const matches = lower.split(word).length - 1;
		vec[idx] = matches;
	});
	let norm = 0;
	for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
	if (norm > 0) {
		const denom = Math.sqrt(norm);
		for (let i = 0; i < vec.length; i += 1) vec[i] /= denom;
	}
	return vec;
}

function fakeEmbeddingClient(model = "fake-bge"): NexusEmbeddingClient {
	let dim: number | null = null;
	return {
		provider: "fake",
		model,
		dimension: () => dim,
		async embed(inputs: string[]): Promise<NexusEmbeddingResult> {
			const vectors = inputs.map(input => {
				const vec = fakeEmbed(input);
				if (dim === null && vec.length > 0) dim = vec.length;
				return vec;
			});
			return { ok: true, batch: { vectors, model } };
		},
	};
}

describe("NexusStore hybrid recall", () => {
	it("blends FTS and cosine to surface semantically similar but lexically distant entries", async () => {
		const agentDir = await makeTempDir("nexus-hybrid");
		const cwd = await makeTempDir("nexus-hybrid-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			const a = store.add({
				target: "project",
				content: "Always run bun test before edits.",
				memoryType: "command",
			});
			const b = store.add({
				target: "project",
				content: "Project relies on pnpm test for validation.",
				memoryType: "command",
			});
			const c = store.add({
				target: "project",
				content: "Memory should always be concise in Korean.",
				memoryType: "preference",
			});
			expect(a.entry && b.entry && c.entry).toBeTruthy();
			const client = fakeEmbeddingClient();
			const seed = await client.embed([a.entry!.content, b.entry!.content, c.entry!.content]);
			expect(seed.ok).toBe(true);
			if (seed.ok) {
				store.addEmbedding(a.entry!.id, seed.batch.vectors[0]!, seed.batch.model);
				store.addEmbedding(b.entry!.id, seed.batch.vectors[1]!, seed.batch.model);
				store.addEmbedding(c.entry!.id, seed.batch.vectors[2]!, seed.batch.model);
			}
			const queryVector = fakeEmbed("running pnpm test reliably");

			// Pure FTS finds the literal match.
			const ftsOnly = store.search({ query: "pnpm test", scope: "current_project", limit: 5 });
			expect(ftsOnly.length).toBeGreaterThan(0);
			expect(ftsOnly[0]!.content).toContain("pnpm test");

			// Pure vector finds both bun + pnpm command entries before the preference.
			const vectorOnly = store.vectorSearch(queryVector, { scope: "current_project", limit: 3 });
			expect(vectorOnly.length).toBeGreaterThan(0);
			expect(vectorOnly[0]!.entry.content).toMatch(/pnpm|bun/);

			// Hybrid recall combines: even when the query word is *only* "test"
			// the semantic vector pulls both command entries to the top.
			const hybrid = store.search({ query: "test", scope: "current_project", limit: 5, queryVector });
			expect(hybrid.length).toBeGreaterThan(0);
			const topTwo = hybrid.slice(0, 2).map(entry => entry.content);
			expect(topTwo.some(content => content.includes("bun test"))).toBe(true);
			expect(topTwo.some(content => content.includes("pnpm test"))).toBe(true);
		} finally {
			store.close();
		}
	});

	it("listMissingEmbeddings only returns active entries without embeddings", async () => {
		const agentDir = await makeTempDir("nexus-missing");
		const cwd = await makeTempDir("nexus-missing-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			const a = store.add({ target: "project", content: "Entry one" });
			const b = store.add({ target: "project", content: "Entry two" });
			expect(store.listMissingEmbeddings(10).length).toBe(2);
			store.addEmbedding(a.entry!.id, fakeEmbed(a.entry!.content), "fake");
			const remaining = store.listMissingEmbeddings(10);
			expect(remaining.length).toBe(1);
			expect(remaining[0]!.id).toBe(b.entry!.id);
		} finally {
			store.close();
		}
	});
});

describe("NexusStore pipeline with LLM client", () => {
	it("uses the LLM for extraction and reflection, then embeds the new memories", async () => {
		const agentDir = await makeTempDir("nexus-pipeline-llm");
		const cwd = await makeTempDir("nexus-pipeline-llm-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const rows = [
			{ type: "session", id: "thr-1", cwd },
			{ type: "message", message: { role: "user", content: "Reply in concise Korean by default." } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Will run bun test before edits and treat memory.backend nexus as canonical.",
				},
			},
		];
		await Bun.write(path.join(sessionDir, "thr-1.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);

		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.dream.enabled": true,
		});

		const llmCalls: Array<{ system: string | undefined; user: string }> = [];
		const fakeLlmClient: NexusLlmClient = {
			provider: "fake-llm",
			model: "test-model",
			async complete(input) {
				llmCalls.push({ system: input.system, user: input.messages[0]!.content });
				return { ok: true, content: "{}" };
			},
			async completeJson(input) {
				llmCalls.push({ system: input.system, user: input.messages[0]!.content });
				const userText = input.messages[0]?.content ?? "";
				if (userText.startsWith("role: user")) {
					return {
						ok: true,
						value: {
							memories: [
								{
									target: "user",
									content: "Reply in concise Korean by default.",
									memoryType: "preference",
									category: "preference",
									confidence: "user_asserted",
								},
							],
						} as never,
					};
				}
				if (userText.startsWith("role: assistant")) {
					return {
						ok: true,
						value: {
							memories: [
								{
									target: "project",
									content: "Run bun test before edits and treat memory.backend nexus as canonical.",
									memoryType: "workflow",
									category: "convention",
									confidence: "tool_verified",
								},
							],
						} as never,
					};
				}
				if (userText.startsWith("Recent durable memory")) {
					return {
						ok: true,
						value: {
							prompt: "What canonical commands should we verify next session?",
							hypothesis:
								"Running bun test before every edit will catch regressions earlier than rerunning after merges.",
						} as never,
					};
				}
				return { ok: false, error: "unexpected prompt" };
			},
		};

		const embeddingClient = fakeEmbeddingClient();
		const store = new NexusStore({ agentDir, cwd });
		try {
			const result = await runNexusPipeline(store, settings, { llmClient: fakeLlmClient, embeddingClient });
			expect(result.createdEntries).toBeGreaterThanOrEqual(2);
			expect(result.hypotheses).toBe(1);
			expect(result.embeddings).toBeGreaterThanOrEqual(2);
			expect(result.usedLlm).toBe(true);
			expect(result.usedEmbeddings).toBe(true);

			// LLM was queried at least twice for extraction and once for reflection.
			expect(llmCalls.length).toBeGreaterThanOrEqual(3);

			// Extracted memories are queryable via FTS.
			const ftsHits = store.search({ query: "concise Korean", scope: "current_project", limit: 5 });
			expect(ftsHits.some(entry => entry.confidence === "user_asserted")).toBe(true);

			// Vector path now works because embeddings backfilled.
			const queryVector = fakeEmbed("bun test commands");
			const hybridHits = store.search({ query: "bun", scope: "current_project", limit: 5, queryVector });
			expect(hybridHits.length).toBeGreaterThan(0);
			expect(hybridHits[0]!.content).toMatch(/bun test/);

			// Hypothesis lives in its own table and is not returned by active search.
			const reflective = store.search({ query: "canonical commands", scope: "current_project", limit: 5 });
			expect(reflective.length).toBe(0);
		} finally {
			store.close();
		}
	});
});
