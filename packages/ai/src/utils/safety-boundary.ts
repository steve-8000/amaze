import type { AssistantMessage } from "../types";

/** Domains where Anthropic documents Mythos-class safety classifiers may decline or route work. */
export const SAFETY_BOUNDARY_DOMAINS = ["cyber", "bio", "chem", "model-distillation"] as const;

export type SafetyBoundaryDomain = (typeof SAFETY_BOUNDARY_DOMAINS)[number];

export interface SafetyBoundaryDetection {
	/** Provider declined, downgraded, or routed the request because it crossed a safety boundary. */
	isSafetyBoundary: boolean;
	/** Best-effort domain inferred from provider wording. */
	domain?: SafetyBoundaryDomain;
	/** True when provider wording says the request was routed to a fallback model rather than hard-blocked. */
	fallback: boolean;
}

const SAFETY_CLASSIFIER_PATTERNS = [
	/safety classifier/i,
	/classifier(?:s)?\s+(?:blocked|declined|routed|redirected|fallback|fell back)/i,
	/(?:declined|blocked|refused)\s+by\s+(?:the\s+)?(?:safety\s+)?classifier/i,
	/(?:routed|redirected|fell back|fallback)\s+to\s+(?:claude\s+)?opus/i,
	/(?:mythos|fable).*safety boundary/i,
	/high[-\s]?risk\s+(?:domain|area|request)/i,
] as const;

const FALLBACK_PATTERNS = [
	/\bfallback\b/i,
	/\bfell back\b/i,
	/\brouted\b/i,
	/\bredirected\b/i,
	/to\s+(?:claude\s+)?opus/i,
] as const;

const DOMAIN_PATTERNS: readonly [SafetyBoundaryDomain, RegExp][] = [
	["model-distillation", /\b(?:model\s*)?distillation\b/i],
	["cyber", /\b(?:cyber|cybersecurity|vulnerability|exploit|penetration\s+test|pentest)\b/i],
	["bio", /\b(?:bio|biology|biological)\b/i],
	["chem", /\b(?:chem|chemistry|chemical)\b/i],
];

/**
 * Detect provider safety-boundary responses that should be surfaced as routing decisions.
 *
 * This is intentionally separate from retry/overflow detection: classifier declines and
 * documented Mythos/Fable fallback behavior are not transient transport failures.
 */
export function detectSafetyBoundary(message: AssistantMessage): SafetyBoundaryDetection {
	const text = message.errorMessage?.trim() ?? "";
	if (text.length === 0) {
		return { isSafetyBoundary: false, fallback: false };
	}

	const hasBoundarySignal = SAFETY_CLASSIFIER_PATTERNS.some(pattern => pattern.test(text));
	const domain = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
	const fallback = FALLBACK_PATTERNS.some(pattern => pattern.test(text));

	if (!hasBoundarySignal && !domain) {
		return { isSafetyBoundary: false, fallback: false };
	}

	return {
		isSafetyBoundary: true,
		domain,
		fallback,
	};
}

/** Convenience boolean wrapper for callers that only need branching. */
export function isSafetyBoundary(message: AssistantMessage): boolean {
	return detectSafetyBoundary(message).isSafetyBoundary;
}
