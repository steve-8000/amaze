import type { AgentMessage } from "@amaze/pi-agent-core";

export type AutoTurnSource =
	| "compaction"
	| "todo-reminder"
	| "session-stop"
	| "empty-stop-retry"
	| "unexpected-stop-retry"
	| "ttsr"
	| "irc"
	| "yield"
	| "autolearn"
	| "async-yield"
	| "task-background";

interface AutoTurnBaseRequest {
	source: AutoTurnSource;
	sessionId: string;
	dedupeKey: string;
	maxPerSession: number;
	maxConsecutive: number;
}

export interface AutoTurnRequest extends AutoTurnBaseRequest {
	message: AgentMessage;
	triggerTurn: boolean;
}

export interface AutoTurnContinuationRequest extends AutoTurnBaseRequest {}

interface AutoTurnAdmittedBase {
	decision: "admit";
	source: AutoTurnSource;
	sessionId: string;
	dedupeKey: string;
	triggerTurn: boolean;
	usedPerSession: number;
	maxPerSession: number;
	usedConsecutive: number;
	maxConsecutive: number;
}

export interface AutoTurnAdmitted extends AutoTurnAdmittedBase {
	message: AgentMessage;
}

export interface AutoTurnContinuationAdmitted extends AutoTurnAdmittedBase {}

export interface AutoTurnDenied {
	decision: "deny";
	source: AutoTurnSource;
	sessionId: string;
	dedupeKey: string;
	reason: "duplicate automatic turn request" | "source session cap reached" | "source consecutive cap reached";
	usedPerSession: number;
	maxPerSession: number;
	usedConsecutive: number;
	maxConsecutive: number;
}

export type AutoTurnDecision = AutoTurnAdmitted | AutoTurnDenied;
export type AutoTurnContinuationDecision = AutoTurnContinuationAdmitted | AutoTurnDenied;

interface SourceCounters {
	perSession: number;
	consecutive: number;
	dedupeKeys: Set<string>;
}

function sourceKey(sessionId: string, source: AutoTurnSource): string {
	return `${sessionId}\0${source}`;
}

function capReached(used: number, max: number): boolean {
	return max > 0 && used >= max;
}

export class TurnScheduler {
	#counters = new Map<string, SourceCounters>();

	request(request: AutoTurnRequest): AutoTurnDecision {
		const decision = this.#admit(request);
		if (decision.decision === "deny") return decision;
		return {
			...decision,
			message: request.message,
			triggerTurn: request.triggerTurn,
		};
	}

	requestContinuation(request: AutoTurnContinuationRequest): AutoTurnContinuationDecision {
		return this.#admit(request);
	}

	#admit(request: AutoTurnBaseRequest): AutoTurnContinuationDecision {
		const key = sourceKey(request.sessionId, request.source);
		const counters = this.#counters.get(key) ?? { perSession: 0, consecutive: 0, dedupeKeys: new Set<string>() };
		this.#counters.set(key, counters);

		if (counters.dedupeKeys.has(request.dedupeKey)) {
			return this.#deny(request, counters, "duplicate automatic turn request");
		}
		if (capReached(counters.perSession, request.maxPerSession)) {
			return this.#deny(request, counters, "source session cap reached");
		}
		if (capReached(counters.consecutive, request.maxConsecutive)) {
			return this.#deny(request, counters, "source consecutive cap reached");
		}

		counters.perSession++;
		counters.consecutive++;
		counters.dedupeKeys.add(request.dedupeKey);
		return {
			decision: "admit",
			source: request.source,
			sessionId: request.sessionId,
			dedupeKey: request.dedupeKey,
			triggerTurn: true,
			usedPerSession: counters.perSession,
			maxPerSession: request.maxPerSession,
			usedConsecutive: counters.consecutive,
			maxConsecutive: request.maxConsecutive,
		};
	}

	recordUserTurn(sessionId: string): void {
		for (const [key, counters] of this.#counters) {
			if (key.startsWith(`${sessionId}\0`)) {
				counters.consecutive = 0;
			}
		}
	}

	#deny(request: AutoTurnBaseRequest, counters: SourceCounters, reason: AutoTurnDenied["reason"]): AutoTurnDenied {
		return {
			decision: "deny",
			source: request.source,
			sessionId: request.sessionId,
			dedupeKey: request.dedupeKey,
			reason,
			usedPerSession: counters.perSession,
			maxPerSession: request.maxPerSession,
			usedConsecutive: counters.consecutive,
			maxConsecutive: request.maxConsecutive,
		};
	}
}
