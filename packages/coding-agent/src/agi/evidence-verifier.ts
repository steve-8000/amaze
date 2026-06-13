import type { MissionStore } from "../mission/store";
import type { RuntimeEvent } from "../mission/types";
import type { AgiGatewayStore, AgiMonitoredSession, AgiStructuredResult } from "./store";

export type EvidenceKind =
	| "source_diff"
	| "test_output"
	| "review_finding"
	| "browser_trace"
	| "runtime_metric"
	| "citation"
	| "deployment_health"
	| "security_scan"
	| (string & {});

export type EvidenceVerificationStatus = "pass" | "fail" | "insufficient_evidence";

export interface EvidenceRequirement {
	criterionId: string;
	description: string;
	required: boolean;
	evidenceKinds: EvidenceKind[];
}

export interface EvidenceVerificationResult {
	missionId: string;
	objectiveContractId?: string;
	status: EvidenceVerificationStatus;
	criteria: Array<{
		criterionId: string;
		status: EvidenceVerificationStatus;
		evidenceRefs: string[];
		reason?: string;
	}>;
	checkedAt: number;
}

export interface MissionEvidenceVerifier {
	verifyMission(input: {
		missionId: string;
		objectiveContractId?: string;
		requirements: EvidenceRequirement[];
	}): Promise<EvidenceVerificationResult>;
}

export interface EvidenceVerifierOptions {
	missionStore?: MissionStore;
	gatewayStore?: AgiGatewayStore;
	computeArtifactHash?: (uri: string) => string | undefined;
	now?: () => number;
}

export interface EvidenceVerificationSource {
	type: "mission-verification" | "test-output" | "tool-completed" | "artifact-hash";
	ref: string;
}

/**
 * Completion verifier for AGI control sessions.
 *
 * Agent self-report is intentionally ignored. A completion claim is accepted only
 * when every mission criterion has a matching non-agent evidence source and the
 * session has at least one durable execution signal: mission verification,
 * test output, a completed tool event, or an artifact hash.
 */
export class EvidenceVerifier implements MissionEvidenceVerifier {
	readonly #missionStore: MissionStore | undefined;
	readonly #gatewayStore: AgiGatewayStore | undefined;
	readonly #computeArtifactHash: ((uri: string) => string | undefined) | undefined;
	readonly #now: () => number;

	constructor(options: EvidenceVerifierOptions = {}) {
		this.#missionStore = options.missionStore;
		this.#gatewayStore = options.gatewayStore;
		this.#computeArtifactHash = options.computeArtifactHash;
		this.#now = options.now ?? Date.now;
	}

	async verify(session: AgiMonitoredSession, claim: AgiStructuredResult): Promise<boolean> {
		if (!claim.complete) return false;
		if (!session.missionId || !session.objective || session.criteria.length === 0) return false;

		const requirements = session.criteria.map((criterion, index) => ({
			criterionId:
				session.goalSpec.criteria.find(item => item.description === criterion)?.id ?? `criterion-${index + 1}`,
			description: criterion,
			required: true,
			evidenceKinds: ["test_output", "review_finding"] as EvidenceKind[],
		}));
		const result = await this.verifyMission({
			missionId: session.missionId,
			objectiveContractId: session.objectiveContractId,
			requirements,
		});
		return result.status === "pass";
	}

	async verifyMission(input: {
		missionId: string;
		objectiveContractId?: string;
		requirements: EvidenceRequirement[];
	}): Promise<EvidenceVerificationResult> {
		const checkedAt = this.#now();
		const criteria = input.requirements
			.filter(requirement => requirement.required)
			.map(requirement => this.#verifyRequirement(input.missionId, requirement));
		const status = criteria.some(criterion => criterion.status === "fail")
			? "fail"
			: criteria.every(criterion => criterion.status === "pass")
				? "pass"
				: "insufficient_evidence";
		const result: EvidenceVerificationResult = {
			missionId: input.missionId,
			...(input.objectiveContractId ? { objectiveContractId: input.objectiveContractId } : {}),
			status,
			criteria,
			checkedAt,
		};
		this.#missionStore?.appendRuntimeEvent({
			missionId: input.missionId,
			streamId: `evidence:${input.missionId}`,
			type: "evidence.verified",
			actor: "agi.evidence-verifier",
			payload: result as unknown as Record<string, unknown>,
			evidenceRefs: criteria.flatMap(criterion => criterion.evidenceRefs),
			idempotencyKey: `evidence:${input.objectiveContractId ?? "mission"}:${checkedAt}`,
		});
		return result;
	}

	collectSources(session: AgiMonitoredSession): EvidenceVerificationSource[] {
		const sources: EvidenceVerificationSource[] = [];
		const evidenceRefs = new Set(session.evidenceRefs);

		for (const ref of evidenceRefs) {
			if (isTestOutputRef(ref)) sources.push({ type: "test-output", ref });
			if (isArtifactHashRef(ref, this.#computeArtifactHash)) sources.push({ type: "artifact-hash", ref });
			if (isMissionVerificationRef(ref)) sources.push({ type: "mission-verification", ref });
		}

		if (session.missionId && this.#missionStore) {
			const latestVerification = this.#missionStore.getLatestVerification(session.missionId);
			if (latestVerification?.status === "pass" || latestVerification?.status === "force") {
				sources.push({ type: "mission-verification", ref: latestVerification.id });
			}
			for (const event of this.#missionStore.listRuntimeEvents(session.missionId)) {
				if (event.type === "mission.tool.completed" || event.type === "tool.completed") {
					sources.push({ type: "tool-completed", ref: event.id });
				}
				for (const ref of event.evidenceRefs) {
					if (isTestOutputRef(ref)) sources.push({ type: "test-output", ref });
					if (isArtifactHashRef(ref, this.#computeArtifactHash)) sources.push({ type: "artifact-hash", ref });
				}
			}
		}

		if (this.#gatewayStore) {
			for (const event of this.#gatewayStore.listEvents(session.sessionId)) {
				if (
					event.type === "mission.tool.completed" ||
					event.type === "tool.completed" ||
					event.type === "action.completed"
				) {
					sources.push({ type: "tool-completed", ref: event.id });
				}
			}
		}

		return dedupeSources(sources);
	}

	#verifyRequirement(
		missionId: string,
		requirement: EvidenceRequirement,
	): EvidenceVerificationResult["criteria"][number] {
		const refs: string[] = [];
		let sawInsufficientSource = false;
		for (const kind of requirement.evidenceKinds) {
			const source = this.#verifyEvidenceKind(missionId, kind);
			refs.push(...source.refs);
			if (source.status === "fail") {
				return {
					criterionId: requirement.criterionId,
					status: "fail",
					evidenceRefs: dedupe(refs),
					reason: source.reason,
				};
			}
			if (source.status === "pass") {
				return { criterionId: requirement.criterionId, status: "pass", evidenceRefs: dedupe(refs) };
			}
			sawInsufficientSource = true;
		}
		return {
			criterionId: requirement.criterionId,
			status: "insufficient_evidence",
			evidenceRefs: dedupe(refs),
			reason: sawInsufficientSource ? "required evidence source did not pass" : "no required evidence kinds",
		};
	}

	#verifyEvidenceKind(
		missionId: string,
		kind: EvidenceKind,
	): { status: EvidenceVerificationStatus; refs: string[]; reason?: string } {
		if (!this.#missionStore)
			return { status: "insufficient_evidence", refs: [], reason: "mission store unavailable" };
		const events = this.#missionStore.listRuntimeEvents(missionId);
		switch (kind) {
			case "test_output": {
				const refs = testOutputRefs(events);
				if (refs.length > 0) return { status: "pass", refs };
				const latest = this.#missionStore.getLatestVerification(missionId);
				if (latest?.status === "pass" || latest?.status === "force") {
					return { status: "pass", refs: [`mission-verification:${latest.id}`] };
				}
				if (latest?.status === "fail") return { status: "fail", refs: [`mission-verification:${latest.id}`] };
				return { status: "insufficient_evidence", refs: [] };
			}
			case "review_finding": {
				const latest = this.#missionStore.getLatestReview(missionId);
				if (!latest) return { status: "insufficient_evidence", refs: [] };
				const ref = `mission-review:${latest.id}`;
				if (latest.verdict === "pass" || latest.failedCount === 0) return { status: "pass", refs: [ref] };
				return { status: "fail", refs: [ref], reason: latest.summary };
			}
			case "source_diff":
				return eventEvidence(events, ["runtime_action.completed", "sandbox.diff_captured"], "diffRef");
			case "browser_trace":
				return eventEvidence(events, ["browser.trace", "browser_trace.captured"], "traceRef");
			case "runtime_metric":
				return eventEvidence(events, ["runtime.metric", "runtime_metric"], "passed");
			case "citation":
				return eventEvidence(events, ["citation.recorded", "memory.source"], "uri");
			case "deployment_health":
				return eventEvidence(events, ["deployment.health", "deployment_health"], "passed");
			case "security_scan": {
				const security = eventEvidence(events, ["security.scan", "security_scan"], "passed");
				if (security.status !== "pass") return security;
				const failed = events.find(
					event => ["security.scan", "security_scan"].includes(event.type) && event.payload?.passed === false,
				);
				return failed ? { status: "fail", refs: [failed.id], reason: "security scan reported failure" } : security;
			}
			default:
				return { status: "insufficient_evidence", refs: [], reason: `unsupported evidence kind: ${kind}` };
		}
	}
}

export function createEvidenceAgiCompletionVerifier(verifier: MissionEvidenceVerifier) {
	return async (session: AgiMonitoredSession, claim: AgiStructuredResult): Promise<boolean> => {
		if (!claim.complete) return false;
		if (!session.missionId) return false;
		const result = await verifier.verifyMission({
			missionId: session.missionId,
			objectiveContractId: session.objectiveContractId,
			requirements: session.criteria.map((criterion, index) => ({
				criterionId:
					session.goalSpec.criteria.find(item => item.description === criterion)?.id ?? `criterion-${index + 1}`,
				description: criterion,
				required: true,
				evidenceKinds: ["test_output", "review_finding"],
			})),
		});
		return result.status === "pass";
	};
}

export function createEvidenceCompletionVerifier(options: EvidenceVerifierOptions = {}) {
	return createEvidenceAgiCompletionVerifier(new EvidenceVerifier(options));
}

function isMissionVerificationRef(ref: string): boolean {
	return (
		ref.startsWith("mission-verification:") || ref.startsWith("verification:") || ref.startsWith("verification://")
	);
}

function isTestOutputRef(ref: string): boolean {
	return ref.startsWith("test-output:") || ref.startsWith("test://") || ref.includes("test-output");
}

function isArtifactHashRef(ref: string, computeArtifactHash?: (uri: string) => string | undefined): boolean {
	if (ref.startsWith("artifact-hash:") || ref.startsWith("sha256:")) return true;
	if (!ref.startsWith("artifact://") || !computeArtifactHash) return false;
	const hash = computeArtifactHash(ref);
	return typeof hash === "string" && hash.length > 0;
}

function testOutputRefs(events: RuntimeEvent[]): string[] {
	return events.flatMap(event => {
		const refs = event.evidenceRefs.filter(isTestOutputRef);
		if (refs.length > 0) return refs;
		if (
			(event.type === "test.completed" || event.type === "test_output") &&
			(event.payload.exitCode === 0 || event.payload.passed === true || event.payload.verdict === "pass")
		) {
			return [event.id];
		}
		return [];
	});
}

function eventEvidence(
	events: RuntimeEvent[],
	types: string[],
	payloadKey: string,
): { status: EvidenceVerificationStatus; refs: string[]; reason?: string } {
	const matching = events.filter(event => types.includes(event.type));
	const passed = matching.filter(event => Boolean(event.payload?.[payloadKey]) || event.payload?.passed === true);
	if (passed.length > 0) return { status: "pass", refs: passed.map(event => event.id) };
	return { status: "insufficient_evidence", refs: matching.map(event => event.id) };
}

function dedupeSources(sources: EvidenceVerificationSource[]): EvidenceVerificationSource[] {
	const seen = new Set<string>();
	return sources.filter(source => {
		const key = `${source.type}:${source.ref}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}
