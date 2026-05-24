/**
 * Durable-write rule (workplan §11.3).
 *
 * Pure predicate only. Decides whether a candidate piece of knowledge may be
 * promoted toward durable memory, and at what authority. No storage, no IO.
 *
 * Rules (§11.3):
 *   - mission intermediate reasoning      → reject (never durable)
 *   - tool result                         → ok as `mission_evidence` (evidence)
 *   - verifier passed                     → ok as verified candidate
 *                                           (`verified_project_decision`)
 *   - critic reviewed                     → ok, durable promotion
 *                                           (`durable_memory`)
 *   - explicit user instruction           → ok as `instruction` memory
 */

import type { Authority } from "./authority-hierarchy";

/** The origin of a candidate memory write. */
export type DurableWriteSource =
	| "mission_intermediate_reasoning"
	| "tool_result"
	| "verifier_passed"
	| "critic_reviewed"
	| "user_instruction";

/** Input to {@link canPromoteToDurable}. */
export interface DurableWriteInput {
	/** Where the candidate knowledge came from. */
	source: DurableWriteSource;
}

/** Result of evaluating the durable-write rule. */
export type DurableWriteDecision =
	| {
			/** Promotion rejected; the candidate must not be written durably. */
			allowed: false;
			reason: string;
	  }
	| {
			/** Promotion allowed; write at the resolved {@link Authority}. */
			allowed: true;
			authority: Authority;
			reason: string;
	  };

/**
 * Evaluate whether a candidate memory may be promoted toward durable storage.
 * Pure function — deterministic in its input, no side effects.
 */
export function canPromoteToDurable(input: DurableWriteInput): DurableWriteDecision {
	switch (input.source) {
		case "mission_intermediate_reasoning":
			return {
				allowed: false,
				reason: "Mission intermediate reasoning is transient and must never be promoted to durable memory.",
			};
		case "tool_result":
			return {
				allowed: true,
				authority: "mission_evidence",
				reason: "Tool result is admissible as mission evidence.",
			};
		case "verifier_passed":
			return {
				allowed: true,
				authority: "verified_project_decision",
				reason: "Verifier passed; admissible as a verified candidate decision.",
			};
		case "critic_reviewed":
			return {
				allowed: true,
				authority: "durable_memory",
				reason: "Critic-reviewed knowledge may be promoted to durable memory.",
			};
		case "user_instruction":
			return {
				allowed: true,
				authority: "instruction",
				reason: "Explicit user instruction is recorded as instruction-authority memory.",
			};
		default: {
			// Exhaustiveness guard: a new source must extend this switch.
			const _exhaustive: never = input.source;
			return {
				allowed: false,
				reason: `Unknown durable-write source: ${String(_exhaustive)}`,
			};
		}
	}
}
