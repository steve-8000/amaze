import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "@amaze/coding-agent/config/settings";
import { evaluateNexusDoctorLive } from "@amaze/coding-agent/nexus/doctor";
import type { NexusEmbeddingClient } from "@amaze/coding-agent/nexus/embedding-client";
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

function unitVector(values: number[]): Float32Array {
	const v = Float32Array.from(values);
	let norm = 0;
	for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
	if (norm > 0) {
		const denom = Math.sqrt(norm);
		for (let i = 0; i < v.length; i += 1) v[i] /= denom;
	}
	return v;
}

describe("NexusStore semantic dedup", () => {
	it("marks near-identical paraphrases as semantic duplicates and keeps the canonical active", async () => {
		const agentDir = await makeTempDir("nexus-sem-dedup");
		const cwd = await makeTempDir("nexus-sem-dedup-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			const canonical = store.add({
				target: "user",
				content: "Reply in concise Korean.",
				confidence: "user_asserted",
			});
			const paraphrase = store.add({
				target: "user",
				content: "Keep responses concise in Korean.",
				confidence: "user_asserted",
			});
			const lookalike = store.add({
				target: "user",
				content: "Apologise at most once per turn.",
				confidence: "user_asserted",
			});
			expect(canonical.entry && paraphrase.entry && lookalike.entry).toBeTruthy();

			const near = unitVector([1, 0, 0, 0]);
			const closeToNear = unitVector([0.99, 0.01, 0, 0]);
			const distant = unitVector([0, 0, 1, 0]);
			store.addEmbedding(canonical.entry!.id, near, "fake-bge");
			store.addEmbedding(paraphrase.entry!.id, closeToNear, "fake-bge");
			store.addEmbedding(lookalike.entry!.id, distant, "fake-bge");

			const result = store.runSelfHealing({ semanticDuplicateThreshold: 0.95 });
			expect(result.semanticDuplicates).toBe(1);

			const activeUser = store.list({ scope: "global", target: "user" });
			const activeContents = activeUser.map(entry => entry.content);
			expect(activeContents).toContain("Reply in concise Korean.");
			expect(activeContents).toContain("Apologise at most once per turn.");
			expect(activeContents).not.toContain("Keep responses concise in Korean.");

			const history = store.search({ query: "Keep responses", scope: "all", limit: 5, includeHistory: true });
			expect(history.some(entry => entry.status === "superseded")).toBe(true);
		} finally {
			store.close();
		}
	});

	it("does nothing when no embeddings have been backfilled", async () => {
		const agentDir = await makeTempDir("nexus-sem-dedup-empty");
		const cwd = await makeTempDir("nexus-sem-dedup-empty-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "user", content: "Reply in concise Korean." });
			store.add({ target: "user", content: "Keep responses concise in Korean." });
			const result = store.runSelfHealing();
			expect(result.semanticDuplicates).toBe(0);
		} finally {
			store.close();
		}
	});
});

describe("NexusStore.search empty/wildcard query", () => {
	it("falls back to list when query is empty or '*'", async () => {
		const agentDir = await makeTempDir("nexus-search-empty");
		const cwd = await makeTempDir("nexus-search-empty-cwd");
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.add({ target: "project", content: "Alpha entry." });
			store.add({ target: "project", content: "Beta entry." });
			const empty = store.search({ query: "", scope: "current_project", limit: 5 });
			const wildcard = store.search({ query: "*", scope: "current_project", limit: 5 });
			expect(empty.length).toBe(2);
			expect(wildcard.length).toBe(2);
		} finally {
			store.close();
		}
	});
});

describe("NexusPipeline usedLlm / usedEmbeddings accuracy", () => {
	it("reports usedLlm=false when every LLM call failed and heuristic took over", async () => {
		const agentDir = await makeTempDir("nexus-pipeline-llmfail");
		const cwd = await makeTempDir("nexus-pipeline-llmfail-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const rows = [
			{ type: "session", id: "thr-1", cwd },
			{
				type: "message",
				message: { role: "user", content: "Always prefer concise replies and use bun test for validation." },
			},
		];
		await Bun.write(path.join(sessionDir, "thr-1.jsonl"), `${rows.map(row => JSON.stringify(row)).join("\n")}\n`);

		const settings = Settings.isolated({ "memory.backend": "nexus", "nexus.dream.enabled": false });
		const failLlm: NexusLlmClient = {
			provider: "fake-llm",
			model: "broken",
			async complete() {
				return { ok: false, error: "fake outage" };
			},
			async completeJson() {
				return { ok: false, error: "fake outage" };
			},
		};
		const store = new NexusStore({ agentDir, cwd });
		try {
			const result = await runNexusPipeline(store, settings, { llmClient: failLlm, embeddingClient: null });
			expect(result.llmCalls).toBeGreaterThan(0);
			expect(result.llmSuccesses).toBe(0);
			expect(result.usedLlm).toBe(false);
			expect(result.embedSuccesses).toBe(0);
			expect(result.usedEmbeddings).toBe(false);
			expect(result.createdEntries).toBeGreaterThan(0);
		} finally {
			store.close();
		}
	});

	it("reports usedEmbeddings=false when the embedding client always fails", async () => {
		const agentDir = await makeTempDir("nexus-pipeline-embedfail");
		const cwd = await makeTempDir("nexus-pipeline-embedfail-cwd");
		const sessionDir = path.join(agentDir, "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		await Bun.write(
			path.join(sessionDir, "thr-1.jsonl"),
			`${JSON.stringify({ type: "session", id: "thr-1", cwd })}\n${JSON.stringify({ type: "message", message: { role: "user", content: "Always prefer concise replies." } })}\n`,
		);

		const settings = Settings.isolated({ "memory.backend": "nexus" });
		const failEmbed: NexusEmbeddingClient = {
			provider: "fake-embed",
			model: "broken",
			dimension: () => null,
			async embed() {
				return { ok: false, error: "embed outage" };
			},
		};
		const store = new NexusStore({ agentDir, cwd });
		try {
			const result = await runNexusPipeline(store, settings, { llmClient: null, embeddingClient: failEmbed });
			expect(result.embedSuccesses).toBe(0);
			expect(result.usedEmbeddings).toBe(false);
			// Heuristic still creates memories.
			expect(result.createdEntries).toBeGreaterThan(0);
		} finally {
			store.close();
		}
	});
});

describe("evaluateNexusDoctorLive", () => {
	it("reports llm_live FAIL when the LLM is unreachable but does not throw", async () => {
		const agentDir = await makeTempDir("nexus-doctor-live");
		const settings = Settings.isolated({
			"memory.backend": "nexus",
			"nexus.llm.enabled": true,
			"nexus.llm.provider": "openai-compatible",
			"nexus.llm.baseUrl": "http://127.0.0.1:1",
			"nexus.llm.model": "ghost",
			"nexus.embeddings.enabled": true,
			"nexus.embeddings.provider": "ollama",
			"nexus.embeddings.baseUrl": "http://127.0.0.1:1",
			"nexus.embeddings.model": "ghost-embed",
		});
		// Use the temp agentDir for store
		Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
		const result = await evaluateNexusDoctorLive(settings, agentDir, { timeoutMs: 400 });
		const llmCheck = result.checks.find(check => check.id === "llm_live");
		const embedCheck = result.checks.find(check => check.id === "embeddings_live");
		expect(llmCheck?.status).toBe("FAIL");
		expect(embedCheck?.status).toBe("FAIL");
		expect(result.status).toBe("FAIL");
	}, 30_000);
	it("passes llm_live when the provider needs a larger completion budget to emit final content", async () => {
		const agentDir = await makeTempDir("nexus-doctor-live-reasoning");
		const originalFetch = global.fetch;
		const fetchMock: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === "http://127.0.0.1:58100/v1/chat/completions") {
				const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
				if (body.max_tokens === 64) {
					return new Response(
						JSON.stringify({
							choices: [
								{ message: { role: "assistant", reasoning: "Need a larger budget before final JSON." } },
							],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
			}
			return originalFetch(input, init);
		}) as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;
		try {
			const settings = Settings.isolated({
				"memory.backend": "nexus",
				"nexus.llm.enabled": true,
				"nexus.llm.provider": "openai-compatible",
				"nexus.llm.baseUrl": "http://127.0.0.1:58100",
				"nexus.llm.model": "LiquidAI/LFM2.5-8B-A1B-MLX-8bit",
				"nexus.embeddings.enabled": true,
				"nexus.embeddings.provider": "openai-compatible",
				"nexus.embeddings.baseUrl": "http://127.0.0.1:58101",
				"nexus.embeddings.model": "mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ",
			});
			Object.defineProperty(settings, "getAgentDir", { value: () => agentDir });
			const result = await evaluateNexusDoctorLive(settings, agentDir, { timeoutMs: 10_000 });
			const llmCheck = result.checks.find(check => check.id === "llm_live");
			const embedCheck = result.checks.find(check => check.id === "embeddings_live");
			expect(llmCheck?.status).toBe("PASS");
			expect(embedCheck?.status).toBe("PASS");
		} finally {
			global.fetch = originalFetch;
		}
	}, 30_000);
});
