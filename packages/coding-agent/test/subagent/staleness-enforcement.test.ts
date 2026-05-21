/**
 * V3 T4-H — structural stale-contract enforcement proof.
 *
 * Verifies the two pieces of the stale-contract enforcement layer:
 *   - `stampContractRevision`: auto-stamps parent revision onto a contract at issuance,
 *     idempotent (preserves explicit baseline).
 *   - `enforceContractFreshness`: throws `StaleContractError` when parent has advanced past
 *     the stamped baseline; silent on fresh, missing data, or no contract.
 *
 * Together these make staleness detection STRUCTURAL: parent stamps at spawn, subagent (or
 * any turn-start hook) calls enforce, mismatch fails fast with a structured exception.
 */

import { describe, expect, it } from "bun:test";
import {
	enforceContractFreshness,
	StaleContractError,
	type SubagentContract,
	stampContractRevision,
} from "@amaze/coding-agent/subagent/contract";

const blank = (overrides: Partial<SubagentContract> = {}): SubagentContract => ({
	role: "refactor-applier",
	scope: { include: [], exclude: [] },
	successCriteria: [],
	escalation: { onUncertainty: "ask-parent", budgetCap: 1000 },
	...overrides,
});

describe("stampContractRevision", () => {
	it("stamps current parent revision when contract baseline is missing", () => {
		const contract = blank();
		const stamped = stampContractRevision(contract, 5);
		expect(stamped.parentContractRevision).toBe(5);
		// Input not mutated (functional invariant).
		expect(contract.parentContractRevision).toBeUndefined();
	});

	it("preserves explicit baseline (idempotent — does not overwrite)", () => {
		const contract = blank({ parentContractRevision: 3 });
		const stamped = stampContractRevision(contract, 7);
		expect(stamped.parentContractRevision).toBe(3);
	});

	it("no-op when parent revision is undefined", () => {
		const contract = blank();
		const stamped = stampContractRevision(contract, undefined);
		expect(stamped).toBe(contract); // same reference: cheap when no-op
	});
});

describe("enforceContractFreshness", () => {
	it("throws StaleContractError when parent revision exceeds baseline", () => {
		const contract = blank({ parentContractRevision: 2 });
		expect(() => enforceContractFreshness(contract, 3)).toThrow(StaleContractError);
		try {
			enforceContractFreshness(contract, 3);
		} catch (err) {
			expect(err).toBeInstanceOf(StaleContractError);
			const stale = err as StaleContractError;
			expect(stale.baselineRevision).toBe(2);
			expect(stale.parentRevision).toBe(3);
			expect(stale.role).toBe("refactor-applier");
			expect(stale.message).toContain("stale");
			expect(stale.message).toContain("revision 2 to 3");
		}
	});

	it("silent when revisions match (equality is fresh, not stale)", () => {
		const contract = blank({ parentContractRevision: 5 });
		expect(() => enforceContractFreshness(contract, 5)).not.toThrow();
	});

	it("silent when parent is older than baseline (nonsense direction, treat as fresh)", () => {
		const contract = blank({ parentContractRevision: 5 });
		expect(() => enforceContractFreshness(contract, 2)).not.toThrow();
	});

	it("silent when contract has no baseline (back-compat path)", () => {
		const contract = blank();
		expect(() => enforceContractFreshness(contract, 99)).not.toThrow();
	});

	it("silent when parent revision is undefined (no comparison possible)", () => {
		const contract = blank({ parentContractRevision: 1 });
		expect(() => enforceContractFreshness(contract, undefined)).not.toThrow();
	});

	it("silent when contract itself is undefined (no-op path for contract-less sessions)", () => {
		expect(() => enforceContractFreshness(undefined, 5)).not.toThrow();
	});

	it("PHASE T4-H ACCEPTANCE: stale detection is STRUCTURAL — same input twice produces same exception", () => {
		const contract = blank({ parentContractRevision: 1 });
		let err1: unknown;
		let err2: unknown;
		try {
			enforceContractFreshness(contract, 2);
		} catch (e) {
			err1 = e;
		}
		try {
			enforceContractFreshness(contract, 2);
		} catch (e) {
			err2 = e;
		}
		expect(err1).toBeInstanceOf(StaleContractError);
		expect(err2).toBeInstanceOf(StaleContractError);
		const e1 = err1 as StaleContractError;
		const e2 = err2 as StaleContractError;
		// Same role, baseline, parent revision → same surface. Deterministic.
		expect(e1.role).toBe(e2.role);
		expect(e1.baselineRevision).toBe(e2.baselineRevision);
		expect(e1.parentRevision).toBe(e2.parentRevision);
	});
});
