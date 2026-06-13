import { describe, expect, it } from "bun:test";
import {
	type AgiEvalManifest,
	type AgiEvalSpec,
	REQUIRED_AGI_EVAL_IDS,
	validateAgiEvalManifest,
	validateAgiEvalSpec,
} from "../../src/agi/eval-suite";

function spec(overrides: Partial<AgiEvalSpec> = {}): AgiEvalSpec {
	return {
		id: "tool-policy-adversarial",
		objective: "Gateway blocks unsafe tool calls.",
		dataset: { uri: "evals/agi/tool-policy/v1", version: "v1", fixtureCount: 4 },
		metrics: [{ name: "critical_false_allows", type: "rate", threshold: 0, mandatory: true }],
		evidenceRequired: ["event-ledger", "tool-actions"],
		governance: { riskTier: "medium", oversight: "reviewer", monitoringCadence: "per-run" },
		...overrides,
	};
}

function manifest(overrides: Partial<AgiEvalManifest> = {}): AgiEvalManifest {
	return {
		suiteId: "agi-runtime-substrate-v1",
		claim: "Runtime substrate claim",
		minimumProfile: {
			toolsGatewayPermissionMode: "lease",
			continuation: "explicit-only",
			completionAuthority: "verifier",
			providerMemoryAuthority: false,
		},
		requiredEvals: REQUIRED_AGI_EVAL_IDS.map(id => ({
			id,
			dataset: `evals/agi/${id}/v1`,
			mandatoryBlockers: [`${id}-blocker`],
		})),
		humanCalibration: {
			rubric: "evals/agi/rubrics/runtime-substrate-v1.md",
			minReviewerAgreement: 0.8,
			disagreementResolution: "reviewer_or_operator_override",
		},
		...overrides,
	};
}

describe("AGI eval suite validation", () => {
	it("accepts a complete eval spec and manifest", () => {
		expect(validateAgiEvalSpec(spec())).toEqual({ valid: true });
		expect(validateAgiEvalManifest(manifest())).toEqual({ valid: true });
	});

	it("rejects specs missing dataset, mandatory metrics, evidence, or human calibration", () => {
		const invalid = validateAgiEvalSpec(
			spec({
				dataset: { uri: "", version: "", fixtureCount: 0 },
				metrics: [{ name: "semantic", type: "calibrated-human", threshold: "pass", mandatory: false }],
				evidenceRequired: [],
				governance: { riskTier: "high", oversight: "human-approval", monitoringCadence: "per-run" },
			}),
		);
		expect(invalid.valid).toBe(false);
		if (!invalid.valid) {
			expect(invalid.errors).toContain("tool-policy-adversarial: dataset.uri is required");
			expect(invalid.errors).toContain("tool-policy-adversarial: at least one mandatory metric is required");
			expect(invalid.errors).toContain("tool-policy-adversarial: evidenceRequired is required");
			expect(invalid.errors).toContain(
				"tool-policy-adversarial: humanCalibration is required for semantic/high-risk evals",
			);
		}
	});

	it("rejects manifests missing required evals and strict minimum profile fields", () => {
		const invalid = validateAgiEvalManifest(
			manifest({
				minimumProfile: {
					toolsGatewayPermissionMode: "allow-all" as "lease",
					continuation: "ambient" as "explicit-only",
					completionAuthority: "self-report" as "verifier",
					providerMemoryAuthority: true as false,
				},
				requiredEvals: [],
				humanCalibration: undefined,
			}),
		);
		expect(invalid.valid).toBe(false);
		if (!invalid.valid) {
			expect(invalid.errors).toContain("minimumProfile.toolsGatewayPermissionMode must be lease");
			expect(invalid.errors).toContain("minimumProfile.continuation must be explicit-only");
			expect(invalid.errors).toContain("minimumProfile.completionAuthority must be verifier");
			expect(invalid.errors).toContain("minimumProfile.providerMemoryAuthority must be false");
			expect(invalid.errors).toContain("missing required eval: self-report-rejection");
		}
	});
});
