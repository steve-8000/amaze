/**
 * LLM-backed objective-runtime seams. These are MODEL-AGNOSTIC: they consume the
 * generic {@link LlmText} seam (the same `PlannerLlm` shape used by the cognition
 * planner), so whether the model is local (Ollama/LM Studio served through the
 * model registry) or cloud is decided entirely by the caller's settings — not here.
 *
 * Both adapters degrade safely: a malformed or empty model response falls back to a
 * deterministic outcome (no mission generated / completion allowed to stand on the
 * metric proof) rather than throwing. The objective runtime must never wedge because
 * a planner model was unavailable.
 */

import type { MissionInput } from "../mission/core/mission-input";
import { missionInputForTarget, type ObjectiveCompletionReviewer, type ObjectiveDecomposer } from "./objective-runtime";
import type { Objective } from "./types";

/** Minimal LLM seam: system + user prompt in, raw text out. Mirrors cognition's `PlannerLlm`. */
export type LlmText = (systemPrompt: string, userPrompt: string) => Promise<string>;

const DECOMPOSER_SYSTEM_PROMPT = [
	"You are the mission generator for an autonomous coding agent's objective runtime.",
	"Given an objective and the state of its prior missions, produce the NEXT missions to run.",
	"Rules:",
	"- Output ONLY a JSON object, no prose, no code fences.",
	'- Shape: {"missions": [{"title": string, "objective": string, "metric"?: string}]}',
	"- One mission per still-unmet objective metric target; do not regenerate a met target.",
	"- `metric`, when present, MUST be one of the objective's declared metric names.",
	"- Keep it minimal: only what is needed to close the remaining gap.",
].join("\n");

const REVIEWER_SYSTEM_PROMPT = [
	"You are the completion reviewer for an autonomous coding agent's objective runtime.",
	"The deterministic gate already proved every metric target was met by a completed mission.",
	"Your job is the harder question: is the objective GENUINELY done, or did missions pass",
	"their narrow checks while real work (design, integration, untested branches) remains?",
	"Rules:",
	"- Output ONLY a JSON object, no prose, no code fences.",
	'- Shape: {"verdict": "pass" | "fail", "reason": string, "followUps"?: [{"title": string, "objective": string}]}',
	'- "pass" only when you are confident no further work is warranted.',
	'- On "fail", list the follow-up missions that would close the gap (may be empty).',
].join("\n");

function extractJsonObject(raw: string): string | null {
	const cleaned = raw.replace(/```(?:json)?/g, "").trim();
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	return cleaned.slice(start, end + 1);
}

function safeParse(raw: string): Record<string, unknown> | null {
	const json = extractJsonObject(raw);
	if (!json) return null;
	try {
		const value = JSON.parse(json) as unknown;
		return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function objectiveContext(objective: Objective, unmetMetrics: string[]): string {
	return [
		`<objective>\n${objective.title}\n</objective>`,
		`<declared-metrics>\n${objective.metricTargets.map(t => `- ${t.metric} (${t.direction} to ${t.target})`).join("\n") || "- none"}\n</declared-metrics>`,
		`<unmet-metrics>\n${unmetMetrics.map(m => `- ${m}`).join("\n") || "- none"}\n</unmet-metrics>`,
	].join("\n\n");
}

/**
 * Build an {@link ObjectiveDecomposer} backed by an LLM. Falls back to the
 * deterministic metric-target decomposition for any metric the model names but does
 * not (or cannot) describe, and returns `[]` (deferring to the caller's settle path)
 * when the model produces nothing usable.
 */
export function createLlmObjectiveDecomposer(llm: LlmText): ObjectiveDecomposer {
	return async ({ objective, reevaluation }) => {
		const unmet = reevaluation.unmetMetrics;
		if (unmet.length === 0) return [];
		const metricByName = new Map(objective.metricTargets.map(target => [target.metric, target]));

		let parsed: Record<string, unknown> | null = null;
		try {
			const raw = await llm(DECOMPOSER_SYSTEM_PROMPT, objectiveContext(objective, unmet));
			parsed = safeParse(raw);
		} catch {
			parsed = null;
		}

		const rows = Array.isArray(parsed?.missions) ? (parsed.missions as unknown[]) : [];
		const missions: MissionInput[] = [];
		const coveredMetrics = new Set<string>();
		for (const row of rows) {
			if (typeof row !== "object" || row === null) continue;
			const record = row as Record<string, unknown>;
			const title = asString(record.title);
			const objectiveText = asString(record.objective);
			const metric = asString(record.metric);
			// Anchor every generated mission to a real unmet metric so the re-evaluation
			// loop can recognise which target it closes. A row that names no valid unmet
			// metric is dropped — the runtime never fabricates progress against nothing.
			if (!metric || !unmet.includes(metric) || coveredMetrics.has(metric)) continue;
			const target = metricByName.get(metric);
			if (!target) continue;
			coveredMetrics.add(metric);
			if (title && objectiveText) {
				const base = missionInputForTarget(objective, target);
				missions.push({ ...base, title, objective: objectiveText });
			} else {
				missions.push(missionInputForTarget(objective, target));
			}
		}

		// Deterministic backstop: any unmet metric the model skipped still gets a mission,
		// so an LLM that under-produces cannot strand the objective.
		for (const metric of unmet) {
			if (coveredMetrics.has(metric)) continue;
			const target = metricByName.get(metric);
			if (target) missions.push(missionInputForTarget(objective, target));
		}
		return missions;
	};
}

/**
 * Build an {@link ObjectiveCompletionReviewer} backed by an LLM. On any model
 * failure it returns `pass` — the deterministic metric proof already stands, so a
 * reviewer outage must not block a legitimately complete objective.
 */
export function createLlmCompletionReviewer(llm: LlmText): ObjectiveCompletionReviewer {
	return async ({ objective, reevaluation }) => {
		let parsed: Record<string, unknown> | null = null;
		try {
			const raw = await llm(REVIEWER_SYSTEM_PROMPT, objectiveContext(objective, reevaluation.unmetMetrics));
			parsed = safeParse(raw);
		} catch {
			return { verdict: "pass", reason: "completion reviewer unavailable; metric proof stands" };
		}
		if (!parsed) return { verdict: "pass", reason: "completion reviewer returned no verdict; metric proof stands" };

		const verdict = parsed.verdict === "fail" ? "fail" : "pass";
		const reason =
			asString(parsed.reason) ?? (verdict === "fail" ? "completion review rejected" : "completion review passed");
		if (verdict === "pass") return { verdict, reason };

		const followUps: MissionInput[] = [];
		const rows = Array.isArray(parsed.followUps) ? (parsed.followUps as unknown[]) : [];
		for (const row of rows) {
			if (typeof row !== "object" || row === null) continue;
			const record = row as Record<string, unknown>;
			const title = asString(record.title);
			const objectiveText = asString(record.objective);
			if (!title || !objectiveText) continue;
			followUps.push({
				title,
				objective: objectiveText,
				projectId: objective.id,
				mode: "auto",
			});
		}
		return followUps.length > 0 ? { verdict, reason, followUpMissions: followUps } : { verdict, reason };
	};
}
