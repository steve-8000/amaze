/**
 * Live integration test for the Nexus memory subsystem.
 *
 * This test reaches out over the network to real local servers. It is gated
 * behind environment variables so CI does not depend on a running model:
 *
 *   NEXUS_LIVE_LLM_URL    e.g. http://127.0.0.1:8000
 *   NEXUS_LIVE_LLM_MODEL  e.g. roy-llm
 *   NEXUS_LIVE_EMBED_URL  e.g. http://127.0.0.1:11434
 *   NEXUS_LIVE_EMBED_MODEL e.g. bge-m3
 *
 * Set any subset; the test will skip the unconfigured arm. When both are set,
 * the test exercises end-to-end pipeline ingestion against the real models.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "@amaze/coding-agent/config/settings";
import { loadNexusConfig } from "@amaze/coding-agent/nexus/config";
import { createNexusEmbeddingClient } from "@amaze/coding-agent/nexus/embedding-client";
import { createNexusLlmClient } from "@amaze/coding-agent/nexus/llm-client";
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

const llmUrl = process.env.NEXUS_LIVE_LLM_URL;
const llmModel = process.env.NEXUS_LIVE_LLM_MODEL;
const embedUrl = process.env.NEXUS_LIVE_EMBED_URL;
const embedModel = process.env.NEXUS_LIVE_EMBED_MODEL;

const liveLlm = Boolean(llmUrl && llmModel);
const liveEmbed = Boolean(embedUrl && embedModel);

describe.skipIf(!liveLlm)("nexus live LLM", () => {
	it("answers a deterministic ping/pong", async () => {
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.llm.enabled": true,
			"nexus.llm.provider": "openai-compatible",
			"nexus.llm.baseUrl": llmUrl!,
			"nexus.llm.model": llmModel!,
		});
		const client = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		expect(client).not.toBeNull();
		const result = await client!.complete({
			messages: [{ role: "user", content: "Reply with exactly the four characters: pong" }],
			temperature: 0,
			maxTokens: 16,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.content.toLowerCase()).toContain("pong");
	}, 90_000);

	it("returns parseable JSON when requested", async () => {
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.llm.enabled": true,
			"nexus.llm.provider": "openai-compatible",
			"nexus.llm.baseUrl": llmUrl!,
			"nexus.llm.model": llmModel!,
		});
		const client = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		expect(client).not.toBeNull();
		const parsed = await client!.completeJson<{ greeting: string }>({
			system: "Return strict JSON of shape {\"greeting\":\"hello\"} and nothing else.",
			messages: [{ role: "user", content: "respond now" }],
			temperature: 0,
			maxTokens: 64,
			validate: (value): value is { greeting: string } => typeof (value as { greeting?: unknown })?.greeting === "string",
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.value.greeting.toLowerCase()).toContain("hello");
	}, 90_000);
});

describe.skipIf(!liveEmbed)("nexus live embeddings", () => {
	it("produces a non-zero vector and similar inputs cosine higher than dissimilar", async () => {
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.embeddings.enabled": true,
			"nexus.embeddings.provider": "ollama",
			"nexus.embeddings.baseUrl": embedUrl!,
			"nexus.embeddings.model": embedModel!,
		});
		const client = createNexusEmbeddingClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		expect(client).not.toBeNull();
		const result = await client!.embed([
			"Always run bun test before edits.",
			"Run bun test prior to merging changes.",
			"Banana bread recipe instructions.",
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const [aVec, bVec, cVec] = result.batch.vectors;
			expect(aVec!.length).toBeGreaterThan(64);
			const { cosineSimilarity } = await import("@amaze/coding-agent/nexus/embedding-client");
			const ab = cosineSimilarity(aVec!, bVec!);
			const ac = cosineSimilarity(aVec!, cVec!);
			expect(ab).toBeGreaterThan(ac);
			expect(ab).toBeGreaterThan(0.5);
		}
	}, 90_000);
});

describe.skipIf(!(liveLlm && liveEmbed))("nexus live end-to-end pipeline", () => {
	it("ingests a rollout, extracts via LLM, embeds, and answers hybrid recall", async () => {
		const agentDir = await makeTempDir("nexus-live");
		const cwd = await makeTempDir("nexus-live-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const rows = [
			{ type: "session", id: "thr-live", cwd },
			{ type: "message", message: { role: "user", content: "I prefer concise Korean replies and want bun test to be the canonical command for this project." } },
			{ type: "message", message: { role: "assistant", content: "Acknowledged. The project uses memory.backend nexus and bun test for verification before edits." } },
		];
		await Bun.write(path.join(sessionDir, "thr-live.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);

		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.llm.enabled": true,
			"nexus.llm.provider": "openai-compatible",
			"nexus.llm.baseUrl": llmUrl!,
			"nexus.llm.model": llmModel!,
			"nexus.embeddings.enabled": true,
			"nexus.embeddings.provider": "ollama",
			"nexus.embeddings.baseUrl": embedUrl!,
			"nexus.embeddings.model": embedModel!,
			"nexus.dream.enabled": true,
			"nexus.maxLlmCalls": 4,
			"nexus.maxEmbedCalls": 16,
		});

		const llmClient = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		const embeddingClient = createNexusEmbeddingClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		expect(llmClient).not.toBeNull();
		expect(embeddingClient).not.toBeNull();

		const store = new NexusStore({ agentDir, cwd });
		try {
			const result = await runNexusPipeline(store, settings, { llmClient, embeddingClient });
			expect(result.usedLlm).toBe(true);
			expect(result.usedEmbeddings).toBe(true);
			expect(result.createdEntries).toBeGreaterThan(0);
			expect(result.embeddings).toBeGreaterThan(0);

			// Embed a query and request hybrid retrieval through the real model.
			const queryEmbed = await embeddingClient!.embed(["concise korean preference"]);
			expect(queryEmbed.ok).toBe(true);
			if (queryEmbed.ok) {
				const hits = store.search({
					query: "korean concise",
					scope: "current_project",
					limit: 5,
					queryVector: queryEmbed.batch.vectors[0],
				});
				expect(hits.length).toBeGreaterThan(0);
				const joined = hits.map(entry => entry.content).join(" \n ");
				expect(joined.toLowerCase()).toMatch(/korean|concise|bun test|memory\.backend/);
			}
		} finally {
			store.close();
		}
	}, 180_000);
});
