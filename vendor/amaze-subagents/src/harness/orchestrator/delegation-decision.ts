/// <reference types="node" />

import { createHash } from "node:crypto";

export type DelegationDecisionMode = "agent_direct";

export interface DelegationDecision {
	missionId: string;
	mode: DelegationDecisionMode;
	agent: string;
	task: string;
	confidence: number;
	reason: string;
	parentInstructions: string[];
	verification: {
		level: string;
		evidence: string[];
	};
}

export interface DirectDelegationDecisionOptions {
	missionId?: string;
	agent?: string;
	agentCandidates?: DirectAgentCandidate[];
}

export interface DirectAgentCandidate {
	name: string;
	description?: string;
	disabled?: boolean;
}

function safeMissionId(rawRequest: string): string {
	const digest = createHash("sha256").update(rawRequest).digest("hex").slice(0, 12);
	return `mission-${digest}`;
}

export function compileDelegationDecision(rawRequest: string, options: DirectDelegationDecisionOptions = {}): DelegationDecision {
	const agent = options.agent?.trim() || selectDirectAgent(rawRequest, options.agentCandidates);
	return {
		missionId: options.missionId ?? safeMissionId(rawRequest),
		mode: "agent_direct",
		agent,
		task: rawRequest,
		confidence: 1,
		reason: "Direct orchestration selected the best available executable agent for the raw task.",
		parentInstructions: [
			`Invoke agent '${agent}' directly with the raw task.`,
			"Select from configured executable agents without creating an intermediate routing layer.",
			"Validation remains owned by the caller after the direct agent run.",
		],
		verification: {
			level: "checked",
			evidence: ["changed-files", "commands-run", "validation-output"],
		},
	};
}

function selectDirectAgent(rawRequest: string, candidates: DirectAgentCandidate[] | undefined): string {
	const available = (candidates ?? [])
		.filter((candidate) => candidate.name.trim() && !candidate.disabled)
		.map((candidate) => ({
			name: candidate.name.trim(),
			description: candidate.description?.trim() ?? "",
		}))
		.filter((candidate) => candidate.name !== "delegate");

	if (available.length === 0) return "worker";

	const requestTokens = tokenize(rawRequest);
	const preferred = preferredAgentForTask(rawRequest);
	const scored = available.map((candidate) => {
		const haystack = tokenize(`${candidate.name} ${candidate.description}`);
		let score = 0;
		for (const token of requestTokens) {
			if (haystack.has(token)) score += token === candidate.name ? 4 : 1;
		}
		if (preferred === candidate.name) score += 10;
		if (candidate.name === "worker") score -= 0.25;
		return { ...candidate, score };
	});

	scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
	return scored[0]?.name ?? "worker";
}

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9가-힣_-]+/u)
			.map((token) => token.trim())
			.filter((token) => token.length >= 2),
	);
}

function preferredAgentForTask(rawRequest: string): string | undefined {
	const text = rawRequest.toLowerCase();
	if (/\b(review|audit|evaluate)\b|리뷰|검토|평가/.test(text)) return "reviewer";
	if (/\b(plan|design|break down)\b|계획|설계/.test(text)) return "planner";
	if (/\b(explain|investigate|look into|find|search)\b|설명|조사|찾아|검색|확인/.test(text)) return "scout";
	if (/\b(implement|fix|refactor|patch|add|create)\b|구현|수정|고쳐|패치|추가|리팩터/.test(text)) return "worker";
	return undefined;
}
