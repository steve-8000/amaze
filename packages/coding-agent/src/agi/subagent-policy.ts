import type { ContractiblePlanStep, ObjectiveContract, RuntimeRole } from "../autonomy/types";

/**
 * The mandatory subagent roles a mission must enlist before its work counts as progress,
 * plus a short rationale per role for audit/observability. The defining rule of the AGI
 * control plane: a role here is NOT a suggestion — if the runtime cannot spawn it, the
 * action is invalid (see {@link SubAgentOrchestrator}).
 */
export interface SubAgentExpansion {
	roles: RuntimeRole[];
	rationale: Partial<Record<RuntimeRole, string>>;
}

export interface SubAgentPolicyInput {
	contract: ObjectiveContract;
	plan: { steps: ContractiblePlanStep[] };
	/** Set when running under the `strict-self-improve` profile (the agent edits its own code). */
	selfImprovement?: boolean;
}

// Declaration order of RuntimeRole — the expansion is emitted in this stable order so callers,
// snapshots, and tests see a deterministic role list.
const ROLE_ORDER: RuntimeRole[] = [
	"Planner",
	"Researcher",
	"Builder",
	"Reviewer",
	"Verifier",
	"Critic",
	"MemoryCurator",
	"SRE",
	"Security",
];

function stepMutatesWorkspace(step: ContractiblePlanStep): boolean {
	return step.requiresWrite === true || step.requiresCommands === true;
}

function stepTouchesInfrastructure(step: ContractiblePlanStep): boolean {
	return step.requiresInfrastructure === true;
}

/** True when any of a step's touched paths / its kind matches one of the policy patterns. */
function matchesPolicyPatterns(step: ContractiblePlanStep, patterns: string[]): boolean {
	if (patterns.length === 0) return false;
	const targets = [step.kind, ...(step.touches ?? [])];
	return patterns.some(pattern =>
		targets.some(target => target === pattern || target.includes(pattern) || pattern.includes(target)),
	);
}

/**
 * Expand an objective contract + plan into the set of subagent roles that MUST participate.
 *
 * The policy is risk- and scope-driven, not phrasing-driven:
 * - every mission needs a Planner;
 * - any workspace mutation pulls in Builder + Reviewer + Verifier (you cannot write without review and proof);
 * - medium+ risk always needs a Reviewer; high/critical risk also needs a Critic;
 * - `researchRequired` freshness pulls in a Researcher;
 * - paths/kinds matching the role policy's security/SRE lists pull in Security / SRE;
 * - self-improvement is the strictest: Critic + Security + Reviewer + Verifier regardless of plan shape.
 */
export function expandSubAgentRoles(input: SubAgentPolicyInput): SubAgentExpansion {
	const { contract, plan, selfImprovement } = input;
	const rationale = new Map<RuntimeRole, string>();
	const add = (role: RuntimeRole, why: string): void => {
		if (!rationale.has(role)) rationale.set(role, why);
	};

	add("Planner", "Every mission requires a Planner to decompose the objective.");

	const mutates = plan.steps.some(stepMutatesWorkspace);
	if (plan.steps.some(step => step.requiresWrite)) {
		add("Builder", "Plan contains repository write steps.");
	}
	if (mutates) {
		add("Builder", "Plan mutates the workspace.");
		add("Reviewer", "Workspace mutation requires review before apply.");
		add("Verifier", "Workspace mutation requires evidence-backed verification.");
	}

	const risk = contract.risk;
	if (risk === "medium" || risk === "high" || risk === "critical") {
		add("Reviewer", `Objective risk is ${risk}; review is mandatory.`);
	}
	if (risk === "high" || risk === "critical") {
		add("Critic", `Objective risk is ${risk}; an adversarial Critic must probe failure modes.`);
	}

	if (contract.freshnessPolicy?.researchRequired) {
		add("Researcher", "Freshness policy requires up-to-date external research.");
	}

	const securityPatterns = contract.rolePolicy.requireSecurityFor ?? [];
	if (plan.steps.some(step => matchesPolicyPatterns(step, securityPatterns))) {
		add("Security", "A plan step touches a security-sensitive scope.");
	}

	const srePatterns = contract.rolePolicy.requireSreFor ?? [];
	if (plan.steps.some(step => stepTouchesInfrastructure(step) || matchesPolicyPatterns(step, srePatterns))) {
		add("SRE", "A plan step operates infrastructure or matches an SRE-required scope.");
	}

	if (selfImprovement) {
		add("Critic", "Self-improvement requires an adversarial Critic.");
		add("Security", "Self-improvement requires a Security review of the agent's own changes.");
		add("Reviewer", "Self-improvement requires code review.");
		add("Verifier", "Self-improvement requires evidence-backed verification.");
	}

	const roles = ROLE_ORDER.filter(role => rationale.has(role));
	const rationaleRecord: Partial<Record<RuntimeRole, string>> = {};
	for (const role of roles) rationaleRecord[role] = rationale.get(role);
	return { roles, rationale: rationaleRecord };
}
