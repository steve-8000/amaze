import { templateFor } from "../../mission/core/lifecycle-template";
import type { MissionControlRuntime } from "../../mission/core/mission-control-runtime";
import type { ToolDescriptor, ToolExecutionContext, ToolRiskLevel } from "../registry/tool-descriptor";
import { GATEWAY_MUTATION_TOOLS } from "./session-gateway";
import type { PolicyDecision, PolicyGate } from "./tool-gateway";

export interface MissionPolicyGateDeps {
	missionControl: MissionControlRuntime;
	mutationToolNames?: ReadonlySet<string>;
}

export class MissionPolicyGate implements PolicyGate {
	readonly #deps: MissionPolicyGateDeps;
	readonly #mutationTools: ReadonlySet<string>;

	constructor(deps: MissionPolicyGateDeps) {
		this.#deps = deps;
		this.#mutationTools = deps.mutationToolNames ?? GATEWAY_MUTATION_TOOLS;
	}

	check(descriptor: ToolDescriptor, _ctx: ToolExecutionContext, _riskLevel: ToolRiskLevel): PolicyDecision {
		if (!this.#mutationTools.has(descriptor.name)) return { allowed: true };

		const mission = this.#deps.missionControl.getActiveMission();
		if (!mission) {
			return { allowed: false, reason: "mission-required", code: "PROMOTE_REQUIRED" };
		}

		// Proposal invariant: a proposal-required intent may not run a mutation tool until an
		// approved proposal is attached — independent of lifecycle. Checking lifecycle here (the
		// previous behaviour) let any path that advanced the mission to `executing` slip mutations
		// through without a proposal; the gate is the invariant, not the phase.
		const template = templateFor(mission.intent ?? "code_change");
		if (template.requireProposalBeforeMutation && !mission.proposalId) {
			return { allowed: false, reason: "proposal-required", code: "PROPOSAL_REQUIRED" };
		}

		return { allowed: true };
	}
}
