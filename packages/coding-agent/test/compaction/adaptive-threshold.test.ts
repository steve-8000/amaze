import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerFauxProvider } from "@steve-8000/amaze-ai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS } from "../../src/core/compaction/index.ts";
import {
	computeAdaptiveThresholdRatio,
	computeEffectiveKeepRecentTokens,
	computeEffectiveThreshold,
	isAtHardLimit,
	SPECULATIVE_FRACTION,
	shouldStartSpeculativeCompaction,
} from "../../src/core/extensions/builtin/compaction/policy.ts";
import { migrateSessionEntries, parseSessionEntries, type SessionEntry } from "../../src/core/session-manager.ts";

const HIGH_YIELD_SAVED_TOKENS = 9000;
const LOW_YIELD_SAVED_TOKENS = 500;
const SPECULATIVE_THRESHOLD_FRACTION = 0.75;

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

let adaptiveFixtureEntries: SessionEntry[] = [];

beforeAll(() => {
	const fixturePath = join(
		__dirname,
		"..",
		"fixtures",
		"compaction",
		"adaptive-threshold",
		"16k-near-threshold.jsonl",
	);
	const content = readFileSync(fixturePath, "utf-8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries);
	adaptiveFixtureEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
});

describe("compaction policy: adaptive threshold ratio", () => {
	describe("Given a faux model with context window 16000", () => {
		describe("When the adaptive threshold ratio is computed for that window", () => {
			it("Then the ratio equals the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-16k", contextWindow: 16000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-16k");
				expect(model?.contextWindow).toBe(16000);
				expect(adaptiveFixtureEntries.length).toBeGreaterThan(0);

				if (!model) {
					throw new Error("faux-16k model was not registered");
				}

				const ratio = computeAdaptiveThresholdRatio(model.contextWindow);

				expect(ratio).toBe(0.6);
			});
		});
	});

	describe("Given a faux model with context window 32000", () => {
		describe("When the adaptive threshold ratio is computed for that window", () => {
			it("Then the ratio equals the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-32k", contextWindow: 32000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-32k");
				if (!model) {
					throw new Error("faux-32k model was not registered");
				}

				const ratio = computeAdaptiveThresholdRatio(model.contextWindow);

				expect(ratio).toBe(0.6);
			});
		});
	});

	describe("Given a faux model with context window 64000", () => {
		describe("When the adaptive threshold ratio is computed for that window", () => {
			it("Then the ratio equals the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-64k", contextWindow: 64000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-64k");
				if (!model) {
					throw new Error("faux-64k model was not registered");
				}

				const ratio = computeAdaptiveThresholdRatio(model.contextWindow);

				expect(ratio).toBe(0.6);
			});
		});
	});

	describe("Given a faux model with context window 128000", () => {
		describe("When the adaptive threshold ratio is computed for that window", () => {
			it("Then the ratio equals the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-128k", contextWindow: 128000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-128k");
				if (!model) {
					throw new Error("faux-128k model was not registered");
				}

				const ratio = computeAdaptiveThresholdRatio(model.contextWindow);

				expect(ratio).toBe(0.6);
			});
		});
	});

	describe("Given a faux model with context window 200000", () => {
		describe("When the adaptive threshold ratio is computed for that window", () => {
			it("Then the ratio equals the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-200k", contextWindow: 200000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-200k");
				if (!model) {
					throw new Error("faux-200k model was not registered");
				}

				const ratio = computeAdaptiveThresholdRatio(model.contextWindow);

				expect(ratio).toBe(0.6);
			});
		});
	});

	describe("Given a 32000 context window", () => {
		describe("When the effective threshold is computed", () => {
			it("Then the 60 percent trigger threshold is used", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-32k", contextWindow: 32000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-32k");
				if (!model) {
					throw new Error("faux-32k model was not registered");
				}

				const baseRatio = computeAdaptiveThresholdRatio(model.contextWindow);
				expect(baseRatio).toBe(0.6);

				const effective = computeEffectiveThreshold(model.contextWindow);

				expect(effective).toBe(baseRatio);
			});
		});
	});

	describe("Given context window 16000 with a high-yield prior compaction (savedTokens > 8000)", () => {
		describe("When the next adaptive threshold ratio is computed", () => {
			it("Then the ratio remains fixed at the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-16k-high-yield", contextWindow: 16000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-16k-high-yield");
				if (!model) {
					throw new Error("faux-16k-high-yield model was not registered");
				}

				const baselineRatio = computeAdaptiveThresholdRatio(model.contextWindow);
				const adjustedRatio = computeAdaptiveThresholdRatio(model.contextWindow, HIGH_YIELD_SAVED_TOKENS);

				expect(baselineRatio).toBe(0.6);
				expect(adjustedRatio).toBe(0.6);
			});
		});
	});

	describe("Given context window 16000 with a low-yield prior compaction (savedTokens < 1000)", () => {
		describe("When the next adaptive threshold ratio is computed", () => {
			it("Then the ratio remains fixed at the 60 percent trigger threshold", () => {
				const registration = registerFauxProvider({
					models: [{ id: "faux-16k-low-yield", contextWindow: 16000 }],
				});
				registrations.push(registration);

				const model = registration.getModel("faux-16k-low-yield");
				if (!model) {
					throw new Error("faux-16k-low-yield model was not registered");
				}

				const baselineRatio = computeAdaptiveThresholdRatio(model.contextWindow);
				const adjustedRatio = computeAdaptiveThresholdRatio(model.contextWindow, LOW_YIELD_SAVED_TOKENS);

				expect(baselineRatio).toBe(0.6);
				expect(adjustedRatio).toBe(0.6);
			});
		});
	});

	describe("Given context window 32000 with a high-yield prior compaction", () => {
		describe("When the effective threshold is computed", () => {
			it("Then the threshold remains fixed at the 60 percent trigger threshold", () => {
				// given
				const registration = registerFauxProvider({
					models: [{ id: "faux-32k-effective-high-yield", contextWindow: 32000 }],
				});
				registrations.push(registration);
				const model = registration.getModel("faux-32k-effective-high-yield");
				if (!model) {
					throw new Error("faux-32k-effective-high-yield model was not registered");
				}

				// when
				const effective = computeEffectiveThreshold(model.contextWindow, {
					savedTokens: HIGH_YIELD_SAVED_TOKENS,
					tokensBefore: 16000,
				});

				// then
				expect(effective).toBe(0.6);
			});
		});
	});

	describe("Given context window 32000 with a low-yield prior compaction", () => {
		describe("When the effective threshold is computed", () => {
			it("Then the threshold remains fixed at the 60 percent trigger threshold", () => {
				// given
				const registration = registerFauxProvider({
					models: [{ id: "faux-32k-effective-low-yield", contextWindow: 32000 }],
				});
				registrations.push(registration);
				const model = registration.getModel("faux-32k-effective-low-yield");
				if (!model) {
					throw new Error("faux-32k-effective-low-yield model was not registered");
				}

				// when
				const effective = computeEffectiveThreshold(model.contextWindow, {
					savedTokens: LOW_YIELD_SAVED_TOKENS,
					tokensBefore: 16000,
				});

				// then
				expect(effective).toBe(0.6);
			});
		});
	});

	describe("Given speculative compaction policy", () => {
		describe("When the speculative fraction and threshold are evaluated", () => {
			it("Then speculative starts at 75% of the 60 percent trigger threshold", () => {
				// given
				const cases = [
					{ contextWindow: 16_000, adaptiveRatio: 0.6 },
					{ contextWindow: 32_000, adaptiveRatio: 0.6 },
					{ contextWindow: 64_000, adaptiveRatio: 0.6 },
					{ contextWindow: 128_000, adaptiveRatio: 0.6 },
					{ contextWindow: 200_000, adaptiveRatio: 0.6 },
				];

				// when / then
				expect(SPECULATIVE_FRACTION).toBe(SPECULATIVE_THRESHOLD_FRACTION);
				for (const currentCase of cases) {
					const triggerTokens = currentCase.contextWindow * currentCase.adaptiveRatio * SPECULATIVE_FRACTION;
					expect(
						shouldStartSpeculativeCompaction(
							{ tokens: triggerTokens - 1, contextWindow: currentCase.contextWindow, percent: null },
							currentCase.contextWindow,
							{ ...DEFAULT_COMPACTION_SETTINGS, speculativeEnabled: true },
						),
					).toBe(false);
					expect(
						shouldStartSpeculativeCompaction(
							{ tokens: triggerTokens, contextWindow: currentCase.contextWindow, percent: null },
							currentCase.contextWindow,
							{ ...DEFAULT_COMPACTION_SETTINGS, speculativeEnabled: true },
						),
					).toBe(true);
				}
			});
		});
	});

	describe("Given default keepRecentTokens exceeds a small context window", () => {
		describe("When the effective keepRecentTokens cap is computed", () => {
			it("Then the cap keeps only 10 percent of the context window", () => {
				// given
				const contextWindow = 16_000;
				const thresholdRatio = computeEffectiveThreshold(contextWindow);

				// when
				const keepRecentTokens = computeEffectiveKeepRecentTokens(
					DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
					contextWindow,
					thresholdRatio,
				);

				// then
				expect(keepRecentTokens).toBe(1600);
				expect(keepRecentTokens).toBeLessThan(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);
				expect(keepRecentTokens).toBeLessThanOrEqual(contextWindow * 0.1);
			});
		});
	});

	describe("Given usage plus reserve reaches the model context window", () => {
		describe("When hard limit policy is evaluated", () => {
			it("Then hard limit is detected with optional additional tokens", () => {
				// given
				const usage = { tokens: 83_000, contextWindow: 100_000, percent: 0.83 };

				// when / then
				expect(isAtHardLimit(usage, 100_000, 16_384)).toBe(false);
				expect(isAtHardLimit(usage, 100_000, 16_384, 616)).toBe(true);
			});
		});
	});
});
