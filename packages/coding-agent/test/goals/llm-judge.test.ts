/**
 * V3 T4-F — ProductionLlmJudgeRunner proof.
 *
 * Verifies the prompt → reply → verdict path without making real API calls. Injects
 * scripted chat functions and confirms:
 *   - Well-formed JSON reply → verdict surfaces correctly
 *   - Code-fence wrapped JSON → still parsed
 *   - Prose-wrapped JSON → still parsed (greedy bracket-finder)
 *   - Garbage reply → uncertain, NEVER an invented verdict
 *   - Chat throws → fail with error in evidence
 *   - Tokens used > cap → uncertain with cost-cap reason
 *   - Confidence clamped to [0, 1]
 *
 * Real LLM wiring (which `chat` function the caller injects) lives outside this module's
 * test surface — by design. The runner's correctness depends only on prompt rendering and
 * verdict parsing, both fully testable here.
 */

import { describe, expect, it } from "bun:test";
import { ProductionLlmJudgeRunner, parseLlmVerdict } from "@amaze/coding-agent/goals/llm-judge";

describe("parseLlmVerdict", () => {
	it("parses a bare JSON object reply", () => {
		const parsed = parseLlmVerdict(`{"status":"pass","confidence":0.9,"evidence":"matches all paths"}`);
		expect(parsed).toEqual({ status: "pass", confidence: 0.9, evidence: "matches all paths" });
	});

	it("parses a code-fence wrapped JSON reply", () => {
		const parsed = parseLlmVerdict(
			'```json\n{"status":"fail","confidence":0.85,"evidence":"missing produce step"}\n```',
		);
		expect(parsed).toEqual({ status: "fail", confidence: 0.85, evidence: "missing produce step" });
	});

	it("recovers a JSON verdict from inside prose", () => {
		const parsed = parseLlmVerdict(
			`Looking at this carefully... {"status":"uncertain","confidence":0.4,"evidence":"ambiguous"} ...so that's my call.`,
		);
		expect(parsed).toEqual({ status: "uncertain", confidence: 0.4, evidence: "ambiguous" });
	});

	it("returns null on garbage reply (no invention)", () => {
		expect(parseLlmVerdict("idk man")).toBeNull();
		expect(parseLlmVerdict("")).toBeNull();
	});

	it("returns null when JSON is present but lacks required fields", () => {
		expect(parseLlmVerdict(`{"status":"pass"}`)).toBeNull();
		expect(parseLlmVerdict(`{"foo":"bar"}`)).toBeNull();
	});

	it("returns null on invalid status value", () => {
		expect(parseLlmVerdict(`{"status":"maybe","confidence":0.5,"evidence":"x"}`)).toBeNull();
	});

	it("clamps confidence outside [0, 1] (defensive — should not happen but compress on parse)", () => {
		expect(parseLlmVerdict(`{"status":"pass","confidence":1.5,"evidence":"x"}`)?.confidence).toBe(1);
		expect(parseLlmVerdict(`{"status":"pass","confidence":-0.2,"evidence":"x"}`)?.confidence).toBe(0);
	});

	it("ignores extraneous brace-bearing strings before the verdict object", () => {
		const parsed = parseLlmVerdict(
			`The candidate says "{not real}" but the actual verdict is {"status":"fail","confidence":0.7,"evidence":"bad"}.`,
		);
		expect(parsed?.status).toBe("fail");
	});
});

describe("ProductionLlmJudgeRunner", () => {
	it("returns the parsed verdict on a clean JSON reply", async () => {
		const runner = new ProductionLlmJudgeRunner({
			chat: async () => ({
				reply: `{"status":"pass","confidence":0.95,"evidence":"all tests passing"}`,
				tokensUsed: 120,
			}),
		});
		const verdict = await runner.judge({ question: "does it pass?", candidate: "<diff>" });
		expect(verdict.status).toBe("pass");
		expect(verdict.confidence).toBe(0.95);
		expect(verdict.evidence).toBe("all tests passing");
		expect(verdict.tokensUsed).toBe(120);
	});

	it("returns uncertain when the chat reply is unparseable (no invented verdict)", async () => {
		const runner = new ProductionLlmJudgeRunner({
			chat: async () => ({ reply: "I think probably yes", tokensUsed: 80 }),
		});
		const verdict = await runner.judge({ question: "q", candidate: "c" });
		expect(verdict.status).toBe("uncertain");
		expect(verdict.evidence).toContain("unparseable");
		expect(verdict.tokensUsed).toBe(80);
	});

	it("returns fail with error in evidence when chat throws", async () => {
		const runner = new ProductionLlmJudgeRunner({
			chat: async () => {
				throw new Error("provider 502");
			},
		});
		const verdict = await runner.judge({ question: "q", candidate: "c" });
		expect(verdict.status).toBe("fail");
		expect(verdict.evidence).toContain("provider 502");
	});

	it("PHASE T4-F ACCEPTANCE: returns uncertain when tokens used > maxTokensPerCall (cost cap)", async () => {
		const runner = new ProductionLlmJudgeRunner({
			chat: async () => ({
				reply: `{"status":"pass","confidence":0.9,"evidence":"x"}`,
				tokensUsed: 800,
			}),
			maxTokensPerCall: 500,
		});
		const verdict = await runner.judge({ question: "q", candidate: "c" });
		expect(verdict.status).toBe("uncertain");
		expect(verdict.evidence).toContain("cost cap");
		expect(verdict.evidence).toContain("800");
		expect(verdict.tokensUsed).toBe(800);
	});

	it("default cost cap is 500 tokens (matches Phase 4 acceptance bar)", async () => {
		const runner = new ProductionLlmJudgeRunner({
			chat: async () => ({
				reply: `{"status":"pass","confidence":0.9,"evidence":"x"}`,
				tokensUsed: 501,
			}),
			// No explicit maxTokensPerCall — should use default 500.
		});
		const verdict = await runner.judge({ question: "q", candidate: "c" });
		expect(verdict.status).toBe("uncertain");
	});

	it("renders the focused prompt template with question + candidate substituted", async () => {
		let observedPrompt = "";
		const runner = new ProductionLlmJudgeRunner({
			chat: async ({ prompt }) => {
				observedPrompt = prompt;
				return { reply: `{"status":"pass","confidence":1,"evidence":"x"}`, tokensUsed: 100 };
			},
		});
		await runner.judge({ question: "QQQ", candidate: "CCC" });
		expect(observedPrompt).toContain("QUESTION:\nQQQ");
		expect(observedPrompt).toContain("CANDIDATE:\nCCC");
		expect(observedPrompt).toContain('"status": "pass" | "fail" | "uncertain"');
		expect(observedPrompt).toContain("ruthlessly literal");
	});
});
