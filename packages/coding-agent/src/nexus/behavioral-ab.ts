import type { NexusLlmClient } from "./llm-client";
import type { NexusStore } from "./store";

export interface NexusBehavioralEvalCase {
	id: string;
	question: string;
	goal?: string;
	expectedAny: string[];
}

export interface NexusBehavioralEvalResultItem {
	id: string;
	question: string;
	goal?: string;
	expectedAny: string[];
	withMemory: { answer: string; success: boolean };
	withoutMemory: { answer: string; success: boolean };
}

export interface NexusBehavioralEvalResult {
	withMemorySuccessRate: number;
	withoutMemorySuccessRate: number;
	cases: NexusBehavioralEvalResultItem[];
}

/**
 * Behavioral A/B harness for memory relevance.
 *
 * This does not attempt to measure general intelligence. It isolates a smaller,
 * observable question: given the same model and the same question set, does
 * adding Nexus memory context improve task success on prompts whose answers are
 * intentionally stored only in durable memory?
 */
export async function runNexusBehavioralAb(
	store: NexusStore,
	llmClient: NexusLlmClient,
	cases: NexusBehavioralEvalCase[],
	options: { recallLimit?: number } = {},
): Promise<NexusBehavioralEvalResult> {
	const recallLimit = Math.max(1, Math.min(20, options.recallLimit ?? 5));
	const results: NexusBehavioralEvalResultItem[] = [];
	let withHits = 0;
	let withoutHits = 0;
	for (const testCase of cases) {
		const retrieved = retrieveForBehavioralCase(store, testCase, recallLimit);
		const memoryBlock = retrieved.length > 0 ? ["Durable memory:", ...retrieved.map(entry => `- ${entry.content}`)].join("\n") : "Durable memory: <none>";
		const sharedSystem = [
			"You are a coding assistant answering a task-specific question.",
			"Be concise. If the answer is unknown from the supplied information, reply with 'unknown'.",
		].join("\n");
		const withoutMemory = await llmClient.complete({
			system: sharedSystem,
			messages: [{ role: "user", content: testCase.question }],
			temperature: 0,
			maxTokens: 120,
		});
		const withMemory = await llmClient.complete({
			system: [sharedSystem, memoryBlock].join("\n\n"),
			messages: [{ role: "user", content: testCase.question }],
			temperature: 0,
			maxTokens: 120,
		});
		const withoutAnswer = withoutMemory.ok ? withoutMemory.content.trim() : `error: ${withoutMemory.error}`;
		const withAnswer = withMemory.ok ? withMemory.content.trim() : `error: ${withMemory.error}`;
		const withoutSuccess = matchesExpected(withoutAnswer, testCase.expectedAny);
		const withSuccess = matchesExpected(withAnswer, testCase.expectedAny);
		if (withoutSuccess) withoutHits += 1;
		if (withSuccess) withHits += 1;
		results.push({
			id: testCase.id,
			question: testCase.question,
			goal: testCase.goal,
			expectedAny: testCase.expectedAny,
			withMemory: { answer: withAnswer, success: withSuccess },
			withoutMemory: { answer: withoutAnswer, success: withoutSuccess },
		});
	}
	return {
		withMemorySuccessRate: cases.length === 0 ? 0 : withHits / cases.length,
		withoutMemorySuccessRate: cases.length === 0 ? 0 : withoutHits / cases.length,
		cases: results,
	};
}

function matchesExpected(answer: string, expectedAny: string[]): boolean {
	const lower = answer.toLowerCase();
	return expectedAny.some(candidate => lower.includes(candidate.toLowerCase()));
}

function retrieveForBehavioralCase(store: NexusStore, testCase: NexusBehavioralEvalCase, recallLimit: number) {
	const direct = store.search({
		query: testCase.question,
		goal: testCase.goal,
		scope: "current_project",
		limit: recallLimit,
	});
	if (direct.length > 0) return direct;
	const keywords = [...new Set(testCase.question.toLowerCase().split(/[^a-z0-9_.:-]+/).filter(token => token.length >= 4))].slice(0, 6);
	if (keywords.length === 0) return [];
	const merged = new Map<string, ReturnType<NexusStore["list"]>[number]>();
	for (const keyword of keywords) {
		const hits = store.search({ query: keyword, goal: testCase.goal, scope: "current_project", limit: recallLimit });
		for (const hit of hits) if (!merged.has(hit.id)) merged.set(hit.id, hit);
		if (merged.size >= recallLimit) break;
	}
	return [...merged.values()].slice(0, recallLimit);
}
