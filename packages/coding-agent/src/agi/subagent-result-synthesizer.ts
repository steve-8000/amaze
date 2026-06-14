import type { RuntimeRole } from "../autonomy/types";

/**
 * A single subagent's observed result. This is the parent-visible projection of a mission
 * task run: status, the evidence it linked, the artifacts it was contracted to produce, and
 * (for reviewers/verifiers/security) a coarse verdict the synthesizer reasons over.
 */
export interface SubAgentResult {
	taskId: string;
	role: RuntimeRole;
	status: "completed" | "failed" | "blocked";
	/** Mission evidence refs derived from the run (output/patch/branch/run handles). */
	evidenceRefs: string[];
	/** Files the subagent changed (Builder). */
	changedFiles?: string[];
	/**
	 * Role verdict for gating roles. Reviewer/Verifier/Security emit `pass` / `fail`.
	 * Absent means the role does not gate (e.g. Planner, Researcher).
	 */
	verdict?: "pass" | "fail";
	/** Short reason, surfaced in blocked/revision decisions. */
	note?: string;
}

export interface SynthesisConflict {
	/** The roles / tasks whose changed files overlap. */
	taskIds: string[];
	path: string;
}

export type SynthesizedDecision =
	| { kind: "accept"; evidenceRefs: string[]; changedFiles: string[] }
	| { kind: "blocked"; reason: string; conflicts: SynthesisConflict[]; evidenceRefs: string[] }
	| { kind: "needs_revision"; targetRole: RuntimeRole; revisionRequest: string };

const ROLE_REQUIRES_PASS: RuntimeRole[] = ["Reviewer", "Verifier"];

function detectFileConflicts(results: SubAgentResult[]): SynthesisConflict[] {
	const byPath = new Map<string, string[]>();
	for (const result of results) {
		for (const file of result.changedFiles ?? []) {
			const owners = byPath.get(file) ?? [];
			owners.push(result.taskId);
			byPath.set(file, owners);
		}
	}
	const conflicts: SynthesisConflict[] = [];
	for (const [path, owners] of byPath) {
		if (owners.length > 1) conflicts.push({ path, taskIds: [...new Set(owners)] });
	}
	return conflicts;
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

/**
 * Collapse a set of subagent results into a single terminal decision. The invariant this
 * enforces is the whole point of the AGI control plane: a pile of subagent outputs must
 * close as `accept`, `blocked`, or `needs_revision` — never as another "here are the
 * findings" list. The precedence is intentionally strict and fail-closed:
 *
 *  1. any failed/blocked subagent, or a gating role that returned no verdict → blocked;
 *  2. a Security `fail` → blocked (security never downgrades to a soft revision);
 *  3. a Reviewer `fail` → needs_revision (the Builder must fix and re-run);
 *  4. a Verifier `fail` → blocked (evidence did not hold);
 *  5. conflicting changed files across subagents → blocked;
 *  6. a mutation with no evidence refs → blocked;
 *  7. otherwise → accept, surfacing the union of evidence + changed files.
 */
export function synthesizeSubAgentResults(results: SubAgentResult[]): SynthesizedDecision {
	const evidenceRefs = dedupe(results.flatMap(result => result.evidenceRefs));

	if (results.length === 0) {
		return { kind: "blocked", reason: "No subagent results to synthesize.", conflicts: [], evidenceRefs };
	}

	const broken = results.filter(result => result.status !== "completed");
	if (broken.length > 0) {
		const roles = broken.map(result => `${result.role}(${result.status})`).join(", ");
		return { kind: "blocked", reason: `Subagent(s) did not complete: ${roles}.`, conflicts: [], evidenceRefs };
	}

	// A gating role that completed but produced no verdict cannot be trusted as a pass.
	const missingVerdict = results.filter(
		result => ROLE_REQUIRES_PASS.includes(result.role) && result.verdict === undefined,
	);
	if (missingVerdict.length > 0) {
		const roles = missingVerdict.map(result => result.role).join(", ");
		return {
			kind: "blocked",
			reason: `Gating role(s) returned no verdict: ${roles}.`,
			conflicts: [],
			evidenceRefs,
		};
	}

	const securityFail = results.find(result => result.role === "Security" && result.verdict === "fail");
	if (securityFail) {
		return {
			kind: "blocked",
			reason: `Security review failed: ${securityFail.note ?? "forbidden-scope or risk finding"}.`,
			conflicts: [],
			evidenceRefs,
		};
	}

	const reviewerFail = results.find(result => result.role === "Reviewer" && result.verdict === "fail");
	if (reviewerFail) {
		return {
			kind: "needs_revision",
			targetRole: "Builder",
			revisionRequest: reviewerFail.note ?? "Reviewer rejected the change; revise and re-run.",
		};
	}

	const verifierFail = results.find(result => result.role === "Verifier" && result.verdict === "fail");
	if (verifierFail) {
		return {
			kind: "blocked",
			reason: `Verifier could not confirm the change: ${verifierFail.note ?? "evidence insufficient"}.`,
			conflicts: [],
			evidenceRefs,
		};
	}

	const conflicts = detectFileConflicts(results);
	if (conflicts.length > 0) {
		const paths = conflicts.map(conflict => conflict.path).join(", ");
		return { kind: "blocked", reason: `Conflicting changed files across subagents: ${paths}.`, conflicts, evidenceRefs };
	}

	const changedFiles = dedupe(results.flatMap(result => result.changedFiles ?? []));
	if (changedFiles.length > 0 && evidenceRefs.length === 0) {
		return {
			kind: "blocked",
			reason: "Subagents changed files but produced no evidence refs.",
			conflicts: [],
			evidenceRefs,
		};
	}

	return { kind: "accept", evidenceRefs, changedFiles };
}
