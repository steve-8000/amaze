import { describe, expect, it } from "bun:test";
import type { Mission } from "@amaze/coding-agent/mission/core/mission";
import type { MissionControlRuntime } from "@amaze/coding-agent/mission/core/mission-control-runtime";
import { MissionPolicyGate } from "@amaze/coding-agent/tools/gateway/index";
import type { ToolDescriptor } from "@amaze/coding-agent/tools/registry/index";

function descriptor(name: string): ToolDescriptor {
	return {
		name,
		toolClass: "legacy",
		domain: name === "read" ? "search" : "filesystem",
		riskLevel: name === "read" ? "LOW" : "HIGH",
		mutatesWorkspace: name !== "read",
		requiresApproval: false,
		supportsRollback: name !== "read",
		execute: async () => ({ ok: true, output: undefined }),
	};
}

function mission(overrides: Partial<Mission>): Mission {
	return {
		id: "m1",
		title: "Mission",
		objective: "Objective",
		mode: "auto",
		lifecycle: "executing",
		riskLevel: "medium",
		intent: "code_change",
		constraints: [],
		acceptanceCriteria: [],
		budget: { tokenBudget: 0, tokensUsed: 0 },
		contextBudget: { maxContextTokens: 0, contextTokensUsed: 0 },
		tasks: [],
		evidenceRefs: [],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function gate(active: Mission | undefined): MissionPolicyGate {
	return new MissionPolicyGate({
		missionControl: { getActiveMission: () => active } as MissionControlRuntime,
	});
}

describe("MissionPolicyGate", () => {
	it("allows non-mutation tools without an active mission", () => {
		const decision = gate(undefined).check(descriptor("read"), {}, "LOW");
		expect(decision.allowed).toBe(true);
	});

	it("denies mutation tools without an active mission", () => {
		const decision = gate(undefined).check(descriptor("write"), {}, "HIGH");
		expect(decision).toMatchObject({ allowed: false, code: "PROMOTE_REQUIRED", reason: "mission-required" });
	});

	it("allows code_change mutations in executing lifecycle", () => {
		const decision = gate(mission({ intent: "code_change", lifecycle: "executing" })).check(
			descriptor("write"),
			{},
			"HIGH",
		);
		expect(decision.allowed).toBe(true);
	});

	it("denies architecture_change mutations before execution without a proposal", () => {
		const decision = gate(mission({ intent: "architecture_change", lifecycle: "classified" })).check(
			descriptor("write"),
			{},
			"HIGH",
		);
		expect(decision).toMatchObject({ allowed: false, code: "PROPOSAL_REQUIRED", reason: "proposal-required" });
	});

	it("allows architecture_change mutations before execution with a proposal", () => {
		const decision = gate(
			mission({ intent: "architecture_change", lifecycle: "classified", proposalId: "proposal-1" }),
		).check(descriptor("write"), {}, "HIGH");
		expect(decision.allowed).toBe(true);
	});

	it("allows architecture_change mutations in executing lifecycle without a proposal", () => {
		const decision = gate(mission({ intent: "architecture_change", lifecycle: "executing" })).check(
			descriptor("write"),
			{},
			"HIGH",
		);
		expect(decision.allowed).toBe(true);
	});
});
