import { afterEach, describe, expect, it } from "bun:test";
import {
	configureRecallFeatures,
	enhancedRecallEnabled,
	polyphonicRecallEnabled,
	proactiveLinkingEnabled,
} from "@steve-z8k/pi-rocky-memory/config";
import { polyphonicRecallIsEnabled } from "@steve-z8k/pi-rocky-memory/core/polyphonic-recall";
import { isEnhancedRecallEnabled, isQueryCacheEnabled } from "@steve-z8k/pi-rocky-memory/core/query-cache";

afterEach(() => {
	configureRecallFeatures({ polyphonicRecall: false, enhancedRecall: false, proactiveLinking: false });
});

describe("configureRecallFeatures", () => {
	it("keeps all recall gates off by default", () => {
		expect(polyphonicRecallEnabled({})).toBe(false);
		expect(enhancedRecallEnabled({})).toBe(false);
		expect(proactiveLinkingEnabled({})).toBe(false);
		expect(isEnhancedRecallEnabled({})).toBe(false);
		expect(isQueryCacheEnabled(true, {})).toBe(false);
	});

	it("enables the gates from host configuration when the env vars are unset", () => {
		configureRecallFeatures({ polyphonicRecall: true, enhancedRecall: true, proactiveLinking: true });
		expect(polyphonicRecallEnabled({})).toBe(true);
		expect(polyphonicRecallIsEnabled({})).toBe(true);
		expect(enhancedRecallEnabled({})).toBe(true);
		expect(proactiveLinkingEnabled({})).toBe(true);
		expect(isEnhancedRecallEnabled({})).toBe(true);
		expect(isQueryCacheEnabled(true, {})).toBe(true);
		expect(isQueryCacheEnabled(false, {})).toBe(false);
	});

	it("lets the env vars override the configured value in both directions", () => {
		configureRecallFeatures({ polyphonicRecall: true, enhancedRecall: true, proactiveLinking: true });
		expect(polyphonicRecallEnabled({ ROCKY_MEMORY_POLYPHONIC_RECALL: "0" })).toBe(false);
		expect(enhancedRecallEnabled({ ROCKY_MEMORY_ENHANCED_RECALL: "0" })).toBe(false);
		expect(proactiveLinkingEnabled({ ROCKY_MEMORY_PROACTIVE_LINKING: "0" })).toBe(false);
		expect(isQueryCacheEnabled(true, { ROCKY_MEMORY_ENHANCED_RECALL: "0" })).toBe(false);

		configureRecallFeatures({ polyphonicRecall: false, enhancedRecall: false, proactiveLinking: false });
		expect(polyphonicRecallEnabled({ ROCKY_MEMORY_POLYPHONIC_RECALL: "1" })).toBe(true);
		expect(enhancedRecallEnabled({ ROCKY_MEMORY_ENHANCED_RECALL: "1" })).toBe(true);
		expect(proactiveLinkingEnabled({ ROCKY_MEMORY_PROACTIVE_LINKING: "1" })).toBe(true);
		expect(isQueryCacheEnabled(true, { ROCKY_MEMORY_ENHANCED_RECALL: "1" })).toBe(true);
	});

	it("updates only the flags that are present", () => {
		configureRecallFeatures({ polyphonicRecall: true });
		expect(polyphonicRecallEnabled({})).toBe(true);
		expect(enhancedRecallEnabled({})).toBe(false);
		expect(proactiveLinkingEnabled({})).toBe(false);
		configureRecallFeatures({ enhancedRecall: true });
		expect(polyphonicRecallEnabled({})).toBe(true);
		expect(enhancedRecallEnabled({})).toBe(true);
		expect(proactiveLinkingEnabled({})).toBe(false);
		configureRecallFeatures({ proactiveLinking: true });
		expect(polyphonicRecallEnabled({})).toBe(true);
		expect(enhancedRecallEnabled({})).toBe(true);
		expect(proactiveLinkingEnabled({})).toBe(true);
	});
});
