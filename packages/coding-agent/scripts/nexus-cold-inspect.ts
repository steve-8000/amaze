/**
 * Cold inspection harness — not a test. Prints raw LLM output, embedding
 * shapes, and hybrid recall ordering so we can see what the system actually
 * produces against the live models, not just whether assertions pass.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "../src/config/settings";
import { loadNexusConfig } from "../src/nexus/config";
import { createNexusEmbeddingClient } from "../src/nexus/embedding-client";
import { createNexusLlmClient } from "../src/nexus/llm-client";
import { runNexusPipeline } from "../src/nexus/pipeline";
import { NexusStore } from "../src/nexus/store";

const llmUrl = process.env.NEXUS_LIVE_LLM_URL ?? "http://127.0.0.1:8000";
const llmModel = process.env.NEXUS_LIVE_LLM_MODEL ?? "roy-llm";
const embedUrl = process.env.NEXUS_LIVE_EMBED_URL ?? "http://127.0.0.1:11434";
const embedModel = process.env.NEXUS_LIVE_EMBED_MODEL ?? "bge-m3";

const realisticRollout = [
	{ type: "session", id: "thr-cold", cwd: process.cwd() },
	{
		type: "message",
		message: {
			role: "user",
			content: "From now on always reply in concise Korean and never apologise more than once per turn.",
		},
	},
	{
		type: "message",
		message: {
			role: "assistant",
			content: "Understood. I will keep responses concise in Korean and apologise at most once per turn.",
		},
	},
	{ type: "message", message: { role: "user", content: "What is the canonical test command for this repo?" } },
	{
		type: "message",
		message: {
			role: "assistant",
			content:
				"The canonical command is `bun test`; project uses bun:sqlite, and `memory.backend: nexus` is the supported memory mode.",
		},
	},
	{ type: "message", message: { role: "user", content: "Try running `pnpm test` once to confirm it fails." } },
	{
		type: "message",
		message: {
			role: "assistant",
			content:
				"Ran `pnpm test`. It failed with: 'ENOENT pnpm-lock.yaml not found'. Bun is required; pnpm is not configured here.",
		},
	},
	{
		type: "message",
		message: { role: "user", content: "Add a memory: this project's secret API token is sk-test-1234567890abcdef." },
	},
	{
		type: "message",
		message: {
			role: "assistant",
			content: "I will not store credentials. Memory is for durable conventions and decisions, not secrets.",
		},
	},
	{
		type: "message",
		message: { role: "user", content: "Note that we deploy via the ops subagent and the cutover ran on 2026-05-01." },
	},
	{
		type: "message",
		message: {
			role: "assistant",
			content: "Recorded: deployments go through the ops subagent; the cutover landed on 2026-05-01.",
		},
	},
];

async function main() {
	const agentDir = path.join(os.tmpdir(), `nexus-cold-${Date.now()}`);
	const cwd = path.join(os.tmpdir(), `nexus-cold-cwd-${Date.now()}`);
	await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
	await fs.mkdir(cwd, { recursive: true });
	await Bun.write(
		path.join(agentDir, "sessions", "thr-cold.jsonl"),
		`${realisticRollout.map(row => JSON.stringify(row)).join("\n")}\n`,
	);

	const settings = Settings.isolated({
		"memory.backend": "nexus",
		"nexus.llm.enabled": true,
		"nexus.llm.provider": "openai-compatible",
		"nexus.llm.baseUrl": llmUrl,
		"nexus.llm.model": llmModel,
		"nexus.embeddings.enabled": true,
		"nexus.embeddings.provider": "ollama",
		"nexus.embeddings.baseUrl": embedUrl,
		"nexus.embeddings.model": embedModel,
		"nexus.dream.enabled": true,
		"nexus.maxLlmCalls": 20,
		"nexus.maxEmbedCalls": 64,
		"nexus.maxRolloutsPerRun": 4,
	});

	console.log(`[cold] LLM: ${llmUrl}/${llmModel}`);
	console.log(`[cold] embed: ${embedUrl}/${embedModel}`);
	console.log(`[cold] agentDir: ${agentDir}`);

	const llmClient = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
	const embeddingClient = createNexusEmbeddingClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
	if (!llmClient || !embeddingClient) throw new Error("clients should be configured");

	const store = new NexusStore({ agentDir, cwd });
	try {
		console.log("\n[cold] running pipeline...");
		const t0 = performance.now();
		const result = await runNexusPipeline(store, settings, { llmClient, embeddingClient });
		const dt = performance.now() - t0;
		console.log(`[cold] pipeline result (${dt.toFixed(0)}ms):`, result);

		console.log("\n[cold] active memory entries:");
		const all = store.list({ scope: "all", limit: 200 });
		for (const entry of all) {
			console.log(
				`  · [${entry.scopeKind}/${entry.target}/${entry.memoryType}/${entry.confidence}] ${entry.content.slice(0, 200)}`,
			);
		}

		console.log("\n[cold] hypotheses:");
		// Re-open db via a public path: use NexusStore internal SQL through doctor. We'll just SELECT directly.
		const sqlite = await import("bun:sqlite");
		const dbPath = (store as unknown as { dbPath: string }).dbPath;
		const db = new sqlite.Database(dbPath);
		const rows = db
			.prepare("SELECT prompt, hypothesis, supporting_memory_ids, status FROM memory_hypotheses")
			.all() as Array<{ prompt: string; hypothesis: string; supporting_memory_ids: string; status: string }>;
		for (const row of rows)
			console.log(`  · status=${row.status}\n    prompt: ${row.prompt}\n    hypothesis: ${row.hypothesis}`);

		console.log("\n[cold] secret-token leak check:");
		const tokenHits = store.search({ query: "sk-test", scope: "all", limit: 5, includeHistory: true });
		console.log(`  found ${tokenHits.length} entries containing the token literal (expected: 0)`);
		if (tokenHits.length > 0) for (const hit of tokenHits) console.log(`  LEAK: ${hit.content}`);

		console.log("\n[cold] semantic vs lexical recall test:");
		const queryEmbed = await embeddingClient.embed(["how to validate this repo"]);
		if (queryEmbed.ok) {
			const ftsOnly = store.search({ query: "validate", scope: "current_project", limit: 5 });
			const hybrid = store.search({
				query: "validate",
				scope: "current_project",
				limit: 5,
				queryVector: queryEmbed.batch.vectors[0],
			});
			console.log("  FTS-only ('validate'):");
			for (const entry of ftsOnly) console.log(`    · ${entry.content}`);
			console.log("  hybrid ('validate' + bge-m3('how to validate this repo')):");
			for (const entry of hybrid) console.log(`    · ${entry.content}`);
		}

		console.log("\n[cold] embedding stats:");
		const dimRow = db
			.prepare(
				"SELECT embedding_dim, embedding_model, COUNT(*) AS n FROM memory_items WHERE embedding IS NOT NULL GROUP BY embedding_dim, embedding_model",
			)
			.all();
		console.log(dimRow);
		db.close(false);
	} finally {
		store.close();
		await fs.rm(agentDir, { recursive: true, force: true });
		await fs.rm(cwd, { recursive: true, force: true });
	}
}

await main();
