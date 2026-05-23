/**
 * Nexus ingestion / consolidation / reflection pipeline.
 *
 * Stages, in order:
 *
 *   1. Source scan        — discover new rollout JSONL files under
 *                            `<agentDir>/sessions/*.jsonl` and register them
 *                            as `memory_sources`.
 *   2. Extraction         — for each message in each new file, attempt LLM-
 *                            driven structured extraction; if the LLM is
 *                            unavailable or fails, fall back to the regex
 *                            heuristic. Output is recorded as `memory_items`.
 *   3. Embedding backfill — embed the newest active memories that don't yet
 *                            have a vector. Bounded by `nexus.maxEmbedCalls`.
 *   4. Self-healing       — duplicates/contradictions/stale/scope-leak/skill
 *                            promotion (delegated to `NexusStore`).
 *   5. Reflection         — when `nexus.dream.enabled`, ask the LLM for a
 *                            structured hypothesis grounded in the most-used
 *                            recent memories. Hypotheses live in their own
 *                            table and never surface in active recall.
 *   6. Artifact render    — markdown projections per scope.
 *
 * Every external call (LLM and embeddings) is budget-bounded so a slow local
 * server cannot block the agent loop, and every failure surfaces as a no-op:
 * the pipeline always settles into the deterministic FTS fallback.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger, parseJsonlLenient } from "@amaze/utils";

import type { Settings } from "../config/settings";
import type { NexusConfig } from "./config";
import { loadNexusConfig } from "./config";
import type { NexusEmbeddingClient } from "./embedding-client";
import { createNexusEmbeddingClient } from "./embedding-client";
import type { NexusLlmClient } from "./llm-client";
import { createNexusLlmClient } from "./llm-client";
import { scopeForTarget } from "./scope";
import type { NexusStore } from "./store";
import type { NexusConfidence, NexusMemoryCategory, NexusMemoryTarget, NexusMemoryType } from "./types";

export interface NexusPipelineResult {
	importedSources: number;
	createdEntries: number;
	hypotheses: number;
	hypothesesVerified: number;
	conceptualSkills: number;
	embeddings: number;
	llmCalls: number;
	llmSuccesses: number;
	embedCalls: number;
	embedSuccesses: number;
	semanticDuplicates: number;
	/** True only when at least one LLM call succeeded this run. */
	usedLlm: boolean;
	/** True only when at least one embedding call returned vectors this run. */
	usedEmbeddings: boolean;
}

export interface NexusPipelineOptions {
	llmClient?: NexusLlmClient | null;
	embeddingClient?: NexusEmbeddingClient | null;
}

interface PipelineCounters {
	importedSources: number;
	createdEntries: number;
	hypotheses: number;
	embeddings: number;
	hypothesesVerified: number;
	conceptualSkills: number;
	/** Number of attempted LLM calls, including failures. */
	llmCalls: number;
	/** Number of LLM calls that returned a usable result. */
	llmSuccesses: number;
	/** Number of attempted embedding API requests. */
	embedCalls: number;
	/** Number of embedding requests that returned vectors. */
	embedSuccesses: number;
}

export async function runNexusPipeline(store: NexusStore, settings: Settings, options: NexusPipelineOptions = {}): Promise<NexusPipelineResult> {
	const config = loadNexusConfig(settings);
	const counters: PipelineCounters = {
		importedSources: 0,
		createdEntries: 0,
		hypotheses: 0,
		embeddings: 0,
		hypothesesVerified: 0,
		conceptualSkills: 0,
		llmCalls: 0,
		llmSuccesses: 0,
		embedCalls: 0,
		embedSuccesses: 0,
	};
	if (!config.pipelineEnabled) {
		return finalize(counters, 0);
	}
	const llmClient = options.llmClient === undefined ? createNexusLlmClient(config) : options.llmClient;
	const embeddingClient = options.embeddingClient === undefined ? createNexusEmbeddingClient(config) : options.embeddingClient;

	await ingestRollouts(store, config, counters, llmClient);

	if (embeddingClient && config.maxEmbedCalls > 0) {
		await backfillEmbeddings(store, embeddingClient, config, counters);
	}

	let semanticDuplicates = 0;
	if (config.healingEnabled) {
		const healing = store.runSelfHealing();
		semanticDuplicates = healing.semanticDuplicates;
	}

	if (config.hypothesisVerificationEnabled) {
		await verifyProposedHypotheses(store, config, counters, llmClient);
	}

	if (config.conceptualSkillEnabled) {
		await promoteConceptualSkills(store, config, counters, llmClient);
	}

	await reflect(store, config, counters, llmClient);

	await store.renderArtifacts();
	return finalize(counters, semanticDuplicates);
}

function finalize(counters: PipelineCounters, semanticDuplicates: number): NexusPipelineResult {
	return {
		importedSources: counters.importedSources,
		createdEntries: counters.createdEntries,
		hypotheses: counters.hypotheses,
		embeddings: counters.embeddings,
		hypothesesVerified: counters.hypothesesVerified,
		conceptualSkills: counters.conceptualSkills,
		llmCalls: counters.llmCalls,
		llmSuccesses: counters.llmSuccesses,
		embedCalls: counters.embedCalls,
		embedSuccesses: counters.embedSuccesses,
		semanticDuplicates,
		usedLlm: counters.llmSuccesses > 0,
		usedEmbeddings: counters.embedSuccesses > 0,
	};
}

export interface NexusTranscriptMessage {
	role: "user" | "assistant" | "system" | string;
	content: string;
}

export async function runNexusOnlineConsolidation(
	store: NexusStore,
	settings: Settings,
	sourceRecordId: string,
	messages: NexusTranscriptMessage[],
	options: NexusPipelineOptions = {},
): Promise<NexusPipelineResult> {
	const config = loadNexusConfig(settings);
	const counters = emptyCounters();
	if (!config.enabled || !config.pipelineEnabled || !config.onlineConsolidationEnabled || messages.length === 0) {
		return finalize(counters, 0);
	}
	const llmClient = options.llmClient === undefined ? createNexusLlmClient(config) : options.llmClient;
	const embeddingClient = options.embeddingClient === undefined ? createNexusEmbeddingClient(config) : options.embeddingClient;
	const content = messages.map(message => `${message.role}: ${message.content}`).join("\n");
	const sourceId = store.importSource({
		sourceKind: "online_turn",
		sourceRecordId,
		sessionId: sourceRecordId.split(":")[0],
		projectKey: store.scope.key,
		content,
		rawJson: { messages },
	});
	if (sourceId) counters.importedSources += 1;
	for (const message of messages) {
		const extracted = await extractMemories({
			text: message.content,
			role: message.role,
			file: sourceRecordId,
			store,
			llmClient,
			config,
			counters,
		});
		counters.createdEntries += extracted;
	}
	if (embeddingClient && config.maxEmbedCalls > 0) await backfillEmbeddings(store, embeddingClient, config, counters);
	// Online turn-boundary consolidation must stay lightweight. Expensive
	// cross-memory maintenance and artifact rendering run in the startup pipeline,
	// where they are bounded to one execution per session instead of once per
	// assistant response.
	return finalize(counters, 0);
}

function emptyCounters(): PipelineCounters {
	return {
		importedSources: 0,
		createdEntries: 0,
		hypotheses: 0,
		embeddings: 0,
		hypothesesVerified: 0,
		conceptualSkills: 0,
		llmCalls: 0,
		llmSuccesses: 0,
		embedCalls: 0,
		embedSuccesses: 0,
	};
}


async function ingestRollouts(store: NexusStore, config: NexusConfig, counters: PipelineCounters, llmClient: NexusLlmClient | null): Promise<void> {
	const sessionDir = path.join(store.options.agentDir, "sessions");
	const names = await fs.readdir(sessionDir).catch(() => [] as string[]);
	let processed = 0;
	for (const name of names) {
		if (processed >= config.maxRolloutsPerRun) break;
		if (!name.endsWith(".jsonl")) continue;
		const file = path.join(sessionDir, name);
		const text = await Bun.file(file)
			.text()
			.catch(() => "");
		if (!text.trim()) continue;
		const sourceId = store.importSource({
			sourceKind: "rollout",
			sourcePath: file,
			sourceRecordId: name,
			projectKey: store.scope.key,
			content: text,
			rawJson: { file: name },
		});
		if (sourceId) counters.importedSources += 1;
		const rows = parseJsonlLenient(text);
		if (!Array.isArray(rows)) {
			processed += 1;
			continue;
		}
		for (const row of rows) {
			if (!row || typeof row !== "object") continue;
			const entry = row as Record<string, unknown>;
			if (entry.type !== "message") continue;
			const message = entry.message as Record<string, unknown> | undefined;
			if (!message || typeof message.role !== "string") continue;
			const textContent = extractText(message.content);
			if (!textContent) continue;
			const role = String(message.role);
			const extracted = await extractMemories({
				text: textContent,
				role,
				file,
				store,
				llmClient,
				config,
				counters,
			});
			counters.createdEntries += extracted;
		}
		processed += 1;
	}
}

async function extractMemories(args: {
	text: string;
	role: string;
	file: string;
	store: NexusStore;
	llmClient: NexusLlmClient | null;
	config: NexusConfig;
	counters: PipelineCounters;
}): Promise<number> {
	const { text, role, file, store, llmClient, config, counters } = args;
	const normalized = text.trim();
	if (!normalized) return 0;

	if (llmClient && counters.llmCalls < config.maxLlmCalls) {
		counters.llmCalls += 1;
		const llmResult = await extractMemoriesViaLlm(llmClient, normalized, role, config);
		if (llmResult.ok) {
			counters.llmSuccesses += 1;
			let created = 0;
			for (const candidate of llmResult.value) {
				if (!candidate || typeof candidate !== "object") continue;
				const accepted = recordCandidate(store, candidate, file);
				if (accepted) created += 1;
			}
			// Only fall through to heuristics when the LLM returned literally
			// zero useful candidates — usually the LLM is right and we don't
			// want to double-write the same fact via two paths.
			if (created > 0) return created;
		} else {
			logger.debug("Nexus LLM extraction failed; falling back to heuristic", { error: llmResult.error });
		}
	}
	return heuristicExtract(store, normalized, role, file);
}

interface LlmCandidate {
	target?: string;
	content?: string;
	memoryType?: string;
	category?: string;
	confidence?: string;
}

async function extractMemoriesViaLlm(client: NexusLlmClient, text: string, role: string, config: NexusConfig): Promise<{ ok: true; value: LlmCandidate[] } | { ok: false; error: string }> {
	const system = [
		"You distill durable memory from a single transcript message.",
		"Return JSON ONLY with this shape: {\"memories\":[{\"target\":\"user|project|knowledge|failure\",\"content\":\"...\",\"memoryType\":\"preference|project_convention|failure|command|decision|architecture|workflow|tool_quirk|skill_candidate|note\",\"category\":\"preference|convention|tool-quirk|insight|correction|failure\",\"confidence\":\"user_asserted|tool_verified|inferred\"}]}.",
		"Use the empty array when nothing is worth saving long-term. Never invent facts. Never copy secrets, tokens, or credentials.",
		"Prefer short imperative sentences. One memory per distinct fact.",
	].join("\n");
	const userPrompt = [`role: ${role}`, "---", text.slice(0, 4000)].join("\n");
	const result = await client.completeJson<{ memories: LlmCandidate[] }>({
		messages: [{ role: "user", content: userPrompt }],
		system,
		temperature: config.extractionTemperature,
		maxTokens: 512,
		validate: (value): value is { memories: LlmCandidate[] } =>
			!!value &&
			typeof value === "object" &&
			Array.isArray((value as { memories?: unknown }).memories),
	});
	if (!result.ok) return result;
	const memories = result.value.memories;
	return { ok: true, value: Array.isArray(memories) ? memories : [] };
}

const ALLOWED_TARGETS = new Set<NexusMemoryTarget>(["memory", "user", "project", "knowledge", "failure"]);
const ALLOWED_CATEGORIES = new Set<NexusMemoryCategory>([
	"failure",
	"correction",
	"insight",
	"preference",
	"convention",
	"tool-quirk",
]);
const ALLOWED_TYPES = new Set<NexusMemoryType>([
	"preference",
	"project_convention",
	"failure",
	"command",
	"decision",
	"architecture",
	"workflow",
	"tool_quirk",
	"skill_candidate",
	"imported",
	"note",
]);
const ALLOWED_CONFIDENCES = new Set<NexusConfidence>([
	"user_asserted",
	"tool_verified",
	"inferred",
	"imported_unverified",
	"hypothesis",
]);

function recordCandidate(store: NexusStore, candidate: LlmCandidate, sourcePath: string): boolean {
	const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
	if (!content) return false;
	let target = candidate.target;
	if (target === "memory") target = "knowledge";
	if (!target || !ALLOWED_TARGETS.has(target as NexusMemoryTarget)) return false;
	const category = candidate.category && ALLOWED_CATEGORIES.has(candidate.category as NexusMemoryCategory) ? (candidate.category as NexusMemoryCategory) : undefined;
	const memoryType = candidate.memoryType && ALLOWED_TYPES.has(candidate.memoryType as NexusMemoryType) ? (candidate.memoryType as NexusMemoryType) : undefined;
	const confidence = candidate.confidence && ALLOWED_CONFIDENCES.has(candidate.confidence as NexusConfidence) ? (candidate.confidence as NexusConfidence) : "inferred";
	const result = store.add({
		target: target as NexusMemoryTarget,
		content,
		category,
		memoryType,
		confidence,
		provenance: `rollout_llm:${path.basename(sourcePath)}`,
		sourceKind: "rollout",
		sourcePath,
		scope: scopeForTarget(target as NexusMemoryTarget, store.options.cwd),
	});
	return result.success;
}

function heuristicExtract(store: NexusStore, text: string, role: string, sourcePath: string): number {
	let entries = 0;
	if (role === "user" && /(always|never|prefer|please|간결|한국어|avoid|without prompt)/i.test(text)) {
		const result = store.add({
			target: "user",
			content: text,
			category: "preference",
			memoryType: "preference",
			confidence: "inferred",
			provenance: `rollout:${path.basename(sourcePath)}`,
			sourceKind: "rollout",
			sourcePath,
			scope: scopeForTarget("user", store.options.cwd),
		});
		if (result.success) entries += 1;
	}
	if (/(error|failed|failure|stack trace|exception|retry)/i.test(text)) {
		const result = store.add({
			target: "failure",
			content: text,
			category: "failure",
			memoryType: "failure",
			confidence: "inferred",
			provenance: `rollout:${path.basename(sourcePath)}`,
			sourceKind: "rollout",
			sourcePath,
			scope: scopeForTarget("failure", store.options.cwd),
		});
		if (result.success) entries += 1;
	}
	if (/(bun |pnpm |npm |cargo |pytest|jest|sqlite|migration|phase ?1|phase ?2|memory\.backend|skill)/i.test(text)) {
		const result = store.add({
			target: "project",
			content: text,
			memoryType: /(skill)/i.test(text) ? "skill_candidate" : "workflow",
			confidence: "inferred",
			provenance: `rollout:${path.basename(sourcePath)}`,
			sourceKind: "rollout",
			sourcePath,
			scope: scopeForTarget("project", store.options.cwd),
		});
		if (result.success) entries += 1;
	}
	return entries;
}

async function backfillEmbeddings(store: NexusStore, client: NexusEmbeddingClient, config: NexusConfig, counters: PipelineCounters): Promise<void> {
	const budget = Math.max(0, config.maxEmbedCalls - counters.embedCalls);
	if (budget === 0) return;
	const pending = store.listMissingEmbeddings(budget);
	if (pending.length === 0) return;
	counters.embedCalls += pending.length;
	const result = await client.embed(pending.map(entry => entry.content));
	if (!result.ok) {
		logger.debug("Nexus embedding backfill failed", { error: result.error });
		return;
	}
	const model = result.batch.model;
	const vectors = result.batch.vectors;
	let inserted = 0;
	for (let i = 0; i < pending.length; i += 1) {
		const vector = vectors[i];
		if (!vector || vector.length === 0) continue;
		store.addEmbedding(pending[i].id, vector, model);
		counters.embeddings += 1;
		inserted += 1;
	}
	if (inserted > 0) counters.embedSuccesses += 1;
}

async function verifyProposedHypotheses(store: NexusStore, config: NexusConfig, counters: PipelineCounters, llmClient: NexusLlmClient | null): Promise<void> {
	const hypotheses = store.listHypotheses("proposed", 5);
	if (hypotheses.length === 0) return;
	const activeMemory = store.list({ scope: "all", limit: 80 }).map(entry => `- ${entry.content}`).join("\n");
	for (const hypothesis of hypotheses) {
		if (!llmClient || counters.llmCalls >= config.maxLlmCalls) {
			if (hypothesis.supportingMemoryIds.length === 0) {
				if (store.updateHypothesisStatus(hypothesis.id, "expired", "No supporting memory ids remained available for verification.", "nexus_hypothesis_fallback")) {
					counters.hypothesesVerified += 1;
				}
			}
			continue;
		}
		counters.llmCalls += 1;
		const result = await llmClient.completeJson<{ status: "accepted" | "rejected" | "expired"; reason: string }>({
			system: [
				"Verify one proposed memory hypothesis against active durable memory.",
				"Return JSON only: {\"status\":\"accepted|rejected|expired\",\"reason\":\"...\"}.",
				"accepted means active memory directly supports the hypothesis.",
				"rejected means active memory directly contradicts it.",
				"expired means active memory is insufficient to judge it.",
				"Never use outside knowledge.",
			].join("\n"),
			messages: [
				{
					role: "user",
					content: [
						"Active memory:",
						activeMemory || "- No active memory.",
						"",
						`Prompt: ${hypothesis.prompt}`,
						`Hypothesis: ${hypothesis.hypothesis}`,
					].join("\n"),
				},
			],
			temperature: 0,
			maxTokens: 240,
			validate: (value): value is { status: "accepted" | "rejected" | "expired"; reason: string } => {
				const maybe = value as { status?: unknown; reason?: unknown };
				return (maybe.status === "accepted" || maybe.status === "rejected" || maybe.status === "expired") && typeof maybe.reason === "string";
			},
		});
		if (!result.ok) continue;
		counters.llmSuccesses += 1;
		if (store.updateHypothesisStatus(hypothesis.id, result.value.status, result.value.reason)) counters.hypothesesVerified += 1;
	}
}

async function promoteConceptualSkills(store: NexusStore, config: NexusConfig, counters: PipelineCounters, llmClient: NexusLlmClient | null): Promise<void> {
	const candidates = store.listSkillCandidateEntries(40);
	if (candidates.length < 3 || !llmClient || counters.llmCalls >= config.maxLlmCalls) return;
	const grouped = new Map<string, typeof candidates>();
	for (const entry of candidates) {
		const bucket = grouped.get(entry.scopeId);
		if (bucket) bucket.push(entry);
		else grouped.set(entry.scopeId, [entry]);
	}
	for (const [scopeId, entries] of grouped) {
		if (entries.length < 3 || counters.llmCalls >= config.maxLlmCalls) continue;
		counters.llmCalls += 1;
		const result = await llmClient.completeJson<{ name: string; content: string; sourceMemoryIds?: string[] }>({
			system: [
				"Create one reusable procedural skill from repeated memory evidence.",
				"Return JSON only: {\"name\":\"short slug-like name\",\"content\":\"procedure markdown\",\"sourceMemoryIds\":[\"...\"]}.",
				"Only use facts present in the input memories. If no real reusable skill exists, return name=\"\" and content=\"\".",
			].join("\n"),
			messages: [
				{
					role: "user",
					content: entries
						.slice(0, 8)
						.map(entry => `- id=${entry.id} type=${entry.memoryType} content=${entry.content.slice(0, 500)}`)
						.join("\n"),
				},
			],
			temperature: 0,
			maxTokens: 700,
			validate: (value): value is { name: string; content: string; sourceMemoryIds?: string[] } => {
				const maybe = value as { name?: unknown; content?: unknown; sourceMemoryIds?: unknown };
				return typeof maybe.name === "string" && typeof maybe.content === "string" && (maybe.sourceMemoryIds === undefined || Array.isArray(maybe.sourceMemoryIds));
			},
		});
		if (!result.ok) continue;
		counters.llmSuccesses += 1;
		const name = result.value.name.trim();
		const content = result.value.content.trim();
		if (!name || !content) continue;
		const allowedIds = new Set(entries.map(entry => entry.id));
		const sourceIds = (result.value.sourceMemoryIds ?? entries.slice(0, 8).map(entry => entry.id)).filter(id => allowedIds.has(id));
		if (sourceIds.length === 0) continue;
		if (store.upsertSkill(scopeId, name, content, sourceIds, "active")) counters.conceptualSkills += 1;
	}
}

async function reflect(store: NexusStore, config: NexusConfig, counters: PipelineCounters, llmClient: NexusLlmClient | null): Promise<void> {
	if (!config.dreamEnabled) return;
	const projectEntries = store.search({ query: store.scope.displayName, scope: "current_project", limit: 8 });
	if (projectEntries.length === 0) return;

	if (llmClient && counters.llmCalls < config.maxLlmCalls) {
		counters.llmCalls += 1;
		const reflection = await reflectViaLlm(llmClient, projectEntries.map(entry => entry.content), config);
		if (reflection.ok) {
			counters.llmSuccesses += 1;
			store.createHypothesis(reflection.value.prompt, reflection.value.hypothesis, projectEntries.map(entry => entry.id));
			counters.hypotheses += 1;
			return;
		}
		logger.debug("Nexus dream LLM failed; falling back to deterministic hypothesis", { error: reflection.error });
	}

	// Deterministic fallback — at least register that we looked, so the dream
	// loop is auditable from artifacts.
	store.createHypothesis(
		`What recurring pattern in ${store.scope.displayName} memory deserves verification?`,
		`Future work on ${store.scope.displayName} will likely benefit from validating commands and conventions before edits.`,
		projectEntries.map(entry => entry.id),
	);
	counters.hypotheses += 1;
}

async function reflectViaLlm(client: NexusLlmClient, recentContents: string[], config: NexusConfig): Promise<{ ok: true; value: { prompt: string; hypothesis: string } } | { ok: false; error: string }> {
	const system = [
		"You are reading a few short durable memories from a single project and proposing ONE hypothesis worth verifying.",
		"Return JSON ONLY of the exact shape: {\"prompt\": string, \"hypothesis\": string}.",
		"Hard rules:",
		"- Use only nouns, commands, file names, dates, and proper nouns that appear verbatim in the provided memories.",
		"- Do not invent topics such as performance, latency, concurrency, scalability, monitoring, benchmarking, or compliance unless they are already present in the input.",
		"- The hypothesis must be a single falsifiable claim about something the team can verify next session with a concrete action.",
		"- If the memories do not support any non-trivial hypothesis, return {\"prompt\":\"No hypothesis worth verifying.\",\"hypothesis\":\"No hypothesis worth verifying.\"}.",
	].join("\n");
	const userPrompt = ["Recent durable memory (newest first):", ...recentContents.slice(0, 12).map((content, i) => `- (#${i + 1}) ${content.slice(0, 400)}`)].join("\n");
	const result = await client.completeJson<{ prompt: string; hypothesis: string }>({
		messages: [{ role: "user", content: userPrompt }],
		system,
		temperature: config.reflectionTemperature,
		maxTokens: 400,
		validate: (value): value is { prompt: string; hypothesis: string } =>
			!!value &&
			typeof (value as { prompt?: unknown }).prompt === "string" &&
			typeof (value as { hypothesis?: unknown }).hypothesis === "string",
	});
	if (!result.ok) return result;
	const trimmedPrompt = result.value.prompt.trim();
	const trimmedHypothesis = result.value.hypothesis.trim();
	if (!trimmedPrompt || !trimmedHypothesis) return { ok: false, error: "empty hypothesis" };
	return { ok: true, value: { prompt: trimmedPrompt, hypothesis: trimmedHypothesis } };
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map(block => {
			if (!block || typeof block !== "object") return "";
			const maybe = block as { text?: unknown; type?: unknown };
			return maybe.type === "text" && typeof maybe.text === "string" ? maybe.text : "";
		})
		.join("\n")
		.trim();
}
