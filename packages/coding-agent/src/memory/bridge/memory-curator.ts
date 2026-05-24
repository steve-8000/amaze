/**
 * Memory curator (workplan Lane J / §11.3, §15.5).
 *
 * The WRITE side. Sits between mission/consolidation and the durable-write
 * chokepoints (`NexusStore.add` / `importSource` / `replace` / `remove`, per
 * `docs/refactor/03-memory-call-sites.md §5`) and gates every promotion through
 * Lane D's pure {@link canPromoteToDurable} rule:
 *
 *   - mission intermediate reasoning → rejected (never durable)
 *   - tool result                    → mission evidence
 *   - verifier passed                → verified project decision
 *   - critic reviewed                → durable memory
 *   - explicit user instruction      → instruction
 *
 * The curator owns no storage. It evaluates a candidate and, only when allowed,
 * runs an injected `commit` callback (which performs the real durable write).
 * This keeps it additive and opt-in: existing call paths that never route
 * through the curator are unchanged. A runtime that wants the §15.5 guarantee —
 * "reject durable writes that bypass the curator" — wraps the chokepoints so
 * they only fire via {@link MemoryCurator.write}.
 */

import { type Authority, canPromoteToDurable, type DurableWriteDecision, type DurableWriteSource } from "../authority";

/** A candidate durable write submitted to the curator. */
export interface DurableWriteCandidate<T> {
	/** Where the knowledge came from — drives the promotion decision. */
	source: DurableWriteSource;
	/** Opaque payload handed to `commit` when the write is allowed. */
	payload: T;
}

/** Result of a curated write attempt. */
export type CuratedWriteResult<R> =
	| {
			allowed: false;
			/** The Lane D rejection reason. */
			reason: string;
			decision: Extract<DurableWriteDecision, { allowed: false }>;
	  }
	| {
			allowed: true;
			/** Authority the entry was promoted at. */
			authority: Authority;
			reason: string;
			decision: Extract<DurableWriteDecision, { allowed: true }>;
			/** Whatever the `commit` callback returned. */
			result: R;
	  };

/**
 * Performs the actual durable write once the curator approves. Receives the
 * resolved authority so it can stamp provenance / mission evidence.
 */
export type CommitFn<T, R> = (payload: T, authority: Authority) => R;

export interface MemoryCuratorOptions {
	/** Mission whose evidence the curator is gating, when scoped to one. */
	missionId?: string;
}

/**
 * Durable-write gate. Stateless apart from optional mission scoping; the actual
 * persistence lives in the injected {@link CommitFn}.
 */
export class MemoryCurator {
	readonly missionId?: string;

	constructor(options: MemoryCuratorOptions = {}) {
		this.missionId = options.missionId;
	}

	/**
	 * Evaluate a candidate without committing. Pure delegation to Lane D's rule
	 * — useful for callers that want to inspect the decision first.
	 */
	evaluate(source: DurableWriteSource): DurableWriteDecision {
		return canPromoteToDurable({ source });
	}

	/**
	 * Gate a durable write. Runs `commit` only when {@link canPromoteToDurable}
	 * allows promotion; otherwise rejects without side effects. Mission
	 * intermediate reasoning is always rejected.
	 */
	write<T, R>(candidate: DurableWriteCandidate<T>, commit: CommitFn<T, R>): CuratedWriteResult<R> {
		const decision = canPromoteToDurable({ source: candidate.source });
		if (!decision.allowed) {
			return { allowed: false, reason: decision.reason, decision };
		}
		const result = commit(candidate.payload, decision.authority);
		return {
			allowed: true,
			authority: decision.authority,
			reason: decision.reason,
			decision,
			result,
		};
	}

	/**
	 * True when a write from `source` may reach durable storage. Thin sugar over
	 * {@link evaluate} for guard-style call sites.
	 */
	approves(source: DurableWriteSource): boolean {
		return canPromoteToDurable({ source }).allowed;
	}
}
