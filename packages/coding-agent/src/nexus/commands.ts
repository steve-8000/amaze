import type { Settings } from "../config/settings";
import { evaluateNexusDoctor, evaluateNexusDoctorLive } from "./doctor";
import { NexusStore } from "./store";

export function renderNexusStats(agentDir: string, cwd: string): string {
	const store = new NexusStore({ agentDir, cwd });
	try {
		const stats = store.stats();
		return [
			"# Nexus Stats",
			"",
			`- active: ${stats.active}`,
			`- superseded: ${stats.superseded}`,
			`- quarantined: ${stats.quarantined}`,
			`- hypotheses: ${stats.hypotheses}`,
			`- pendingJobs: ${stats.pendingJobs}`,
			`- unresolvedContradictions: ${stats.unresolvedContradictions}`,
			"",
		].join("\n");
	} finally {
		store.close();
	}
}

export function runNexusSearch(agentDir: string, cwd: string, _settings: Settings, query: string, goal?: string): string {
	const store = new NexusStore({ agentDir, cwd });
	try {
		const entries = store.search({ query, goal, scope: "current_project", limit: 8 });
		if (entries.length === 0) return "No Nexus memory results.";
		return [
			"# Nexus Memory Search",
			goal ? `goal: ${goal}` : undefined,
			"",
			...entries.map(entry => `- [${entry.scopeKind}/${entry.confidence}/${entry.staleness}] ${entry.content}`),
			"",
		]
			.filter(Boolean)
			.join("\n");
	} finally {
		store.close();
	}
}

export function runNexusDoctor(settings: Settings, cwd: string): string {
	return renderDoctor(evaluateNexusDoctor(settings, cwd));
}

export async function runNexusDoctorLive(settings: Settings, cwd: string): Promise<string> {
	return renderDoctor(await evaluateNexusDoctorLive(settings, cwd));
}

export function runNexusExplain(agentDir: string, cwd: string, id: string): string {
	const store = new NexusStore({ agentDir, cwd });
	try {
		const explanation = store.explainMemory(id);
		if (!explanation.entry) return `No Nexus memory found for id ${id}.`;
		const entry = explanation.entry;
		const lines = [
			"# Nexus Memory Explanation",
			"",
			`id: ${entry.id}`,
			`scope: ${entry.scopeKind}`,
			`target: ${entry.target}`,
			`confidence: ${entry.confidence}`,
			`staleness: ${entry.staleness}`,
			`status: ${entry.status}`,
			"",
			"## Content",
			entry.content,
			"",
			"## Source",
			`${JSON.stringify(explanation.source ?? null, null, 2)}`,
			"",
			"## Events",
		];
		if (explanation.events.length === 0) lines.push("- No events.");
		else for (const event of explanation.events) lines.push(`- ${String(event.event_type ?? "event")} @ ${String(event.created_at ?? "unknown")}`);
		lines.push("", "## Relations");
		if (explanation.relations.length === 0) lines.push("- No relations.");
		else for (const relation of explanation.relations) lines.push(`- ${String(relation.from_id)} --${String(relation.relation)}--> ${String(relation.to_id)}`);
		lines.push("", "## Usage");
		if (explanation.usage.length === 0) lines.push("- No recorded usage.");
		else for (const usage of explanation.usage) lines.push(`- ${String(usage.used_at)} thread=${String(usage.thread_id ?? "")}`);
		lines.push("");
		return lines.join("\n");
	} finally {
		store.close();
	}
}

function renderDoctor(doctor: ReturnType<typeof evaluateNexusDoctor>): string {
	return [
		`# Nexus Doctor ${doctor.status}`,
		"",
		`score: ${doctor.score.toFixed(1)}/10`,
		"",
		"## Capabilities",
		`- llm: ${doctor.capabilities.llm}`,
		`- embeddings: ${doctor.capabilities.embeddings}`,
		`- vector: ${doctor.capabilities.vector}`,
		`- reranker: ${doctor.capabilities.reranker}`,
		`- retrievalMode: ${doctor.capabilities.retrievalMode}`,
		`- deterministicFallback: ${doctor.capabilities.deterministicFallback}`,
		"",
		"## Checks",
		...doctor.checks.map(check => `- [${check.status}] ${check.id}: ${check.message}`),
		"",
	].join("\n");
}
