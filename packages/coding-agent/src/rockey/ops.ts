import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import { renderRockeySearchResults } from "./admission";
import { evaluateRockeyDoctor, listRockeyDoctorRuns, persistRockeyDoctorResult, renderRockeyDoctor } from "./doctor";
import { importPiHermesMemoryOnce } from "./migration";
import { reindexRockeySessions, searchRockeySessionAnchors } from "./session-search";
import { RockeyStore } from "./store";

export async function runRockeyImport(agentDir: string, cwd: string): Promise<string> {
	const store = new RockeyStore({ agentDir, cwd });
	try {
		await importPiHermesMemoryOnce(store);
		await store.renderArtifacts();
		return "Rockey import completed.";
	} finally {
		store.close();
	}
}

export function renderRockeyStats(agentDir: string, cwd: string): string {
	const store = new RockeyStore({ agentDir, cwd });
	try {
		const stats = store.stats();
		const lines = [
			`Project scope: ${store.scope.displayName}`,
			`Project memories: ${stats.projectEntries}`,
			`Global memories: ${stats.globalEntries}`,
			`Project failures: ${stats.projectFailures}`,
			`Global failures: ${stats.globalFailures}`,
		];
		return lines.join("\n");
	} finally {
		store.close();
	}
}

export function runRockeySearch(agentDir: string, cwd: string, settings: Settings, query: string): string {
	const store = new RockeyStore({ agentDir, cwd });
	try {
		const entries = store.search({
			query,
			scope: store.scope,
			includeGlobal: true,
			limit: settings.get("rockey.searchResultMaxEntries") ?? 5,
		});
		return renderRockeySearchResults(entries, settings).text;
	} finally {
		store.close();
	}
}

export async function runRockeySessionReindex(agentDir: string): Promise<string> {
	const result = await reindexRockeySessions(agentDir);
	return `Indexed ${result.indexed} session files (${result.skipped} unchanged).`;
}

export function runRockeySessionSearch(agentDir: string, cwd: string, settings: Settings, query: string): string {
	return searchRockeySessionAnchors(agentDir, cwd, settings, query).text;
}

export function runRockeyDoctor(agentDir: string, settings: Settings, modelRegistry?: ModelRegistry): string {
	const result = evaluateRockeyDoctor(settings, modelRegistry);
	persistRockeyDoctorResult(agentDir, result);
	return renderRockeyDoctor(result);
}

export function renderRockeyDoctorHistory(agentDir: string): string {
	const runs = listRockeyDoctorRuns(agentDir, 10);
	if (runs.length === 0) return "No Rockey doctor runs recorded yet.";
	return runs.map(run => `${run.createdAt}  ${run.score.toFixed(1)}/10  ${run.status}`).join("\n");
}
