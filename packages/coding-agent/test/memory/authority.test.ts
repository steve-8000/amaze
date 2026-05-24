import { describe, expect, test } from "bun:test";
import {
	AUTHORITY_LEVELS,
	type Authority,
	canPromoteToDurable,
	compareAuthority,
	isAuthority,
	isMoreAuthoritative,
	rankAuthority,
} from "../../src/memory/authority";

describe("authority hierarchy (§11.1)", () => {
	test("ranks highest → lowest in declared order", () => {
		const ranks = AUTHORITY_LEVELS.map(rankAuthority);
		for (let i = 1; i < ranks.length; i++) {
			expect(ranks[i - 1]).toBeGreaterThan(ranks[i]);
		}
	});

	test("instruction is the highest authority", () => {
		for (const level of AUTHORITY_LEVELS) {
			if (level === "instruction") continue;
			expect(isMoreAuthoritative("instruction", level)).toBe(true);
		}
	});

	test("historical_summary is the lowest authority (rank 0)", () => {
		expect(rankAuthority("historical_summary")).toBe(0);
	});

	test("repo_truth outranks durable guidance (durable_memory)", () => {
		expect(isMoreAuthoritative("repo_truth", "durable_memory")).toBe(true);
		expect(rankAuthority("repo_truth")).toBeGreaterThan(rankAuthority("durable_memory"));
		expect(compareAuthority("repo_truth", "durable_memory")).toBeGreaterThan(0);
	});

	test("full ordering: instruction > repo_truth > mission_evidence > session_context > verified_project_decision > durable_memory > historical_summary", () => {
		const expected: Authority[] = [
			"instruction",
			"repo_truth",
			"mission_evidence",
			"session_context",
			"verified_project_decision",
			"durable_memory",
			"historical_summary",
		];
		// Sort a shuffled copy ascending, then reverse → should match highest-first.
		const shuffled = [...expected].reverse();
		const sortedHighestFirst = [...shuffled].sort(compareAuthority).reverse();
		expect(sortedHighestFirst).toEqual(expected);
	});

	test("compareAuthority is a consistent comparator", () => {
		expect(compareAuthority("instruction", "instruction")).toBe(0);
		expect(compareAuthority("durable_memory", "repo_truth")).toBeLessThan(0);
	});

	test("isAuthority guards unknown values", () => {
		expect(isAuthority("repo_truth")).toBe(true);
		expect(isAuthority("not_a_level")).toBe(false);
		expect(isAuthority(42)).toBe(false);
		expect(isAuthority(undefined)).toBe(false);
	});
});

describe("durable-write rule (§11.3)", () => {
	test("mission intermediate reasoning is rejected", () => {
		const decision = canPromoteToDurable({ source: "mission_intermediate_reasoning" });
		expect(decision.allowed).toBe(false);
	});

	test("tool result is admissible as mission evidence", () => {
		const decision = canPromoteToDurable({ source: "tool_result" });
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.authority).toBe("mission_evidence");
		}
	});

	test("verifier passed yields a verified candidate decision", () => {
		const decision = canPromoteToDurable({ source: "verifier_passed" });
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.authority).toBe("verified_project_decision");
		}
	});

	test("critic reviewed yields durable promotion", () => {
		const decision = canPromoteToDurable({ source: "critic_reviewed" });
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.authority).toBe("durable_memory");
		}
	});

	test("explicit user instruction yields instruction memory", () => {
		const decision = canPromoteToDurable({ source: "user_instruction" });
		expect(decision.allowed).toBe(true);
		if (decision.allowed) {
			expect(decision.authority).toBe("instruction");
		}
	});

	test("every allowed promotion resolves to a known authority", () => {
		for (const source of ["tool_result", "verifier_passed", "critic_reviewed", "user_instruction"] as const) {
			const decision = canPromoteToDurable({ source });
			expect(decision.allowed).toBe(true);
			if (decision.allowed) {
				expect(isAuthority(decision.authority)).toBe(true);
			}
		}
	});
});
