/**
 * Temperature ablation against the live LLM.
 *
 * Runs the same controlled rollout through the pipeline at three different
 * reflection temperatures, N times each, and inspects the hypothesis output:
 *
 *   - lexical_grounding   : fraction of hypothesis tokens that appear verbatim
 *                            in the input memories (proxy for "did the model
 *                            stay anchored to the facts we provided?")
 *   - novel_terms         : terms in the hypothesis not present in the input
 *                            (proxy for hallucination surface)
 *   - hash_diversity      : number of distinct hypotheses across the N runs
 *                            (proxy for run-to-run variance)
 *
 * Extraction temperature is held at 0 throughout. We're isolating reflection.
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
	{ type: "session", id: "thr-temp", cwd: process.cwd() },
	{ type: "message", message: { role: "user", content: "From now on always reply in concise Korean and never apologise more than once per turn." } },
	{ type: "message", message: { role: "assistant", content: "Understood. I will keep responses concise in Korean and apologise at most once per turn." } },
	{ type: "message", message: { role: "user", content: "What is the canonical test command for this repo?" } },
	{ type: "message", message: { role: "assistant", content: "The canonical command is `bun test`; project uses bun:sqlite, and `memory.backend: nexus` is the supported memory mode." } },
	{ type: "message", message: { role: "user", content: "Note that we deploy via the ops subagent and the cutover ran on 2026-05-01." } },
	{ type: "message", message: { role: "assistant", content: "Recorded: deployments go through the ops subagent; the cutover landed on 2026-05-01." } },
];

const STOP_WORDS = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on", "for", "with", "as", "at", "by", "from",
	"this", "that", "these", "those", "and", "or", "but", "if", "than", "so", "not", "no", "will", "should", "would", "could", "may",
	"can", "do", "does", "did", "have", "has", "had", "it", "its", "their", "any", "all", "more", "less", "very", "such", "into", "out",
	"about", "next", "previous", "before", "after", "when", "where", "why", "how", "we", "you", "i", "he", "she", "they", "them", "our",
	"your", "his", "her", "my", "me", "us", "one", "two", "first", "second",
	"prompt", "hypothesis", "memory", "memories", "project", "session",
]);

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[`*_~]/g, " ")
		.split(/[^a-z0-9_.\-]+/)
		.filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

interface TrialResult {
	temperature: number;
	prompt: string;
	hypothesis: string;
	lexicalGrounding: number;
	novelTerms: string[];
	hash: string;
}

async function setupAgentDir(): Promise<{ agentDir: string; cwd: string }> {
	const agentDir = path.join(os.tmpdir(), `nexus-temp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const cwd = path.join(os.tmpdir(), `nexus-temp-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
	await fs.mkdir(cwd, { recursive: true });
	await Bun.write(
		path.join(agentDir, "sessions", "thr-temp.jsonl"),
		`${realisticRollout.map(row => JSON.stringify(row)).join("\n")}\n`,
	);
	return { agentDir, cwd };
}

async function runTrial(temperature: number): Promise<TrialResult> {
	const { agentDir, cwd } = await setupAgentDir();
	try {
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
			"nexus.llm.extractionTemperature": 0,
			"nexus.llm.reflectionTemperature": temperature,
			"nexus.healing.enabled": false,
		});
		const llmClient = createNexusLlmClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		const embeddingClient = createNexusEmbeddingClient(loadNexusConfig(settings), { timeoutMs: 60_000 });
		const store = new NexusStore({ agentDir, cwd });
		try {
			await runNexusPipeline(store, settings, { llmClient, embeddingClient });
			const sqlite = await import("bun:sqlite");
			const db = new sqlite.Database((store as unknown as { dbPath: string }).dbPath);
			const row = db.prepare("SELECT prompt, hypothesis FROM memory_hypotheses ORDER BY created_at DESC LIMIT 1").get() as { prompt?: string; hypothesis?: string } | undefined;
			db.close(false);
			const items = store.list({ scope: "all", limit: 200 }).map(entry => entry.content);
			const inputCorpus = new Set(tokenize(items.join("\n")));
			const hypothesis = row?.hypothesis ?? "";
			const prompt = row?.prompt ?? "";
			const tokens = tokenize(`${prompt} ${hypothesis}`);
			const grounded = tokens.filter(token => inputCorpus.has(token));
			const novel = [...new Set(tokens.filter(token => !inputCorpus.has(token)))];
			const lexicalGrounding = tokens.length === 0 ? 0 : grounded.length / tokens.length;
			const hash = Bun.hash(`${prompt}::${hypothesis}`).toString(16);
			return { temperature, prompt, hypothesis, lexicalGrounding, novelTerms: novel, hash };
		} finally {
			store.close();
		}
	} finally {
		await fs.rm(agentDir, { recursive: true, force: true });
		await fs.rm(cwd, { recursive: true, force: true });
	}
}

async function main() {
	const temperatures = [0, 0.1, 0.3, 0.6];
	const trialsPerTemp = 3;
	const results = new Map<number, TrialResult[]>();
	for (const temp of temperatures) {
		const bucket: TrialResult[] = [];
		for (let i = 0; i < trialsPerTemp; i += 1) {
			console.log(`[temp ${temp}] trial ${i + 1}/${trialsPerTemp}...`);
			bucket.push(await runTrial(temp));
		}
		results.set(temp, bucket);
	}

	console.log("\n=== detail ===\n");
	for (const [temp, trials] of results) {
		console.log(`--- temperature ${temp} ---`);
		trials.forEach((trial, idx) => {
			console.log(`  [${idx + 1}] grounding=${trial.lexicalGrounding.toFixed(3)} novel=${trial.novelTerms.length}`);
			console.log(`      P: ${trial.prompt}`);
			console.log(`      H: ${trial.hypothesis}`);
			if (trial.novelTerms.length > 0) console.log(`      novel terms: ${trial.novelTerms.join(", ")}`);
		});
	}

	console.log("\n=== summary ===");
	console.log("temp | mean grounding | mean novel | distinct hypotheses (lower = more reproducible)");
	for (const [temp, trials] of results) {
		const mg = trials.reduce((acc, t) => acc + t.lexicalGrounding, 0) / trials.length;
		const mn = trials.reduce((acc, t) => acc + t.novelTerms.length, 0) / trials.length;
		const distinct = new Set(trials.map(t => t.hash)).size;
		console.log(` ${temp.toString().padEnd(4)} | ${mg.toFixed(3).padEnd(14)} | ${mn.toFixed(2).padEnd(10)} | ${distinct}/${trials.length}`);
	}
}

await main();
