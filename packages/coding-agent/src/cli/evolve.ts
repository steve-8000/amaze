import { ObjectiveStore } from "../autonomy";
import { DEFAULT_AUTONOMY_FORBIDDEN_SCOPES, normalizeObjectiveGuardrails } from "../autonomy/guardrails";
import { ProposalStore } from "../learning";
import { evaluateProposal } from "../learning/eval/pipeline";

export interface EvolveStatusArgs {
	db?: string;
	proposalsDb?: string;
}

export interface EvolveDoctorArgs {
	db?: string;
}

export interface EvolveSimulateArgs {
	db?: string;
	id: string;
}

export async function runEvolveStatusCommand(args: EvolveStatusArgs): Promise<void> {
	const objectives = new ObjectiveStore(args.db);
	const proposals = new ProposalStore(args.proposalsDb);
	try {
		const activeObjectives = objectives.list().filter(objective => objective.status === "active");
		const pendingProposals = proposals.listByStatus("pending");
		const lines = [
			"EVOLUTION STATE",
			`Active objectives: ${activeObjectives.length}`,
			`Pending proposals: ${pendingProposals.length}`,
			`Guardrail defaults: ${DEFAULT_AUTONOMY_FORBIDDEN_SCOPES.join(", ")}`,
		];
		if (activeObjectives.length === 0 && pendingProposals.length === 0) {
			lines.push("No active evolution flow.");
		}
		process.stdout.write(`${lines.join("\n")}\n`);
	} finally {
		proposals.close();
		objectives.close();
	}
}

export async function runEvolveDoctorCommand(args: EvolveDoctorArgs): Promise<void> {
	const objectives = new ObjectiveStore(args.db);
	try {
		const activeObjectives = objectives.list().filter(objective => objective.status === "active");
		const lines = ["EVOLVE DOCTOR", "Default guardrail forbidden scopes:"];
		for (const scope of DEFAULT_AUTONOMY_FORBIDDEN_SCOPES) {
			lines.push(`  - ${scope}`);
		}
		lines.push(`Active objectives: ${activeObjectives.length}`);
		for (const objective of activeObjectives) {
			const guardrails = normalizeObjectiveGuardrails(objective.guardrails);
			lines.push(`${objective.id}: ${guardrails.forbiddenScopes.join(", ")}`);
		}
		process.stdout.write(`${lines.join("\n")}\n`);
	} finally {
		objectives.close();
	}
}

export async function runEvolveSimulateCommand(args: EvolveSimulateArgs): Promise<void> {
	const store = new ProposalStore(args.db);
	try {
		const proposal = store.get(args.id);
		if (!proposal) {
			process.stderr.write(`proposal not found: ${args.id}\n`);
			process.exitCode = 1;
			return;
		}
		const report = await evaluateProposal(proposal, {});
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} finally {
		store.close();
	}
}
