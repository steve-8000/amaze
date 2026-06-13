/**
 * Cognition plane — goal decomposition planner.
 *
 * Turns a mission objective into a validated {@link MissionPlan} DAG and
 * persists it through the existing (previously unused) `mission_plans` /
 * `mission_plan_steps` tables. This is the first module that makes "the system
 * decomposes its own goals" a fact in code rather than a prompt convention.
 *
 * Design:
 * - The LLM is an injectable seam ({@link PlannerLlm}); the deterministic core
 *   (prompt assembly, output parsing, DAG validation, revision bookkeeping) is
 *   unit-testable without a model.
 * - Replanning is feedback-driven: critic findings are passed back into the
 *   prompt and the revision counter increments, preserving the previous plan's
 *   rationale chain in the store.
 * - Learned heuristics (KnowledgeStore L5) and world-model claims are injected
 *   as planning context so past failures inform new decompositions.
 */

import type { MissionPlan, MissionPlanStep } from "../mission/core/mission";
import { MISSION_PLAN_STEP_EDGE_KINDS, type MissionPlanStepEdge } from "../mission/core/mission";

/** Minimal LLM seam: system + user prompt in, raw text out. */
export type PlannerLlm = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface PlanningContext {
	/** The mission objective to decompose. */
	objective: string;
	/** Hard constraints the plan must respect. */
	constraints?: string[];
	/** Learned heuristics from past missions (KnowledgeStore claims). */
	heuristics?: string[];
	/** World-model claims relevant to this mission. */
	worldModel?: string[];
	/** Critic feedback from a rejected prior plan (drives replanning). */
	criticFeedback?: string[];
	/** Prior plan being revised, if any. */
	priorPlan?: MissionPlan;
}

export const PLANNER_SYSTEM_PROMPT = [
	"You are a planning module inside an autonomous coding agent.",
	"Decompose the given objective into a minimal, ordered set of executable steps.",
	"Rules:",
	"- Output ONLY a JSON object, no prose, no code fences.",
	'- Shape: {"rationale": string, "steps": [{"id": string, "description": string, "dependsOn": string[]}]}',
	"- Step ids are short slugs (s1, s2, ...). dependsOn references earlier step ids only.",
	"- 2 to 9 steps. Each step must be independently verifiable.",
	"- Respect every constraint verbatim.",
	"- If critic feedback is present, the new plan MUST address each finding.",
].join("\n");

/** Assemble the user prompt from the planning context. Pure. */
export function buildPlannerPrompt(ctx: PlanningContext): string {
	const sections: string[] = [`<objective>\n${ctx.objective}\n</objective>`];
	if (ctx.constraints?.length) {
		sections.push(`<constraints>\n${ctx.constraints.map(c => `- ${c}`).join("\n")}\n</constraints>`);
	}
	if (ctx.heuristics?.length) {
		sections.push(`<learned-heuristics>\n${ctx.heuristics.map(h => `- ${h}`).join("\n")}\n</learned-heuristics>`);
	}
	if (ctx.worldModel?.length) {
		sections.push(`<world-model>\n${ctx.worldModel.map(w => `- ${w}`).join("\n")}\n</world-model>`);
	}
	if (ctx.priorPlan) {
		const steps = ctx.priorPlan.steps.map(s => `- ${s.id}: ${s.description}`).join("\n");
		sections.push(`<prior-plan revision="${ctx.priorPlan.revision ?? 0}">\n${steps}\n</prior-plan>`);
	}
	if (ctx.criticFeedback?.length) {
		sections.push(`<critic-feedback>\n${ctx.criticFeedback.map(f => `- ${f}`).join("\n")}\n</critic-feedback>`);
	}
	return sections.join("\n\n");
}

export interface PlanParseResult {
	plan?: MissionPlan;
	errors: string[];
}

const VALID_EDGE_KINDS = new Set<string>(MISSION_PLAN_STEP_EDGE_KINDS);
const MAX_STEPS = 9;

/**
 * Parse and validate raw LLM output into a MissionPlan. Enforces the DAG
 * invariants the store and dispatcher rely on: unique ids, no dangling or
 * forward-only-violating references, acyclic dependency graph, step count
 * bounds. Returns errors instead of throwing so the caller can retry.
 */
export function parsePlannerOutput(raw: string): PlanParseResult {
	const errors: string[] = [];
	const jsonText = extractJsonObject(raw);
	if (!jsonText) return { errors: ["no JSON object found in planner output"] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		return { errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
	}
	if (!parsed || typeof parsed !== "object") return { errors: ["planner output is not an object"] };
	const obj = parsed as Record<string, unknown>;
	if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
		return { errors: ["planner output has no steps"] };
	}
	if (obj.steps.length > MAX_STEPS) {
		errors.push(`too many steps (${obj.steps.length} > ${MAX_STEPS})`);
	}

	const steps: MissionPlanStep[] = [];
	const seen = new Set<string>();
	for (const [index, rawStep] of obj.steps.entries()) {
		if (!rawStep || typeof rawStep !== "object") {
			errors.push(`step ${index} is not an object`);
			continue;
		}
		const step = rawStep as Record<string, unknown>;
		const id = typeof step.id === "string" && step.id.trim() ? step.id.trim() : `s${index + 1}`;
		if (seen.has(id)) {
			errors.push(`duplicate step id: ${id}`);
			continue;
		}
		seen.add(id);
		const description = typeof step.description === "string" ? step.description.trim() : "";
		if (!description) {
			errors.push(`step ${id} has no description`);
			continue;
		}
		const edges: MissionPlanStepEdge[] = [];
		const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
		for (const target of dependsOn) {
			if (typeof target === "string" && target.trim()) {
				edges.push({ target: target.trim(), kind: "depends-on" });
			}
		}
		// Accept optional typed edges when the model emits them.
		if (Array.isArray(step.edges)) {
			for (const rawEdge of step.edges) {
				if (!rawEdge || typeof rawEdge !== "object") continue;
				const edge = rawEdge as Record<string, unknown>;
				if (typeof edge.target === "string" && typeof edge.kind === "string" && VALID_EDGE_KINDS.has(edge.kind)) {
					edges.push({ target: edge.target, kind: edge.kind as MissionPlanStepEdge["kind"] });
				}
			}
		}
		steps.push({ id, description, ...(edges.length > 0 ? { edges } : {}) });
	}

	// Dangling reference check.
	const ids = new Set(steps.map(s => s.id));
	for (const step of steps) {
		for (const edge of step.edges ?? []) {
			if (!ids.has(edge.target)) errors.push(`step ${step.id} references unknown step ${edge.target}`);
		}
	}
	// Cycle check (DFS over depends-on edges).
	if (hasCycle(steps)) errors.push("dependency graph contains a cycle");

	if (errors.length > 0) return { errors };
	const plan: MissionPlan = { steps };
	if (typeof obj.rationale === "string" && obj.rationale.trim()) plan.rationale = obj.rationale.trim();
	return { plan, errors: [] };
}

function extractJsonObject(raw: string): string | null {
	// Strip code fences if present, then find the outermost object.
	const cleaned = raw.replace(/```(?:json)?/g, "").trim();
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	return cleaned.slice(start, end + 1);
}

function hasCycle(steps: MissionPlanStep[]): boolean {
	const adjacency = new Map<string, string[]>(
		steps.map(step => [step.id, (step.edges ?? []).filter(e => e.kind === "depends-on").map(e => e.target)]),
	);
	const state = new Map<string, "visiting" | "done">();
	const visit = (id: string): boolean => {
		const current = state.get(id);
		if (current === "visiting") return true;
		if (current === "done") return false;
		state.set(id, "visiting");
		for (const next of adjacency.get(id) ?? []) {
			if (visit(next)) return true;
		}
		state.set(id, "done");
		return false;
	};
	return steps.some(step => visit(step.id));
}

export interface DecomposeOptions {
	/** Max LLM attempts when output fails validation (default 2). */
	maxAttempts?: number;
}

export interface DecomposeResult {
	plan: MissionPlan;
	attempts: number;
}

/**
 * Decompose a goal into a validated plan. Retries once with the validation
 * errors appended when the first output fails, then throws — a planner that
 * cannot produce a valid DAG must surface that, not silently degrade.
 */
export async function decomposeGoal(
	ctx: PlanningContext,
	llm: PlannerLlm,
	options: DecomposeOptions = {},
): Promise<DecomposeResult> {
	const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
	let prompt = buildPlannerPrompt(ctx);
	let lastErrors: string[] = [];
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const raw = await llm(PLANNER_SYSTEM_PROMPT, prompt);
		const { plan, errors } = parsePlannerOutput(raw);
		if (plan) {
			// Revision chain: a revised plan increments the prior revision.
			plan.revision = (ctx.priorPlan?.revision ?? 0) + 1;
			return { plan, attempts: attempt };
		}
		lastErrors = errors;
		prompt = `${buildPlannerPrompt(ctx)}\n\n<validation-errors>\nYour previous output was invalid:\n${errors
			.map(e => `- ${e}`)
			.join("\n")}\nEmit corrected JSON only.\n</validation-errors>`;
	}
	throw new Error(`planner produced no valid plan after ${maxAttempts} attempts: ${lastErrors.join("; ")}`);
}
