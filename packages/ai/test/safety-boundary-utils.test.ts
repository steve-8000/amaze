import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@amaze/ai";
import { detectSafetyBoundary, isSafetyBoundary } from "@amaze/ai/utils/safety-boundary";

function createErrorMessage(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-fable-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

describe("detectSafetyBoundary", () => {
	it("detects classifier fallback to Opus and preserves the domain", () => {
		const message = createErrorMessage(
			"Safety classifier routed this cybersecurity request to Claude Opus 4.8 fallback",
		);

		expect(detectSafetyBoundary(message)).toEqual({
			isSafetyBoundary: true,
			domain: "cyber",
			fallback: true,
		});
	});

	it("detects hard classifier declines without marking fallback", () => {
		const message = createErrorMessage("Request declined by the safety classifier for model distillation content");

		expect(detectSafetyBoundary(message)).toEqual({
			isSafetyBoundary: true,
			domain: "model-distillation",
			fallback: false,
		});
	});

	it("detects high-risk biology and chemistry boundary wording", () => {
		const biology = createErrorMessage("High-risk biological domain request blocked by policy");
		const chemistry = createErrorMessage("High risk chemistry request fell back to Opus");

		expect(detectSafetyBoundary(biology)).toMatchObject({ isSafetyBoundary: true, domain: "bio" });
		expect(detectSafetyBoundary(chemistry)).toMatchObject({
			isSafetyBoundary: true,
			domain: "chem",
			fallback: true,
		});
	});

	it("does not classify ordinary provider errors as safety boundaries", () => {
		const message = createErrorMessage("500 upstream timeout while streaming response");

		expect(isSafetyBoundary(message)).toBe(false);
		expect(detectSafetyBoundary(message)).toEqual({ isSafetyBoundary: false, fallback: false });
	});
});
