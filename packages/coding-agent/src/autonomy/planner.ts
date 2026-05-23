import type { LearningProposal } from "../learning";
import type { Objective } from "./types";

interface MetricRemediation {
	patch: Record<string, unknown>;
	reason: string;
	rollback: Record<string, unknown>;
}

const BUILTIN_REMEDIATIONS: Record<string, MetricRemediation> = {
	force_complete_rate: {
		patch: { "goal.uncertainPolicy": "ask" },
		reason: "Reduce forced completions by requiring uncertainty to be surfaced before completion.",
		rollback: { "goal.uncertainPolicy": "complete" },
	},
	verifier_bypass_rate: {
		patch: { "task.yield.allowSchemaBypass": false },
		reason: "Reduce verifier bypasses by disabling schema bypass for task yield validation.",
		rollback: { "task.yield.allowSchemaBypass": true },
	},
	shell_criteria_bypass_rate: {
		patch: { "verifier.allowShellCriteria": false },
		reason: "Reduce shell verifier bypasses by disabling shell criteria in verifier policy.",
		rollback: { "verifier.allowShellCriteria": true },
	},
};

export function planFromMetrics(
	objective: Objective,
	metrics: Record<string, number>,
	opts: { sessionId?: string } = {},
): LearningProposal | null {
	const mismatch = objective.metricTargets.find(target => {
		const value = metrics[target.metric];
		if (value === undefined || !Number.isFinite(value)) return false;
		return target.direction === "down" ? value > target.target : value < target.target;
	});

	if (!mismatch) return null;

	const base = {
		id: `autonomy-${objective.id}-${mismatch.metric}-${Date.now()}`,
		createdAt: Date.now(),
		status: "pending" as const,
		gate: "human-required" as const,
		evidence: {
			sessionIds: opts.sessionId ? [opts.sessionId] : [],
			eventRefs: [],
			ruleFindings: [],
			sampleN: 1,
		},
		provenance: { source: "reflection" as const },
	};

	const remediation = BUILTIN_REMEDIATIONS[mismatch.metric];
	if (remediation) {
		return {
			...base,
			type: "settings",
			patch: remediation.patch,
			reason: `${remediation.reason} Objective: ${objective.title}. Current ${mismatch.metric}=${metrics[mismatch.metric]}, target ${mismatch.direction} ${mismatch.target}.`,
			rollback: remediation.rollback,
		};
	}

	return {
		...base,
		type: "rule",
		ruleMarkdown: `# ${objective.title}\n\nInvestigate metric \`${mismatch.metric}\` and propose a bounded remediation because current value ${metrics[mismatch.metric]} is not ${mismatch.direction} target ${mismatch.target}.`,
		replaySessions: opts.sessionId ? [opts.sessionId] : [],
		expectedImpact: `Move ${mismatch.metric} ${mismatch.direction} toward ${mismatch.target}.`,
	};
}
