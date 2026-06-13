export const REQUIRED_AGI_EVAL_IDS = [
	"self-report-rejection",
	"restart-recovery",
	"long-horizon-repo-task",
	"tool-policy-adversarial",
	"memory-transfer",
	"self-improvement",
	"ambiguous-external-objective",
] as const;

export type AgiEvalId = (typeof REQUIRED_AGI_EVAL_IDS)[number];

export interface AgiEvalSpec {
	id: AgiEvalId;
	objective: string;
	dataset: {
		uri: string;
		version: string;
		fixtureCount: number;
		goldLabels?: string;
	};
	metrics: Array<{
		name: string;
		type: "binary" | "rate" | "latency" | "coverage" | "calibrated-human";
		threshold: number | string;
		mandatory: boolean;
	}>;
	evidenceRequired: Array<
		"mission-store" | "event-ledger" | "tool-actions" | "verifier" | "diff" | "citations" | "human-review"
	>;
	humanCalibration?: {
		rubricUri: string;
		goldSetUri: string;
		minAgreement: number;
		escalation: "ask-user" | "reviewer" | "security" | "sre";
	};
	governance: {
		riskTier: "low" | "medium" | "high" | "critical";
		oversight: "none" | "reviewer" | "human-approval" | "operator-stop-required";
		monitoringCadence: "per-run" | "daily" | "release";
	};
}

export interface AgiEvalRunResult {
	specId: AgiEvalId;
	datasetVersion: string;
	passed: boolean;
	metricResults: Record<string, { value: number | string; passed: boolean; evidenceRefs: string[] }>;
	blockers: string[];
	humanReviewRefs: string[];
	createdAt: number;
}

export interface AgiEvalManifest {
	suiteId: string;
	claim: string;
	minimumProfile: {
		toolsGatewayPermissionMode: "lease";
		continuation: "explicit-only";
		completionAuthority: "verifier";
		providerMemoryAuthority: false;
	};
	requiredEvals: Array<{
		id: AgiEvalId;
		dataset: string;
		mandatoryBlockers: string[];
	}>;
	humanCalibration?: {
		rubric: string;
		minReviewerAgreement: number;
		disagreementResolution: string;
	};
	monitoring?: {
		rerunOn: string[];
	};
}

export type AgiEvalValidationResult = { valid: true } | { valid: false; errors: string[] };

function hasText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function pushIf(condition: boolean, errors: string[], message: string): void {
	if (condition) errors.push(message);
}

export function requiresHumanCalibration(spec: AgiEvalSpec): boolean {
	return (
		spec.governance.riskTier === "high" ||
		spec.governance.riskTier === "critical" ||
		spec.metrics.some(m => m.type === "calibrated-human")
	);
}

export function validateAgiEvalSpec(spec: AgiEvalSpec): AgiEvalValidationResult {
	const errors: string[] = [];
	pushIf(!REQUIRED_AGI_EVAL_IDS.includes(spec.id), errors, `unknown eval id: ${spec.id}`);
	pushIf(!hasText(spec.objective), errors, `${spec.id}: objective is required`);
	pushIf(!hasText(spec.dataset.uri), errors, `${spec.id}: dataset.uri is required`);
	pushIf(!hasText(spec.dataset.version), errors, `${spec.id}: dataset.version is required`);
	pushIf(
		!Number.isFinite(spec.dataset.fixtureCount) || spec.dataset.fixtureCount <= 0,
		errors,
		`${spec.id}: dataset.fixtureCount must be positive`,
	);
	pushIf(spec.metrics.length === 0, errors, `${spec.id}: at least one metric is required`);
	pushIf(
		!spec.metrics.some(metric => metric.mandatory),
		errors,
		`${spec.id}: at least one mandatory metric is required`,
	);
	for (const metric of spec.metrics) {
		pushIf(!hasText(metric.name), errors, `${spec.id}: metric name is required`);
		pushIf(metric.threshold === "", errors, `${spec.id}: metric ${metric.name} threshold is required`);
	}
	pushIf(spec.evidenceRequired.length === 0, errors, `${spec.id}: evidenceRequired is required`);
	if (requiresHumanCalibration(spec)) {
		const calibration = spec.humanCalibration;
		pushIf(!calibration, errors, `${spec.id}: humanCalibration is required for semantic/high-risk evals`);
		if (calibration) {
			pushIf(!hasText(calibration.rubricUri), errors, `${spec.id}: humanCalibration.rubricUri is required`);
			pushIf(!hasText(calibration.goldSetUri), errors, `${spec.id}: humanCalibration.goldSetUri is required`);
			pushIf(
				calibration.minAgreement <= 0 || calibration.minAgreement > 1,
				errors,
				`${spec.id}: humanCalibration.minAgreement must be in (0, 1]`,
			);
		}
	}
	return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateAgiEvalManifest(manifest: AgiEvalManifest): AgiEvalValidationResult {
	const errors: string[] = [];
	pushIf(!hasText(manifest.suiteId), errors, "suiteId is required");
	pushIf(!hasText(manifest.claim), errors, "claim is required");
	const profile = manifest.minimumProfile;
	pushIf(
		profile.toolsGatewayPermissionMode !== "lease",
		errors,
		"minimumProfile.toolsGatewayPermissionMode must be lease",
	);
	pushIf(profile.continuation !== "explicit-only", errors, "minimumProfile.continuation must be explicit-only");
	pushIf(profile.completionAuthority !== "verifier", errors, "minimumProfile.completionAuthority must be verifier");
	pushIf(profile.providerMemoryAuthority !== false, errors, "minimumProfile.providerMemoryAuthority must be false");

	const entriesById = new Map(manifest.requiredEvals.map(entry => [entry.id, entry]));
	for (const id of REQUIRED_AGI_EVAL_IDS) {
		if (!entriesById.has(id)) errors.push(`missing required eval: ${id}`);
	}
	for (const entry of manifest.requiredEvals) {
		pushIf(!REQUIRED_AGI_EVAL_IDS.includes(entry.id), errors, `unknown required eval: ${entry.id}`);
		pushIf(!hasText(entry.dataset), errors, `${entry.id}: dataset is required`);
		pushIf(entry.mandatoryBlockers.length === 0, errors, `${entry.id}: mandatoryBlockers are required`);
	}
	const semanticOrRisky =
		entriesById.has("long-horizon-repo-task") ||
		entriesById.has("self-improvement") ||
		entriesById.has("ambiguous-external-objective");
	if (semanticOrRisky) {
		const calibration = manifest.humanCalibration;
		pushIf(!calibration, errors, "humanCalibration is required for semantic/high-risk suite evals");
		if (calibration) {
			pushIf(!hasText(calibration.rubric), errors, "humanCalibration.rubric is required");
			pushIf(
				calibration.minReviewerAgreement <= 0 || calibration.minReviewerAgreement > 1,
				errors,
				"humanCalibration.minReviewerAgreement must be in (0, 1]",
			);
			pushIf(
				!hasText(calibration.disagreementResolution),
				errors,
				"humanCalibration.disagreementResolution is required",
			);
		}
	}
	return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
