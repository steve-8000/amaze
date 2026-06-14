import type { RuntimeRole } from "../autonomy/types";
import { getBundledAgent } from "../task/agents";
import { type MissionTaskBinding, MissionTaskRunner, type RunSubprocessFn } from "../task/mission-task-runner";
import type { AgentDefinition } from "../task/types";
import { ROLE_OUTPUT_ARTIFACTS, type RoleRunner } from "./subagent-orchestrator";

/** Marker a gating subagent (Reviewer/Verifier/Security) emits so its verdict is machine-readable. */
export const ROLE_VERDICT_MARKER = "ROLE_VERDICT:";

const GATING_ROLES: RuntimeRole[] = ["Reviewer", "Verifier", "Security"];

/**
 * Map a runtime role to the bundled agent definition that executes it. Only Builder / Researcher /
 * Reviewer / SRE ship as dedicated bundled agents; the remaining roles run on the Builder
 * generalist (it can read, write, run commands, and follow a role-specific assignment).
 */
function defaultResolveAgent(role: RuntimeRole): AgentDefinition {
	const direct = getBundledAgent(role);
	if (direct) return direct;
	const builder = getBundledAgent("Builder");
	if (!builder) throw new Error("Bundled Builder agent is unavailable; cannot run subagent roles.");
	return builder;
}

/**
 * Role-specific behavioral brief. Roles without a dedicated bundled agent run on the Builder
 * generalist (see {@link defaultResolveAgent}); this brief is what makes each role behave
 * distinctly — Planner plans, Critic critiques, MemoryCurator curates — rather than all
 * Builder-backed roles acting identically. Typed as an exhaustive {@link RuntimeRole} record so
 * the compiler forces a distinct brief for every role — a future role cannot silently regress to
 * a generic assignment.
 */
const ROLE_BRIEFS: Record<RuntimeRole, string> = {
	Planner:
		"Decompose the mission into an ordered, dependency-aware sequence of concrete steps (files, functions, types). Do not implement; produce the plan only.",
	Researcher:
		"Gather external evidence relevant to the mission. Cite every source with its URL and check date; never assert an unverified claim as fact.",
	Builder: "Implement the mission's change end-to-end and report exactly which files you altered.",
	Reviewer:
		"Review the produced change for correctness, safety, and scope discipline. Ground every finding in the actual diff.",
	Verifier:
		"Verify the mission's acceptance criteria against observable evidence (tests, command output). Distinguish proven from unproven.",
	Critic:
		"Adversarially enumerate the failure modes, hidden assumptions, and edge cases the plan or change could break. Be specific and concrete.",
	Security:
		"Assess the change for security risks (injection, secrets, auth, unsafe deserialization, supply chain). Report concrete risks, not generic advice.",
	SRE: "Assess operational and deployment risk (rollout, health, rollback, resource limits) for the mission's change.",
	MemoryCurator:
		"Distill durable, reusable lessons from this mission into concise knowledge updates; deduplicate against what is already known.",
};

export function buildAssignment(role: RuntimeRole): string {
	const artifacts = ROLE_OUTPUT_ARTIFACTS[role] ?? [];
	const lines = [
		`You are acting as the ${role} subagent for an AGI runtime mission.`,
		ROLE_BRIEFS[role],
		artifacts.length > 0
			? `You MUST produce the following artifact file(s) before yielding: ${artifacts.join(", ")}.`
			: "Produce your role's deliverable before yielding.",
	];
	if (GATING_ROLES.includes(role)) {
		lines.push(
			`As a gating role, end your output with exactly one line: \`${ROLE_VERDICT_MARKER} pass\` or \`${ROLE_VERDICT_MARKER} fail\`.`,
		);
	}
	return lines.join("\n");
}

/** Parse the trailing `ROLE_VERDICT: pass|fail` marker from a gating subagent's output. */
export function parseRoleVerdict(output: string): "pass" | "fail" | undefined {
	const matches = output.match(/ROLE_VERDICT:\s*(pass|fail)/gi);
	if (!matches || matches.length === 0) return undefined;
	const last = matches[matches.length - 1]?.toLowerCase();
	return last?.includes("fail") ? "fail" : "pass";
}

export interface BundledRoleRunnerOptions {
	cwd: string;
	missionId: string;
	/** Injectable executor seam — defaults to the real subprocess runner inside MissionTaskRunner. */
	runSubprocess?: RunSubprocessFn;
	resolveAgent?: (role: RuntimeRole) => AgentDefinition;
	/**
	 * Detects which mandated artifacts a finished run produced. The default heuristic scans the
	 * subagent's output for each mandated filename token; inject a stricter (e.g. file-exists)
	 * detector when an artifacts directory is wired.
	 */
	detectArtifacts?: (role: RuntimeRole, output: string) => string[];
}

function defaultDetectArtifacts(role: RuntimeRole, output: string): string[] {
	const required = ROLE_OUTPUT_ARTIFACTS[role] ?? [];
	return required.filter(artifact => output.includes(artifact));
}

/**
 * Build a {@link RoleRunner} that executes each mandated role as a real bundled subagent through
 * {@link MissionTaskRunner}. The subprocess seam is injectable so the mapping (status, evidence,
 * verdict, artifacts) is unit-testable without spawning a model.
 */
export function createBundledRoleRunner(options: BundledRoleRunnerOptions): RoleRunner {
	const resolveAgent = options.resolveAgent ?? defaultResolveAgent;
	const detectArtifacts = options.detectArtifacts ?? defaultDetectArtifacts;

	return async ({ role, task }) => {
		const binding: MissionTaskBinding = { missionId: options.missionId, taskId: task.id };
		const runner = new MissionTaskRunner(binding, options.runSubprocess);
		const agent = resolveAgent(role);
		const assignment = buildAssignment(role);

		const {
			result,
			evidenceRefs,
			task: ranTask,
		} = await runner.run({
			cwd: options.cwd,
			agent,
			task: assignment,
			description: `${role} subagent`,
			index: 0,
			id: task.id,
			persistArtifacts: true,
		});

		const status = ranTask.status === "completed" ? "completed" : ranTask.status === "blocked" ? "blocked" : "failed";
		const verdict = GATING_ROLES.includes(role) ? parseRoleVerdict(result.output) : undefined;
		return {
			status,
			evidenceRefs,
			artifacts: detectArtifacts(role, result.output),
			...(verdict ? { verdict } : {}),
			...(result.error ? { note: result.error } : {}),
		};
	};
}
