import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Settings } from "../src/config/settings";
import { runNexusBehavioralAb } from "../src/nexus/behavioral-ab";
import { loadNexusConfig } from "../src/nexus/config";
import { createNexusEmbeddingClient } from "../src/nexus/embedding-client";
import { createNexusLlmClient } from "../src/nexus/llm-client";
import { NexusStore } from "../src/nexus/store";

const llmUrl = process.env.NEXUS_LIVE_LLM_URL ?? "http://127.0.0.1:8000";
const llmModel = process.env.NEXUS_LIVE_LLM_MODEL ?? "roy-llm";
const embedUrl = process.env.NEXUS_LIVE_EMBED_URL ?? "http://127.0.0.1:11434";
const embedModel = process.env.NEXUS_LIVE_EMBED_MODEL ?? "bge-m3";

async function main() {
	const agentDir = path.join(os.tmpdir(), `nexus-ab-${Date.now()}`);
	const cwd = path.join(os.tmpdir(), `nexus-ab-cwd-${Date.now()}`);
	await fs.mkdir(agentDir, { recursive: true });
	await fs.mkdir(cwd, { recursive: true });
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
	});
	const llmClient = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
	const embeddingClient = createNexusEmbeddingClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
	if (!llmClient || !embeddingClient) throw new Error("Expected live clients to be configured.");
	const store = new NexusStore({ agentDir, cwd });
	try {
		const seeded = [
			"Use bun test as the canonical test command.",
			"Deployments are executed via the ops subagent.",
			"Set memory.backend to nexus as the supported memory mode.",
			"Use bun:sqlite for database operations.",
			"Reply in concise Korean.",
		];
		const ids: string[] = [];
		for (const content of seeded) {
			const add = store.add({ target: content.includes("Reply") ? "user" : "project", content });
			if (add.entry) ids.push(add.entry.id);
		}
		const embeds = await embeddingClient.embed(seeded);
		if (embeds.ok) {
			ids.forEach((id, idx) => {
				store.addEmbedding(id, embeds.batch.vectors[idx]!, embeds.batch.model);
			});
		}
		const result = await runNexusBehavioralAb(store, llmClient, [
			{ id: "t1", question: "What test command should I run for this repository?", expectedAny: ["bun test"] },
			{ id: "t2", question: "Which agent should handle deployments?", expectedAny: ["ops subagent"] },
			{ id: "t3", question: "Which memory backend is the supported mode?", expectedAny: ["nexus"] },
			{ id: "t4", question: "How should you answer by default?", expectedAny: ["concise korean", "korean"] },
		]);
		console.log(JSON.stringify(result, null, 2));
	} finally {
		store.close();
		await fs.rm(agentDir, { recursive: true, force: true });
		await fs.rm(cwd, { recursive: true, force: true });
	}
}

await main();
