/**
 * Memory authority hierarchy (workplan §11.1).
 *
 * Pure types + ordering only. No storage wiring.
 *
 * Authority encodes how much weight a memory carries when it conflicts with
 * another. Higher-authority sources override lower ones during recall and
 * curation. A higher rank value means higher authority.
 *
 * Ordering (highest → lowest):
 *   instruction
 *     > repo_truth
 *     > mission_evidence
 *     > session_context
 *     > verified_project_decision
 *     > durable_memory
 *     > historical_summary
 *
 * `repo_truth` deliberately outranks `durable_memory` (durable guidance): a
 * stored convention must never override what the repository actually contains.
 */

/** The authority levels, ordered highest → lowest. */
export const AUTHORITY_LEVELS = [
	"instruction",
	"repo_truth",
	"mission_evidence",
	"session_context",
	"verified_project_decision",
	"durable_memory",
	"historical_summary",
] as const;

/** An authority level. */
export type Authority = (typeof AUTHORITY_LEVELS)[number];

/**
 * Rank table. Higher number = higher authority. Derived from
 * {@link AUTHORITY_LEVELS} so the two can never drift apart.
 */
const AUTHORITY_RANK: Readonly<Record<Authority, number>> = (() => {
	const last = AUTHORITY_LEVELS.length - 1;
	const table = {} as Record<Authority, number>;
	for (let i = 0; i < AUTHORITY_LEVELS.length; i++) {
		// First element (highest authority) gets the largest rank.
		table[AUTHORITY_LEVELS[i]] = last - i;
	}
	return table;
})();

/**
 * Numeric rank for an authority level. Higher = more authoritative.
 * `instruction` is the maximum, `historical_summary` is the minimum (0).
 */
export function rankAuthority(authority: Authority): number {
	return AUTHORITY_RANK[authority];
}

/**
 * Comparator: returns positive when `a` outranks `b`, negative when `b`
 * outranks `a`, and 0 when equal. Sorting an array with this yields
 * ascending authority; reverse it for highest-first.
 */
export function compareAuthority(a: Authority, b: Authority): number {
	return rankAuthority(a) - rankAuthority(b);
}

/** True when `a` is strictly more authoritative than `b`. */
export function isMoreAuthoritative(a: Authority, b: Authority): boolean {
	return rankAuthority(a) > rankAuthority(b);
}

/** Type guard for a value being a known {@link Authority}. */
export function isAuthority(value: unknown): value is Authority {
	return typeof value === "string" && (AUTHORITY_LEVELS as readonly string[]).includes(value);
}
