import type { CompactionSettings } from "../../../compaction/index.ts";
import type { ContextUsage } from "../../types.ts";

const COMPACTION_TRIGGER_RATIO = 0.6;
const COMPACTION_RETAIN_RATIO = 0.1;
const MIN_EFFECTIVE_KEEP_RECENT_TOKENS = 1;

export const SPECULATIVE_FRACTION = 0.75;

export interface CompactionYield {
	savedTokens: number;
	tokensBefore: number;
}

export function computeAdaptiveThresholdRatio(_contextWindow: number, _priorCompactionSavedTokens?: number): number {
	return COMPACTION_TRIGGER_RATIO;
}

export function computeEffectiveThreshold(_contextWindow: number, _lastYield?: CompactionYield | number): number {
	return COMPACTION_TRIGGER_RATIO;
}

export function computeEffectiveKeepRecentTokens(
	setting: number,
	contextWindow: number,
	_thresholdRatio: number,
	_margin = 0.05,
): number {
	const capped = Math.floor(contextWindow * COMPACTION_RETAIN_RATIO);
	return Math.min(setting, Math.max(MIN_EFFECTIVE_KEEP_RECENT_TOKENS, capped));
}

export function shouldStartSpeculativeCompaction(
	usage: ContextUsage,
	contextWindow: number,
	settings: CompactionSettings,
	lastYield?: CompactionYield,
): boolean {
	if (settings.speculativeEnabled === false || usage.tokens === null || contextWindow <= 0) {
		return false;
	}

	const fraction = settings.speculativeFraction ?? SPECULATIVE_FRACTION;
	return usage.tokens >= contextWindow * computeEffectiveThreshold(contextWindow, lastYield) * fraction;
}

export function isAtHardLimit(
	usage: ContextUsage,
	contextWindow: number,
	reserveTokens: number,
	additionalTokens = 0,
): boolean {
	return usage.tokens !== null && usage.tokens + additionalTokens + reserveTokens >= contextWindow;
}

export function shouldTriggerCompaction(
	usage: ContextUsage,
	contextWindow: number,
	settings: CompactionSettings,
	lastYield?: CompactionYield,
): boolean {
	if (!settings.enabled || usage.tokens === null || contextWindow <= 0) {
		return false;
	}

	return usage.tokens >= contextWindow * computeEffectiveThreshold(contextWindow, lastYield);
}
