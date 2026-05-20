import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import { getRockeyLlmConfig, resolveRockeyModel } from "./llm-resolver";
import { getRockeyDbPath } from "./store";

export interface RockeyDoctorRun {
	id: number;
	createdAt: string;
	score: number;
	status: "PASS" | "WARN" | "DEGRADED" | "FAIL";
	detailsJson: string;
}

export interface RockeyDoctorCheck {
	label: string;
	score: number;
	maxScore: number;
	note: string;
}

export interface RockeyDoctorResult {
	score: number;
	status: "PASS" | "WARN" | "DEGRADED" | "FAIL";
	checks: RockeyDoctorCheck[];
	recommendations: string[];
}

export function evaluateRockeyDoctor(settings: Settings, modelRegistry?: ModelRegistry): RockeyDoctorResult {
	const checks: RockeyDoctorCheck[] = [];
	const recommendations: string[] = [];
	const staticMax = settings.get("rockey.staticPromptMaxChars") ?? 1200;
	checks.push(scoreStaticPrompt(staticMax));
	checks.push(scoreSearchBounds(settings));
	checks.push(scoreAutoRecall(settings, recommendations));
	checks.push(scoreSessionSearch(settings));
	checks.push(scoreArtifactSafety());
	checks.push(scoreScopePrecision());
	checks.push(scoreScanner());
	checks.push(scoreLlmIsolation(settings, modelRegistry, recommendations));
	const total = round1(checks.reduce((sum, check) => sum + check.score, 0));
	return {
		score: total,
		status: classifyDoctorScore(total),
		checks,
		recommendations,
	};
}

export function persistRockeyDoctorResult(agentDir: string, result: RockeyDoctorResult): void {
	const db = openDoctorDb(getRockeyDbPath(agentDir));
	try {
		db.prepare("INSERT INTO doctor_runs (created_at, score, status, details_json) VALUES (?, ?, ?, ?)").run(
			new Date().toISOString(),
			result.score,
			result.status,
			JSON.stringify(result),
		);
	} finally {
		db.close(false);
	}
}

export function listRockeyDoctorRuns(agentDir: string, limit = 10): RockeyDoctorRun[] {
	const db = openDoctorDb(getRockeyDbPath(agentDir));
	try {
		const rows = db
			.prepare("SELECT id, created_at, score, status, details_json FROM doctor_runs ORDER BY id DESC LIMIT ?")
			.all(limit) as Array<{ id: number; created_at: string; score: number; status: string; details_json: string }>;
		return rows.map(row => ({
			id: row.id,
			createdAt: row.created_at,
			score: row.score,
			status: row.status as RockeyDoctorRun["status"],
			detailsJson: row.details_json,
		}));
	} finally {
		db.close(false);
	}
}

export function renderRockeyDoctor(result: RockeyDoctorResult): string {
	const lines = [`Rockey Doctor: ${result.score.toFixed(1)} / 10 ${result.status}`, "", "Context Safety"];
	for (const check of result.checks) {
		const mark = check.score >= check.maxScore ? "✓" : check.score > 0 ? "!" : "✗";
		lines.push(
			`${mark} ${check.label}: ${check.score.toFixed(1)} / ${check.maxScore.toFixed(1)} ${check.note}`.trim(),
		);
	}
	if (result.recommendations.length > 0) {
		lines.push("", "Recommendations:");
		for (const recommendation of result.recommendations) lines.push(`- ${recommendation}`);
	}
	return lines.join("\n");
}

function openDoctorDb(dbPath: string): Database {
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath, { create: true });
	db.exec(`
		CREATE TABLE IF NOT EXISTS doctor_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TEXT NOT NULL,
			score REAL NOT NULL,
			status TEXT NOT NULL,
			details_json TEXT NOT NULL
		);
	`);
	return db;
}

function scoreStaticPrompt(staticMax: number): RockeyDoctorCheck {
	if (staticMax <= 1200)
		return { label: "Static prompt footprint", score: 2.0, maxScore: 2.0, note: "policy-only prompt is bounded" };
	if (staticMax <= 2400)
		return {
			label: "Static prompt footprint",
			score: 1.0,
			maxScore: 2.0,
			note: "prompt cap is higher than recommended",
		};
	return { label: "Static prompt footprint", score: 0.0, maxScore: 2.0, note: "static prompt cap is unsafe" };
}

function scoreSearchBounds(settings: Settings): RockeyDoctorCheck {
	const entries = settings.get("rockey.searchResultMaxEntries") ?? 5;
	const chars = settings.get("rockey.searchResultMaxChars") ?? 2400;
	const entryChars = settings.get("rockey.searchEntryMaxChars") ?? 480;
	if (entries <= 5 && chars <= 2400 && entryChars <= 480) {
		return { label: "Retrieval bounds", score: 2.0, maxScore: 2.0, note: "search output caps enforced" };
	}
	if (entries <= 8 && chars <= 4000 && entryChars <= 800) {
		return { label: "Retrieval bounds", score: 1.0, maxScore: 2.0, note: "search caps are looser than recommended" };
	}
	return { label: "Retrieval bounds", score: 0.0, maxScore: 2.0, note: "search caps are too large" };
}

function scoreAutoRecall(settings: Settings, recommendations: string[]): RockeyDoctorCheck {
	const enabled = settings.get("rockey.autoRecall") ?? false;
	const limit = settings.get("rockey.autoRecallLimit") ?? 3;
	const chars = settings.get("rockey.autoRecallMaxChars") ?? 1800;
	if (!enabled) {
		recommendations.push("Keep rockey.autoRecall disabled unless a workflow proves it is necessary.");
		return { label: "Auto recall safety", score: 1.5, maxScore: 1.5, note: "disabled by default" };
	}
	if (limit <= 5 && chars <= 1800)
		return { label: "Auto recall safety", score: 1.0, maxScore: 1.5, note: "enabled with bounded caps" };
	recommendations.push("Reduce rockey.autoRecallLimit and rockey.autoRecallMaxChars to avoid context blow-up.");
	return { label: "Auto recall safety", score: 0.0, maxScore: 1.5, note: "enabled with unsafe caps" };
}

function scoreSessionSearch(settings: Settings): RockeyDoctorCheck {
	const anchors = settings.get("rockey.sessionSearchMaxAnchors") ?? 8;
	const chars = settings.get("rockey.sessionSearchMaxPreviewChars") ?? 1600;
	if (anchors <= 8 && chars <= 1600) {
		return { label: "Session search safety", score: 1.0, maxScore: 1.0, note: "anchor-first output is bounded" };
	}
	return { label: "Session search safety", score: 0.0, maxScore: 1.0, note: "session search preview caps are unsafe" };
}

function scoreArtifactSafety(): RockeyDoctorCheck {
	return {
		label: "Artifact safety",
		score: 1.0,
		maxScore: 1.0,
		note: "memory://root is derived-only, not auto-injected",
	};
}

function scoreScopePrecision(): RockeyDoctorCheck {
	return { label: "Scope precision", score: 1.0, maxScore: 1.0, note: "project scope uses normalized root hashing" };
}

function scoreScanner(): RockeyDoctorCheck {
	return {
		label: "Secret/injection guard",
		score: 0.5,
		maxScore: 0.5,
		note: "scanner is active on writes and imports",
	};
}

function scoreLlmIsolation(
	settings: Settings,
	modelRegistry: ModelRegistry | undefined,
	recommendations: string[],
): RockeyDoctorCheck {
	if (!settings.get("rockey.llm.enabled")) {
		return { label: "LLM job isolation", score: 1.0, maxScore: 1.0, note: "deterministic-only mode" };
	}
	if (!modelRegistry) {
		recommendations.push("Run Rockey doctor from a live session to validate LLM resolver configuration.");
		return {
			label: "LLM job isolation",
			score: 0.6,
			maxScore: 1.0,
			note: "model registry unavailable; configuration not verified",
		};
	}
	const curation = resolveRockeyModel({ purpose: "curation", settings, modelRegistry });
	const scoring = resolveRockeyModel({ purpose: "scoring", settings, modelRegistry });
	const summary = resolveRockeyModel({ purpose: "summary", settings, modelRegistry });
	const exactConfigured = ["curation", "scoring", "summary"].every(purpose => {
		const config = getRockeyLlmConfig(settings, purpose as "curation" | "scoring" | "summary");
		return Boolean(config.model || config.modelRole || config.provider);
	});
	if (curation.model && scoring.model && summary.model && exactConfigured) {
		return {
			label: "LLM job isolation",
			score: 1.0,
			maxScore: 1.0,
			note: "dedicated Rockey LLM resolver configured",
		};
	}
	if (curation.model && scoring.model && summary.model) {
		recommendations.push(
			"Configure dedicated rockey.llm.* sections instead of relying only on shared modelRoles fallbacks.",
		);
		return {
			label: "LLM job isolation",
			score: 0.8,
			maxScore: 1.0,
			note: "resolver works, but uses shared fallback roles",
		};
	}
	if (!curation.model && !scoring.model && !summary.model) {
		recommendations.push("Configure rockey.llm.<purpose>.modelRole or model to enable background curation jobs.");
		return {
			label: "LLM job isolation",
			score: 0.6,
			maxScore: 1.0,
			note: "no Rockey LLM model resolved; deterministic mode only",
		};
	}
	recommendations.push("Some Rockey LLM purposes do not resolve a model; fill in the missing rockey.llm.* section.");
	return { label: "LLM job isolation", score: 0.4, maxScore: 1.0, note: "partial LLM configuration" };
}

function classifyDoctorScore(score: number): RockeyDoctorResult["status"] {
	if (score >= 9) return "PASS";
	if (score >= 8) return "WARN";
	if (score >= 7) return "DEGRADED";
	return "FAIL";
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
