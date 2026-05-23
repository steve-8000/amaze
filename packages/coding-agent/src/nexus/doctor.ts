import * as fs from "node:fs";
import * as path from "node:path";

import type { Settings } from "../config/settings";
import { loadNexusConfig, resolveNexusCapabilities } from "./config";
import { NexusKnowledgeStore } from "./knowledge/store";
import { createNexusEmbeddingClient } from "./embedding-client";
import { createNexusLlmClient } from "./llm-client";
import { resolveNexusProjectScope } from "./scope";
import { getNexusRoot, NexusStore } from "./store";
import type { NexusDoctorResult } from "./types";

/**
 * Synchronous, config-only diagnosis. Cheap; safe to run on every startup.
 * For real reachability checks against the configured local LLM / embedder use
 * `evaluateNexusDoctorLive` instead.
 */
export function evaluateNexusDoctor(settings: Settings, cwd: string): NexusDoctorResult {
	const config = loadNexusConfig(settings);
	const store = new NexusStore({ agentDir: settings.getAgentDir(), cwd });
	const knowledgeStore = new NexusKnowledgeStore({ agentDir: settings.getAgentDir(), cwd });
	try {
		const stats = store.stats();
		const capabilities = resolveNexusCapabilities(config);
		const checks: NexusDoctorResult["checks"] = [];
		checks.push({
			id: "backend",
			status: config.enabled ? "PASS" : "WARN",
			message: config.enabled ? "Nexus backend selected." : "Nexus backend not selected.",
		});
		checks.push({
			id: "retrieval",
			status: "PASS",
			message: `Retrieval mode: ${capabilities.retrievalMode}.`,
		});
		checks.push({
			id: "llm",
			status: capabilities.llm === "unavailable" ? "WARN" : "PASS",
			message: `LLM capability: ${capabilities.llm}.`,
		});
		checks.push({
			id: "embeddings",
			status: capabilities.embeddings === "unavailable" ? "WARN" : "PASS",
			message: `Embeddings capability: ${capabilities.embeddings}.`,
		});
		checks.push({
			id: "contradictions",
			status: stats.unresolvedContradictions > 0 ? "WARN" : "PASS",
			message: `${stats.unresolvedContradictions} unresolved contradictions.`,
		});
		checks.push({
			id: "quarantine",
			status: stats.quarantined > 0 ? "WARN" : "PASS",
			message: `${stats.quarantined} quarantined memory entries.`,
		});
		const repoRoot = resolveNexusProjectScope(cwd).repoRoot ?? cwd;
		const knowledgeStats = knowledgeStore.knowledgeDoctorStats(repoRoot);
		const maintenancePath = path.join(getNexusRoot(settings.getAgentDir()), "knowledge-maintenance.json");
		const maintenanceState = fs.existsSync(maintenancePath)
			? (JSON.parse(fs.readFileSync(maintenancePath, "utf8")) as { indexedAt?: string } | null)
			: null;
		checks.push({
			id: "knowledge_scope",
			status: knowledgeStats.foreignDocuments > 0 ? "WARN" : "PASS",
			message: knowledgeStats.foreignDocuments > 0
				? `${knowledgeStats.foreignDocuments} indexed documents belong to other repo roots.`
				: "Repository knowledge is scoped to the current repo root.",
		});
		checks.push({
			id: "knowledge_provenance",
			status: knowledgeStats.symbolsMissingEndLine > 0 ? "WARN" : "PASS",
			message: knowledgeStats.symbolsMissingEndLine > 0
				? `${knowledgeStats.symbolsMissingEndLine} code symbols are missing end-line provenance.`
				: "Repository knowledge provenance is complete for indexed code symbols.",
		});
		const indexedAt = maintenanceState?.indexedAt ?? knowledgeStats.newestIndexedAt;
		const indexedAgeMs = indexedAt ? Math.max(0, Date.now() - Date.parse(indexedAt)) : Number.POSITIVE_INFINITY;
		checks.push({
			id: "knowledge_freshness",
			status: knowledgeStats.repoDocuments === 0
				? "WARN"
				: indexedAgeMs > config.knowledgeMaintenanceMinIntervalMs * 4
					? "WARN"
					: "PASS",
			message: knowledgeStats.repoDocuments === 0
				? "Current repo root has no indexed knowledge documents."
				: `Current repo root has ${knowledgeStats.repoDocuments} indexed knowledge documents; newest index age ${Math.round(indexedAgeMs / 1000)}s.`,
		});
		return finalizeDoctor(capabilities, stats, checks);
	} finally {
		knowledgeStore.close();
		store.close();
	}
}

/**
 * Live diagnosis. In addition to the static config checks, actually pings the
 * configured LLM with a tiny prompt and asks the embedding model for one
 * vector. Results surface as `llm_live` and `embeddings_live` checks.
 *
 * Always settles within `timeoutMs` per provider (default 30s) and never
 * throws — failures degrade to `WARN`/`FAIL` checks so the agent can still
 * report a doctor verdict even when local servers are misconfigured.
 */
export async function evaluateNexusDoctorLive(settings: Settings, cwd: string, options: { timeoutMs?: number } = {}): Promise<NexusDoctorResult> {
	const base = evaluateNexusDoctor(settings, cwd);
	const config = loadNexusConfig(settings);
	const timeoutMs = options.timeoutMs ?? 30_000;
	const liveChecks: NexusDoctorResult["checks"] = [];

	if (config.llmEnabled) {
		const llmClient = createNexusLlmClient(config, { timeoutMs, retries: 0 });
		if (!llmClient) {
			liveChecks.push({ id: "llm_live", status: "WARN", message: "LLM enabled but client could not be instantiated (missing baseUrl/model)." });
		} else {
			const result = await llmClient.completeJson<{ ok: true }>({
				messages: [{ role: "user", content: "Return {\"ok\":true}." }],
				system: "Return JSON only.",
				temperature: 0,
				maxTokens: 64,
				validate: (value): value is { ok: true } => Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true),
			});
			liveChecks.push({
				id: "llm_live",
				status: result.ok ? "PASS" : "FAIL",
				message: result.ok
					? `LLM live probe responded (${llmClient.provider}/${llmClient.model}).`
					: `LLM live probe failed: ${result.error.slice(0, 200)}`,
			});
		}
	}

	if (config.embeddingsEnabled) {
		const embeddingClient = createNexusEmbeddingClient(config, { timeoutMs });
		if (!embeddingClient) {
			liveChecks.push({ id: "embeddings_live", status: "WARN", message: "Embeddings enabled but client could not be instantiated (missing baseUrl/model)." });
		} else {
			const result = await embeddingClient.embed(["doctor probe"]);
			if (!result.ok) {
				liveChecks.push({ id: "embeddings_live", status: "FAIL", message: `Embeddings live probe failed: ${result.error.slice(0, 200)}` });
			} else {
				const dim = result.batch.vectors[0]?.length ?? 0;
				liveChecks.push({
					id: "embeddings_live",
					status: dim > 0 ? "PASS" : "FAIL",
					message: dim > 0
						? `Embeddings live probe responded with ${dim}-d vectors (${embeddingClient.provider}/${embeddingClient.model}).`
						: "Embeddings live probe returned an empty vector.",
				});
			}
		}
	}

	const checks = [...base.checks, ...liveChecks];
	return finalizeDoctor(base.capabilities, base.stats, checks);
}

function finalizeDoctor(
	capabilities: NexusDoctorResult["capabilities"],
	stats: NexusDoctorResult["stats"],
	checks: NexusDoctorResult["checks"],
): NexusDoctorResult {
	const fails = checks.filter(check => check.status === "FAIL").length;
	const warns = checks.filter(check => check.status === "WARN").length;
	const score = Math.max(0, 10 - warns * 1.5 - fails * 3);
	const status: NexusDoctorResult["status"] = fails > 0 ? "FAIL" : warns > 0 ? "WARN" : "PASS";
	return { status, score, capabilities, checks, stats };
}

export function getNexusDoctorArtifactPath(settings: Settings): string {
	return path.join(getNexusRoot(settings.getAgentDir()), "doctor.json");
}

export async function persistNexusDoctorResult(settings: Settings, cwd: string, options: { live?: boolean } = {}): Promise<void> {
	const result = options.live ? await evaluateNexusDoctorLive(settings, cwd) : evaluateNexusDoctor(settings, cwd);
	await Bun.write(getNexusDoctorArtifactPath(settings), `${JSON.stringify(result, null, 2)}\n`);
}
