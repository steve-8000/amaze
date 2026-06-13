import { describe, expect, it } from "bun:test";
import { eligibleWorldClaimsForPlanning, isWorldClaimPlanningEligible, type WorldClaim } from "../../src/agi/memory";

function claim(overrides: Partial<WorldClaim> = {}): WorldClaim {
	return {
		id: "claim-1",
		kind: "repo_state",
		claim: "The repo uses Bun tests.",
		status: "verified",
		confidence: "high",
		sourceRefs: [{ kind: "evidence", uri: "evidence://1" }],
		createdAt: 1,
		...overrides,
	};
}

describe("world claim planning eligibility", () => {
	it("accepts current sourced claims", () => {
		expect(isWorldClaimPlanningEligible(claim(), 10)).toBe(true);
	});

	it("rejects expired, superseded, and source-less claims", () => {
		expect(isWorldClaimPlanningEligible(claim({ status: "expired" }), 10)).toBe(false);
		expect(isWorldClaimPlanningEligible(claim({ status: "superseded" }), 10)).toBe(false);
		expect(isWorldClaimPlanningEligible(claim({ expiresAt: 10 }), 10)).toBe(false);
		expect(isWorldClaimPlanningEligible(claim({ sourceRefs: [] }), 10)).toBe(false);
	});

	it("filters an input list without mutating claims", () => {
		const current = claim({ id: "current" });
		const stale = claim({ id: "stale", expiresAt: 5 });
		expect(eligibleWorldClaimsForPlanning([current, stale], 10).map(item => item.id)).toEqual(["current"]);
	});
});
