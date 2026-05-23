import type { AgentMessage } from "@amaze/agent-core";
import { logger } from "@amaze/utils";
import type { Settings } from "../config/settings";
import { persistNexusDoctorResult } from "../nexus/doctor";
import { importLegacyMemorySources } from "../nexus/importers";
import { indexNexusRepository } from "../nexus/knowledge/indexer";
import { NexusKnowledgeStore } from "../nexus/knowledge/store";
import type { NexusKnowledgeSearchResult } from "../nexus/knowledge/types";
import { loadNexusConfig } from "../nexus/config";
import { createNexusEmbeddingClient } from "../nexus/embedding-client";
import { createNexusLlmClient } from "../nexus/llm-client";
import { runNexusOnlineConsolidation, runNexusPipeline } from "../nexus/pipeline";
import { resolveNexusProjectScope } from "../nexus/scope";
import { getNexusRoot, NexusStore } from "../nexus/store";
import type { NexusMemoryEntry } from "../nexus/types";
import type { MemoryBackend, MemoryBackendStartOptions } from "./types";

const states = new WeakMap<object, { imported: boolean }>();

export const nexusBackend: MemoryBackend = {
	id: "nexus",

	async start(options: MemoryBackendStartOptions): Promise<void> {
		const { session, settings, taskDepth } = options;
		if (taskDepth > 0) return;
		const config = loadNexusConfig(settings);
		if (!config.enabled) return;
		const store = new NexusStore({ agentDir: options.agentDir, cwd: session.sessionManager.getCwd() });
		try {
			if (!states.get(session)?.imported) {
				await importLegacyMemorySources(store, settings, {
					rockey: config.migrationRockey,
					local: config.migrationLocal,
					hindsight: config.migrationHindsight,
				});
				states.set(session, { imported: true });
			}
			await runStartupMaintenance(store, settings, config, options.agentDir, session.sessionManager.getCwd());
		} catch (error) {
			logger.debug("Nexus startup failed; continuing without blocking agent loop", { error: String(error) });
		} finally {
			store.close();
		}
	},

	async buildDeveloperInstructions(agentDir: string, settings: Settings, session): Promise<string | undefined> {
		const config = loadNexusConfig(settings);
		if (!config.enabled) return undefined;
		const cwd = session?.sessionManager.getCwd() ?? settings.getCwd();
		const store = new NexusStore({ agentDir, cwd });
		try {
			const summaryPath = `${store.artifactRoot}/memory_summary.md`;
			const projectSummary = await Bun.file(summaryPath)
				.text()
				.catch(() => "");
			const globalSummary = await Bun.file(`${store.root}/global/memory_summary.md`)
				.text()
				.catch(() => "");
			const userSummary = await Bun.file(`${store.root}/user/memory_summary.md`)
				.text()
				.catch(() => "");
			const sections = [projectSummary.trim(), globalSummary.trim(), userSummary.trim()].filter(Boolean);
			if (sections.length === 0) return undefined;
			const body = sections.join("\n\n").slice(0, config.staticPromptMaxChars);
			return [
				"## Memory",
				"",
				"Memory is durable context, not authority. Prefer current user instructions and current repository evidence when they conflict.",
				"",
				body,
			].join("\n");
		} finally {
			store.close();
		}
	},

	async beforeAgentStartPrompt(session, promptText): Promise<string | undefined> {
		const config = loadNexusConfig(session.settings);
		if (!config.enabled || (!config.autoRecall && !(config.knowledgeEnabled && config.knowledgeAutoRecall))) return undefined;
		const cwd = session.sessionManager.getCwd();
		const store = new NexusStore({ agentDir: session.settings.getAgentDir(), cwd });
		const goal = currentGoalText(session);
		try {
			const operationalEntries = config.autoRecall
				? store.search({ query: promptText, goal, scope: "current_project", limit: config.autoRecallLimit })
				: [];
			const knowledgeEntries = config.knowledgeEnabled && config.knowledgeAutoRecall
				? recallKnowledgeEntries(session.settings.getAgentDir(), cwd, promptText, config.knowledgeAutoRecallLimit)
				: [];
			return renderUnifiedRecallBlock({
				goal,
				operationalEntries,
				knowledgeEntries,
				entryMaxChars: config.searchEntryMaxChars,
				maxChars: Math.min(config.searchResultMaxChars, config.knowledgePromptMaxChars),
			});
		} catch (error) {
			logger.debug("Nexus auto-recall failed", { error: String(error) });
			return undefined;
		} finally {
			store.close();
		}
	},

	async preCompactionContext(messages: AgentMessage[], settings: Settings, session): Promise<string | undefined> {
		const config = loadNexusConfig(settings);
		if (!config.enabled || !session) return undefined;
		const query = findLatestUserText(messages);
		if (!query) return undefined;
		const cwd = session.sessionManager.getCwd();
		const store = new NexusStore({ agentDir: settings.getAgentDir(), cwd });
		const goal = currentGoalText(session);
		try {
			const operationalEntries = store.search({ query, goal, scope: "current_project", limit: config.autoRecallLimit });
			const knowledgeEntries = config.knowledgeEnabled && config.knowledgeAutoRecall
				? recallKnowledgeEntries(settings.getAgentDir(), cwd, query, config.knowledgeAutoRecallLimit)
				: [];
			if (operationalEntries.length === 0 && knowledgeEntries.length === 0) return undefined;
			const lines: string[] = [];
			if (goal) lines.push(`Current goal: ${goal}`, "");
			if (operationalEntries.length > 0) {
				lines.push("Relevant durable memory:");
				for (const entry of operationalEntries) lines.push(`- ${truncateForPrompt(entry.content, config.searchEntryMaxChars)}`);
			}
			if (knowledgeEntries.length > 0) {
				if (lines.length > 0) lines.push("");
				lines.push("Relevant repository knowledge:");
				for (const entry of knowledgeEntries) {
					lines.push(`- ${entry.document.path}:${entry.chunk.startLine}-${entry.chunk.endLine} ${truncateForPrompt(oneLine(entry.chunk.content), config.searchEntryMaxChars)}`);
				}
			}
			return lines.join("\n").slice(0, Math.min(config.searchResultMaxChars, config.knowledgePromptMaxChars));
		} catch {
			return undefined;
		} finally {
			store.close();
		}
	},

	async clear(agentDir: string, cwd: string, session): Promise<void> {
		if (session) states.delete(session);
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.clear();
			await store.renderArtifacts();
		} finally {
			store.close();
		}
	},

	async enqueue(agentDir: string, cwd: string): Promise<void> {
		const store = new NexusStore({ agentDir, cwd });
		try {
			store.runSelfHealing();
			await store.renderArtifacts();
		} finally {
			store.close();
		}
	},

	onTurnEnd(session, event): void {
		const config = loadNexusConfig(session.settings);
		if (!config.enabled || !config.onlineConsolidationEnabled) return;
		if ((session as { taskDepth?: number }).taskDepth && (session as { taskDepth?: number }).taskDepth! > 0) return;
		if (event.type !== "turn_end") return;
		const assistant = (event as { message?: AgentMessage }).message;
		if (!assistant || assistant.role !== "assistant") return;
		if ("stopReason" in assistant && (assistant.stopReason === "aborted" || assistant.stopReason === "error")) return;
		const assistantText = extractAgentMessageText(assistant);
		if (!assistantText) return;
		const userText = findLatestUserText(session.agent.state.messages);
		const messages = [
			userText ? { role: "user", content: userText } : undefined,
			assistantText ? { role: "assistant", content: assistantText } : undefined,
		].filter((message): message is { role: "user" | "assistant"; content: string } => Boolean(message?.content.trim()));
		if (messages.length === 0) return;
		const sourceRecordId = `${session.sessionManager.getSessionId?.() ?? "session"}:turn:${Date.now()}`;
		void (async () => {
			const store = new NexusStore({ agentDir: session.settings.getAgentDir(), cwd: session.sessionManager.getCwd() });
			try {
				const llmClient = createNexusLlmClient(config);
				const embeddingClient = createNexusEmbeddingClient(config);
				await runNexusOnlineConsolidation(store, session.settings, sourceRecordId, messages, { llmClient, embeddingClient });
			} catch (error) {
				logger.debug("Nexus online consolidation failed", { error: String(error) });
			} finally {
				store.close();
			}
		})();
	},
};

async function runStartupMaintenance(
	store: NexusStore,
	settings: Settings,
	config: ReturnType<typeof loadNexusConfig>,
	agentDir: string,
	cwd: string,
): Promise<void> {
	const llmClient = createNexusLlmClient(config);
	const embeddingClient = createNexusEmbeddingClient(config);
	const pipelineResult = await runNexusPipeline(store, settings, { llmClient, embeddingClient });
	logger.debug("Nexus pipeline completed", {
		importedSources: pipelineResult.importedSources,
		createdEntries: pipelineResult.createdEntries,
		hypotheses: pipelineResult.hypotheses,
		embeddings: pipelineResult.embeddings,
		usedLlm: pipelineResult.usedLlm,
		usedEmbeddings: pipelineResult.usedEmbeddings,
	});
	if (config.healingEnabled) store.runSelfHealing();
	await store.renderArtifacts();
	await runKnowledgeMaintenance(agentDir, cwd, config);
	await persistNexusDoctorResult(settings, cwd);
}

async function runKnowledgeMaintenance(
	agentDir: string,
	cwd: string,
	config: ReturnType<typeof loadNexusConfig>,
): Promise<void> {
	if (!config.knowledgeEnabled) return;
	const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
	const statePath = `${getNexusRoot(agentDir)}/knowledge-maintenance.json`;
	const previousState = await Bun.file(statePath)
		.json()
		.catch(() => null) as { repoRoot?: string; indexedAt?: string } | null;
	const indexedAtMs = previousState?.indexedAt ? Date.parse(previousState.indexedAt) : Number.NaN;
	const withinInterval =
		previousState?.repoRoot === repoRoot
		&& Number.isFinite(indexedAtMs)
		&& Date.now() - indexedAtMs < config.knowledgeMaintenanceMinIntervalMs;
	if (withinInterval) return;
	const stats = await indexNexusRepository({
		agentDir,
		cwd,
		repoRoot,
		maxFiles: config.knowledgeMaxIndexedFiles,
		maxFileBytes: config.knowledgeMaxFileBytes,
	});
	await Bun.write(
		statePath,
		`${JSON.stringify({ repoRoot, indexedAt: new Date().toISOString(), stats }, null, 2)}\n`,
	);
}

function recallKnowledgeEntries(
	agentDir: string,
	cwd: string,
	query: string,
	limit: number,
): NexusKnowledgeSearchResult[] {
	const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
	const store = new NexusKnowledgeStore({ agentDir, cwd });
	try {
		return store.search({ query, repoRoot, limit });
	} finally {
		store.close();
	}
}

function renderUnifiedRecallBlock(args: {
	goal?: string;
	operationalEntries: NexusMemoryEntry[];
	knowledgeEntries: NexusKnowledgeSearchResult[];
	entryMaxChars: number;
	maxChars: number;
}): string | undefined {
	const { goal, operationalEntries, knowledgeEntries, entryMaxChars, maxChars } = args;
	if (operationalEntries.length === 0 && knowledgeEntries.length === 0) return undefined;
	const seen = new Set<string>();
	const seenKnowledgeSpans = new Set<string>();
	const lines: string[] = ["## Relevant Nexus Context", ""];
	if (goal) lines.push(`goal: ${goal}`, "");
	const goalOverhead = lines.join("\n").length;
	const operationalBudget = Math.max(120, Math.floor((maxChars - goalOverhead) * 0.45));
	const knowledgeBudget = Math.max(120, maxChars - goalOverhead - operationalBudget);
	if (operationalEntries.length > 0) {
		const sectionLines = ["### Operational memory"];
		for (const entry of operationalEntries) {
			const text = truncateForPrompt(entry.content, entryMaxChars);
			const key = normalizeRecallText(text);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			sectionLines.push(`- [${entry.scopeKind}/${entry.confidence}/${entry.staleness}] ${text}`);
		}
		appendBudgetedSection(lines, sectionLines, operationalBudget);
	}
	if (knowledgeEntries.length > 0) {
		const sectionLines = ["### Repository knowledge"];
		for (const entry of knowledgeEntries) {
			const spanKey = `${entry.document.path}:${entry.chunk.startLine}-${entry.chunk.endLine}`;
			if (seenKnowledgeSpans.has(spanKey)) continue;
			seenKnowledgeSpans.add(spanKey);
			const snippet = truncateForPrompt(oneLine(entry.chunk.content), Math.max(40, Math.floor(entryMaxChars * 0.75)));
			const key = `${spanKey}:${normalizeRecallText(snippet)}`;
			if (!snippet || seen.has(key)) continue;
			seen.add(key);
			sectionLines.push(`- ${spanKey} [${entry.matchKind}] ${snippet}`);
		}
		appendBudgetedSection(lines, sectionLines, knowledgeBudget);
	}
	const rendered = lines.join("\n").trim();
	return rendered ? rendered.slice(0, maxChars) : undefined;
}
function appendBudgetedSection(target: string[], sectionLines: string[], maxChars: number): void {
	if (sectionLines.length <= 1 || maxChars <= 0) return;
	const accepted: string[] = [];
	let used = 0;
	for (const line of sectionLines) {
		const next = `${line}\n`;
		if (accepted.length > 1 && used + next.length > maxChars) break;
		accepted.push(line);
		used += next.length;
	}
	if (accepted.length > 0) {
		if (target[target.length - 1] !== "") target.push("");
		target.push(...accepted, "");
	}
}

function normalizeRecallText(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function truncateForPrompt(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function findLatestUserText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			const trimmed = message.content.trim();
			if (trimmed) return trimmed;
			continue;
		}
		if (!Array.isArray(message.content)) continue;
		const text = message.content
			.map(block => (block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : ""))
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

function extractAgentMessageText(message: AgentMessage): string | undefined {
	if (!("content" in message)) return undefined;
	const content = message.content;
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed || undefined;
	}
	if (!Array.isArray(content)) return undefined;
	const text = content
		.map((block: unknown) => {
			if (!block || typeof block !== "object") return "";
			if ("text" in block && typeof (block as { text?: unknown }).text === "string") return (block as { text: string }).text;
			return "";
		})
		.join("\n")
		.trim();
	return text || undefined;
}

function currentGoalText(session: { getGoalModeState?: () => { goal?: { objective?: string } | null } | undefined }): string | undefined {
	const objective = session.getGoalModeState?.()?.goal?.objective?.trim();
	return objective ? objective : undefined;
}
