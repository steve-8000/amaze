import type { MemorySourceRef } from "../agi/memory";

export interface SourceVerificationPolicy {
	maxAgeMs?: number;
	now?: number;
}

export interface SourceVerificationIssue {
	ref: MemorySourceRef;
	reason: "missing_uri" | "missing_observed_at" | "missing_content_hash" | "stale" | "future_observation";
}

export interface SourceVerificationResult {
	valid: MemorySourceRef[];
	issues: SourceVerificationIssue[];
}

export function verifySourceRefs(
	refs: readonly MemorySourceRef[],
	policy: SourceVerificationPolicy = {},
): SourceVerificationResult {
	const now = policy.now ?? Date.now();
	const valid: MemorySourceRef[] = [];
	const issues: SourceVerificationIssue[] = [];

	for (const ref of refs) {
		const issue = verifySourceRef(ref, now, policy.maxAgeMs);
		if (issue) {
			issues.push(issue);
		} else {
			valid.push(ref);
		}
	}

	return { valid, issues };
}

export function verifySourceRef(
	ref: MemorySourceRef,
	now = Date.now(),
	maxAgeMs?: number,
): SourceVerificationIssue | undefined {
	if (!ref.uri.trim()) return { ref, reason: "missing_uri" };
	if (ref.observedAt === undefined) return { ref, reason: "missing_observed_at" };
	if (!Number.isFinite(ref.observedAt)) return { ref, reason: "missing_observed_at" };
	if (!ref.contentHash?.trim()) return { ref, reason: "missing_content_hash" };
	if (ref.observedAt > now) return { ref, reason: "future_observation" };
	if (maxAgeMs !== undefined && now - ref.observedAt > maxAgeMs) return { ref, reason: "stale" };
	return undefined;
}
