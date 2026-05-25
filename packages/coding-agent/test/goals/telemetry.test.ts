import { describe, expect, it } from "bun:test";
import { formatV3Stats, V3Telemetry } from "@amaze/coding-agent/mission/core/telemetry";

describe("V3Telemetry — Phase 6 aggregator", () => {
	it("records Design Interview classifications cumulatively", () => {
		const t = new V3Telemetry();
		t.recordDesignInterviewCall("fired");
		t.recordDesignInterviewCall("fired");
		t.recordDesignInterviewCall("already_captured");
		t.recordDesignInterviewCall("no_goal");
		const stats = t.getStats();
		expect(stats.designInterview.totalCalls).toBe(4);
		expect(stats.designInterview.byClassification.fired).toBe(2);
		expect(stats.designInterview.byClassification.already_captured).toBe(1);
		expect(stats.designInterview.byClassification.no_goal).toBe(1);
	});

	it("getStats returns defensive copy (consumer cannot mutate counters)", () => {
		const t = new V3Telemetry();
		t.recordDesignInterviewCall("fired");
		const a = t.getStats();
		// Mutate the returned object.
		a.designInterview.totalCalls = 999;
		a.designInterview.byClassification.fired = 999;
		// Internal state unchanged.
		const b = t.getStats();
		expect(b.designInterview.totalCalls).toBe(1);
		expect(b.designInterview.byClassification.fired).toBe(1);
	});

	it("records closing audit outcomes and surfaces force-rate", () => {
		const t = new V3Telemetry();
		t.recordClosingAudit({ passed: true, forced: false, uncertainCount: 0 });
		t.recordClosingAudit({ passed: true, forced: false, uncertainCount: 1 });
		t.recordClosingAudit({ passed: false, forced: false, uncertainCount: 0 });
		t.recordClosingAudit({ passed: false, forced: true, uncertainCount: 0 });

		const stats = t.getStats();
		expect(stats.closingAudit.totalCompletions).toBe(4);
		expect(stats.closingAudit.passed).toBe(2);
		expect(stats.closingAudit.failed).toBe(1);
		expect(stats.closingAudit.forced).toBe(1);
		expect(stats.closingAudit.uncertainSurfaced).toBe(1);
		expect(t.getForceRate()).toBeCloseTo(0.25, 3);
	});

	it("getForceRate returns null with no completions yet (avoids div-by-zero noise)", () => {
		const t = new V3Telemetry();
		expect(t.getForceRate()).toBeNull();
	});

	it("interview fire-rate excludes no_goal asks from the denominator", () => {
		const t = new V3Telemetry();
		t.recordDesignInterviewCall("no_goal");
		t.recordDesignInterviewCall("no_goal");
		t.recordDesignInterviewCall("fired");
		t.recordDesignInterviewCall("already_captured");
		// 1 fired out of (fired + already_captured) = 1/2 = 0.5; no_goal asks don't dilute it.
		expect(t.getInterviewFireRate()).toBeCloseTo(0.5, 3);
	});

	it("records subagent spawns with vs without contract", () => {
		const t = new V3Telemetry();
		t.recordSubagentSpawn(true);
		t.recordSubagentSpawn(true);
		t.recordSubagentSpawn(false);
		const s = t.getStats().subagent;
		expect(s.totalSpawned).toBe(3);
		expect(s.withContract).toBe(2);
		expect(s.withoutContract).toBe(1);
	});

	it("records verifier results per check type so dashboards can show distribution", () => {
		const t = new V3Telemetry();
		t.recordVerifierResult("scope-include", "pass");
		t.recordVerifierResult("scope-include", "pass");
		t.recordVerifierResult("scope-include", "fail");
		t.recordVerifierResult("command-output", "pass");
		t.recordVerifierResult("manual", "uncertain");

		const cr = t.getStats().verifier.criterionResults;
		expect(cr["scope-include"]).toEqual({ pass: 2, fail: 1, uncertain: 0 });
		expect(cr["command-output"]).toEqual({ pass: 1, fail: 0, uncertain: 0 });
		expect(cr.manual).toEqual({ pass: 0, fail: 0, uncertain: 1 });
	});

	it("formatV3Stats produces a compact human-readable line summary", () => {
		const t = new V3Telemetry();
		t.recordDesignInterviewCall("fired");
		t.recordClosingAudit({ passed: true, forced: false, uncertainCount: 0 });
		t.recordSubagentSpawn(true);
		t.recordVerifierResult("scope-include", "pass");

		const summary = formatV3Stats(t.getStats());
		expect(summary).toContain("Design Interview");
		expect(summary).toContain("Closing audit");
		expect(summary).toContain("Subagents");
		expect(summary).toContain("scope-include: pass=1");
	});

	it("formatV3Stats with no events shows a placeholder, not empty output", () => {
		const summary = formatV3Stats(new V3Telemetry().getStats());
		expect(summary).toContain("no events recorded");
	});
});
