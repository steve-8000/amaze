import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@steve-z8k/pi-agent-core";
import { TurnScheduler } from "../turn-scheduler";

function autoMessage(content: string): AgentMessage {
	return {
		role: "custom",
		customType: "auto-turn",
		content,
		display: false,
		attribution: "agent",
		timestamp: 1,
	};
}

describe("TurnScheduler", () => {
	it("admits automatic turns until the per-session source cap is reached", () => {
		const scheduler = new TurnScheduler();

		expect(
			scheduler.request({
				source: "session-stop",
				sessionId: "s1",
				dedupeKey: "stop-1",
				message: autoMessage("first"),
				triggerTurn: true,
				maxPerSession: 2,
				maxConsecutive: 2,
			}).decision,
		).toBe("admit");
		expect(
			scheduler.request({
				source: "session-stop",
				sessionId: "s1",
				dedupeKey: "stop-2",
				message: autoMessage("second"),
				triggerTurn: true,
				maxPerSession: 2,
				maxConsecutive: 2,
			}).decision,
		).toBe("admit");

		const denied = scheduler.request({
			source: "session-stop",
			sessionId: "s1",
			dedupeKey: "stop-3",
			message: autoMessage("third"),
			triggerTurn: true,
			maxPerSession: 2,
			maxConsecutive: 2,
		});

		expect(denied).toEqual({
			decision: "deny",
			source: "session-stop",
			sessionId: "s1",
			dedupeKey: "stop-3",
			reason: "source session cap reached",
			usedPerSession: 2,
			maxPerSession: 2,
			usedConsecutive: 2,
			maxConsecutive: 2,
		});
	});

	it("dedupes repeated automatic turn requests within a session", () => {
		const scheduler = new TurnScheduler();

		scheduler.request({
			source: "irc",
			sessionId: "s1",
			dedupeKey: "msg-1",
			message: autoMessage("hello"),
			triggerTurn: true,
			maxPerSession: 10,
			maxConsecutive: 10,
		});

		const duplicate = scheduler.request({
			source: "irc",
			sessionId: "s1",
			dedupeKey: "msg-1",
			message: autoMessage("hello again"),
			triggerTurn: true,
			maxPerSession: 10,
			maxConsecutive: 10,
		});

		expect(duplicate).toEqual({
			decision: "deny",
			source: "irc",
			sessionId: "s1",
			dedupeKey: "msg-1",
			reason: "duplicate automatic turn request",
			usedPerSession: 1,
			maxPerSession: 10,
			usedConsecutive: 1,
			maxConsecutive: 10,
		});
	});

	it("resets consecutive counters on direct user turns without clearing per-session caps", () => {
		const scheduler = new TurnScheduler();

		scheduler.request({
			source: "todo-reminder",
			sessionId: "s1",
			dedupeKey: "todo-1",
			message: autoMessage("first"),
			triggerTurn: true,
			maxPerSession: 2,
			maxConsecutive: 1,
		});
		const blockedByConsecutiveCap = scheduler.request({
			source: "todo-reminder",
			sessionId: "s1",
			dedupeKey: "todo-2",
			message: autoMessage("blocked"),
			triggerTurn: true,
			maxPerSession: 2,
			maxConsecutive: 1,
		});
		expect(blockedByConsecutiveCap.decision).toBe("deny");
		if (blockedByConsecutiveCap.decision !== "deny") throw new Error("Expected deny decision");
		expect(blockedByConsecutiveCap.reason).toBe("source consecutive cap reached");

		scheduler.recordUserTurn("s1");

		expect(
			scheduler.request({
				source: "todo-reminder",
				sessionId: "s1",
				dedupeKey: "todo-2",
				message: autoMessage("second"),
				triggerTurn: true,
				maxPerSession: 2,
				maxConsecutive: 1,
			}).decision,
		).toBe("admit");
		const blockedBySessionCap = scheduler.request({
			source: "todo-reminder",
			sessionId: "s1",
			dedupeKey: "todo-3",
			message: autoMessage("third"),
			triggerTurn: true,
			maxPerSession: 2,
			maxConsecutive: 1,
		});
		expect(blockedBySessionCap.decision).toBe("deny");
		if (blockedBySessionCap.decision !== "deny") throw new Error("Expected deny decision");
		expect(blockedBySessionCap.reason).toBe("source session cap reached");
	});

	it("admits continuation-only automatic turns without requiring a message", () => {
		const scheduler = new TurnScheduler();

		const first = scheduler.requestContinuation({
			source: "async-yield",
			sessionId: "s1",
			dedupeKey: "async-1",
			maxPerSession: 1,
			maxConsecutive: 1,
		});

		expect(first).toEqual({
			decision: "admit",
			source: "async-yield",
			sessionId: "s1",
			dedupeKey: "async-1",
			triggerTurn: true,
			usedPerSession: 1,
			maxPerSession: 1,
			usedConsecutive: 1,
			maxConsecutive: 1,
		});

		const second = scheduler.requestContinuation({
			source: "async-yield",
			sessionId: "s1",
			dedupeKey: "async-2",
			maxPerSession: 1,
			maxConsecutive: 1,
		});

		expect(second.decision).toBe("deny");
		if (second.decision !== "deny") throw new Error("Expected deny decision");
		expect(second.reason).toBe("source session cap reached");
	});
});
