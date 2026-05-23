import type { SessionEvent } from "../../observability";
import type { LearningProposal } from "../types";
import { evaluateContradictionGate } from "./contradiction";
import { evaluateProvenanceGate } from "./provenance";
import { replaySession } from "./replay";

export interface EvalContext {
	existingMemoryContent?: string[];
	existingSkill?: { name: string; bodyMarkdown: string } | null;
	replaySessions?: string[];
	replayBaseDir?: string;
	recentEvents?: SessionEvent[];
	baselinePassRate?: number;
	now?: number | (() => number);
}

export interface EvalReport {
	passed: boolean;
	stage: "provenance" | "contradiction" | "replay" | "done";
	signals: Record<string, unknown>;
	durationMs: number;
}

export async function evaluateProposal(proposal: LearningProposal, ctx: EvalContext = {}): Promise<EvalReport> {
	const startedAt = readNow(ctx);
	const signals: Record<string, unknown> = {};

	const provenance = evaluateProvenanceGate(proposal);
	signals.provenance = provenance;
	if (!provenance.passed) return report(false, "provenance", signals, startedAt, ctx);

	const contradiction = evaluateContradictionGate(proposal, {
		existingMemoryContent: ctx.existingMemoryContent,
		existingSkill: ctx.existingSkill,
	});
	signals.contradiction = contradiction;
	if (!contradiction.passed) return report(false, "contradiction", signals, startedAt, ctx);

	const replay = await evaluateReplay(ctx);
	signals.replay = replay;
	if (!replay.passed) return report(false, "replay", signals, startedAt, ctx);

	return report(true, "done", signals, startedAt, ctx);
}

async function evaluateReplay(ctx: EvalContext): Promise<{
	passed: boolean;
	sessions: string[];
	baselinePassRate: number;
	passRate: number;
	allowedDrop: number;
	results: Array<{ sessionId: string; goalCompleteVerdict: string | null }>;
}> {
	const sessions = ctx.replaySessions ?? [];
	const results = [];

	for (const sessionId of sessions) {
		const events = ctx.recentEvents?.filter(event => event.sessionId === sessionId);
		const replayReport = await replaySession(sessionId, {
			baseDir: ctx.replayBaseDir ?? ".",
			...(events ? { events } : {}),
		});
		results.push({
			sessionId,
			goalCompleteVerdict: replayReport.decisions.goalCompleteVerdict,
		});
	}

	const passedCount = results.filter(result => result.goalCompleteVerdict === "pass").length;
	const passRate = results.length === 0 ? 1 : passedCount / results.length;
	const baselinePassRate = ctx.baselinePassRate ?? 0;
	const allowedDrop = 0.05;

	return {
		passed: passRate >= baselinePassRate - allowedDrop,
		sessions,
		baselinePassRate,
		passRate,
		allowedDrop,
		results,
	};
}

function report(
	passed: boolean,
	stage: EvalReport["stage"],
	signals: Record<string, unknown>,
	startedAt: number,
	ctx: EvalContext,
): EvalReport {
	return { passed, stage, signals, durationMs: Math.max(0, readNow(ctx) - startedAt) };
}

function readNow(ctx: EvalContext): number {
	if (typeof ctx.now === "function") return ctx.now();
	return ctx.now ?? 0;
}
