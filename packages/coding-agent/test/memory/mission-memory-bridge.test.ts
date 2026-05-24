import { describe, expect, test } from "bun:test";
import { isMoreAuthoritative } from "../../src/memory/authority";
import {
	MemoryCurator,
	MissionMemoryBridge,
	RECALL_AUTHORITY,
	RECALL_AUTHORITY_LABEL,
	recallDefersTo,
} from "../../src/memory/bridge";
import type { ActiveMissionPacket } from "../../src/mission/context-packet";
import { renderActiveMissionPacket, withMemoryRecall } from "../../src/mission/context-packet";
import type { NexusMemoryEntry } from "../../src/nexus/types";
import { SessionSearchTool } from "../../src/tools/session-search";

function entry(overrides: Partial<NexusMemoryEntry> = {}): NexusMemoryEntry {
	return {
		id: "mem-1",
		scopeId: "project:test",
		scopeKind: "project",
		scopeKey: "test",
		displayName: "test",
		cwd: "/repo",
		gitOrigin: null,
		target: "memory",
		category: "convention",
		memoryType: "project_convention",
		content: "prefer bun over npm",
		provenance: "source:manual",
		confidence: "user_asserted",
		staleness: "fresh",
		status: "active",
		usageCount: 1,
		lastUsedAt: null,
		lastVerifiedAt: null,
		validFrom: null,
		validTo: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function basePacket(): ActiveMissionPacket {
	return {
		objective: "ship the bridge",
		state: "active" as ActiveMissionPacket["state"],
		decision: null,
		activeContract: null,
		evidenceClaims: [],
		blockingCritique: null,
		nextActions: [],
		omitted: {
			evidenceClaims: 0,
			evidenceCards: 0,
			contracts: 0,
			contractIncludes: 0,
			contractCriteria: 0,
			nextActions: 0,
		},
	};
}

describe("MissionMemoryBridge (§11, §15.5)", () => {
	test("recall is mission-scoped and surfaced into a context packet", () => {
		let capturedScope: string | undefined;
		let capturedQuery: string | undefined;
		const bridge = new MissionMemoryBridge({
			missionId: "mission-42",
			recall: input => {
				capturedQuery = input.query;
				capturedScope = input.scope;
				return [entry(), entry({ id: "mem-2", content: "tests live under test/" })];
			},
		});

		const recall = bridge.recall({ query: "how do we run tests" });
		expect(capturedQuery).toBe("how do we run tests");
		expect(capturedScope).toBe("current_project");
		expect(recall.missionId).toBe("mission-42");
		expect(recall.items).toHaveLength(2);
		expect(recall.items.every(i => i.missionId === "mission-42")).toBe(true);

		// Recall surfaces into the mission context packet (additive field).
		const packet = withMemoryRecall(basePacket(), recall);
		expect(packet.memoryRecall?.items).toHaveLength(2);
		const rendered = renderActiveMissionPacket(packet);
		expect(rendered).toContain("Recalled memory");
		expect(rendered).toContain("prefer bun over npm");
	});

	test("recalled memory is guidance and never overrides repo truth", () => {
		const bridge = new MissionMemoryBridge({
			missionId: "m",
			recall: () => [entry()],
		});
		const recall = bridge.recall({ query: "anything" });
		expect(recall.authority).toBe(RECALL_AUTHORITY);
		expect(RECALL_AUTHORITY_LABEL).toBe("guidance");
		for (const item of recall.items) {
			expect(item.authority).toBe(RECALL_AUTHORITY);
			// repo_truth and instruction strictly outrank recall guidance.
			expect(isMoreAuthoritative("repo_truth", item.authority)).toBe(true);
			expect(isMoreAuthoritative("instruction", item.authority)).toBe(true);
		}
		expect(recallDefersTo("repo_truth")).toBe(true);
	});

	test("empty / failing recall never breaks the loop", () => {
		const blank = new MissionMemoryBridge({ missionId: "m", recall: () => [] });
		expect(blank.recall({ query: "   " }).items).toHaveLength(0);
		const broken = new MissionMemoryBridge({
			missionId: "m",
			recall: () => {
				throw new Error("db down");
			},
		});
		expect(broken.recall({ query: "x" }).items).toHaveLength(0);
	});
});

describe("MemoryCurator durable-write gate (§11.3, §15.5)", () => {
	test("durable write is rejected without curator approval (intermediate reasoning)", () => {
		const curator = new MemoryCurator({ missionId: "m" });
		let committed = false;
		const result = curator.write({ source: "mission_intermediate_reasoning", payload: "scratch thought" }, () => {
			committed = true;
			return "written";
		});
		expect(result.allowed).toBe(false);
		expect(committed).toBe(false);
		expect(curator.approves("mission_intermediate_reasoning")).toBe(false);
	});

	test("verified decision can be stored at verified authority", () => {
		const curator = new MemoryCurator();
		const result = curator.write(
			{ source: "verifier_passed", payload: { content: "fix works" } },
			(payload, authority) => ({
				payload,
				authority,
			}),
		);
		expect(result.allowed).toBe(true);
		if (result.allowed) {
			expect(result.authority).toBe("verified_project_decision");
			expect(result.result.authority).toBe("verified_project_decision");
		}
	});

	test("critic-reviewed and user instruction promote; tool result is evidence", () => {
		const curator = new MemoryCurator();
		expect(curator.evaluate("critic_reviewed").allowed).toBe(true);
		expect(curator.evaluate("user_instruction").allowed).toBe(true);
		const tool = curator.evaluate("tool_result");
		expect(tool.allowed).toBe(true);
		if (tool.allowed) expect(tool.authority).toBe("mission_evidence");
	});
});

describe("session_search remains available (§15.5)", () => {
	test("the session_search tool path is unchanged", () => {
		expect(typeof SessionSearchTool).toBe("function");
		expect(SessionSearchTool.prototype.name).toBeUndefined();
		// name is an instance field; assert via a minimal duck-typed instance shape.
		expect(Object.getOwnPropertyNames(SessionSearchTool.prototype)).toContain("execute");
		expect(typeof SessionSearchTool.createIf).toBe("function");
	});
});
