import type { Settings } from "../config/settings";
import type { LearningProposal } from "../learning";
import type { Objective } from "./types";

interface MetricRemediation {
	patch: Record<string, unknown>;
	reason: string;
	rollback: Record<string, unknown>;
}

/**
 * Built-in remediations keyed by the EXACT metric name registered in
 * `metrics/definitions.ts`. Each remediation's patch and rollback values MUST
 * validate against `config/settings-schema.ts`. The two invariants are enforced
 * by `test/autonomy/planner-correctness.test.ts`.
 */
const BUILTIN_REMEDIATIONS: Record<string, MetricRemediation> = {
	"goal.forceCompleteRate": {
		patch: { "goal.uncertainPolicy": "block-manual" },
		reason:
			"Tighten uncertain-policy so uncertain criteria surface before completion instead of being force-completed.",
		rollback: { "goal.uncertainPolicy": "allow" },
	},
	"verifier.bypassRate": {
		patch: { "task.yield.allowSchemaBypass": false },
		reason: "Reduce verifier bypasses by disabling schema bypass for task yield validation.",
		rollback: { "task.yield.allowSchemaBypass": true },
	},
};

/** Read-only settings surface the planner uses for no-op suppression. */
export type PlannerSettings = Pick<Settings, "get">;

export function planFromMetrics(
	objective: Objective,
	metrics: Record<string, number>,
	opts: { sessionId?: string; settings?: PlannerSettings } = {},
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
		// No-op suppression: if current settings already match the patch, skip.
		if (opts.settings) {
			const stngs = opts.settings;
			const meaningful = Object.entries(remediation.patch).some(([key, value]) => stngs.get(key as any) !== value);
			if (!meaningful) return null;
		}
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

/** Internal accessor used by correctness tests. */
export const __BUILTIN_REMEDIATIONS = BUILTIN_REMEDIATIONS;
