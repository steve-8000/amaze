/// <reference types="node" />

import type { MissionClassification, MissionSize, NormalizedRequest, RiskLevel, WorkPattern } from "./types.ts";

function clamp(value: number): number {
	return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function hasAny(keywords: Set<string>, values: string[]): boolean {
	return values.some((value) => keywords.has(value));
}

function classifyWorkPattern(normalized: NormalizedRequest, keywords: Set<string>): WorkPattern {
	if (hasAny(keywords, ["helm", "k8s", "terraform"])) return "infra";
	if (keywords.has("architecture")) return "architecture";
	if (keywords.has("docs")) return "docs";
	if (keywords.has("test")) return "test";
	if (keywords.has("refactor")) return "refactor";
	if (/\bmigration\b|마이그레이션/i.test(normalized.raw_request)) return "migration";
	if (/\bperformance\b|성능/i.test(normalized.raw_request)) return "performance";
	if (/\bsecurity\b|cve|취약/i.test(normalized.raw_request)) return "security";
	if (keywords.has("bugfix") || normalized.user_intent === "fix") return "bugfix";
	return "feature";
}

function classifyDomains(normalized: NormalizedRequest, keywords: Set<string>): string[] {
	const domains = new Set<string>();
	if (keywords.has("helm")) domains.add("helm");
	if (keywords.has("k8s")) domains.add("k8s");
	if (keywords.has("terraform")) domains.add("terraform");
	if (hasAny(keywords, ["agent", "runtime", "orchestrator", "planner", "contract", "dag"])) domains.add("agent-runtime");
	if (keywords.has("memory")) domains.add("memory");
	if (keywords.has("architecture")) domains.add("architecture");
	for (const mentionedPath of normalized.mentioned_paths) {
		if (/^charts\b|chart\.yaml|values\.ya?ml/i.test(mentionedPath)) domains.add("helm");
		if (/^infra\b|\.tf$/i.test(mentionedPath)) domains.add("infra");
		if (/packages\/coding-agent|vendor\/amaze-subagents/i.test(mentionedPath)) domains.add("agent-runtime");
	}
	return [...domains].sort();
}

function classifyRisk(normalized: NormalizedRequest, keywords: Set<string>, domains: string[]): RiskLevel {
	if (keywords.has("urgent") || /\bprod(?:uction)?\b|운영|장애|secret|rbac|auth|credential/i.test(normalized.raw_request)) return "high";
	if (domains.includes("helm") || domains.includes("k8s") || domains.includes("terraform")) return "high";
	if (hasAny(keywords, ["runtime", "resume", "checkpoint", "orchestrator", "memory"])) return "medium";
	if (normalized.mentioned_paths.length > 2) return "medium";
	return "low";
}

function classifySize(normalized: NormalizedRequest, keywords: Set<string>, workPattern: WorkPattern, domains: string[]): MissionSize {
	if (hasAny(keywords, ["runtime", "resume", "checkpoint", "orchestrator", "planner", "dag"])) return "large";
	if (workPattern === "architecture") return "large";
	if (/\blarge\b|multi[- ]path|broad|전체|대형|장기/i.test(normalized.raw_request)) return "large";
	if (workPattern === "docs" && normalized.mentioned_paths.length <= 1 && /오타|typo|하나|one/i.test(normalized.raw_request)) return "micro";
	if (domains.includes("helm") || domains.includes("k8s") || domains.includes("terraform")) return "standard";
	if (normalized.mentioned_paths.length <= 1 && /\bsmall\b|작은|간단|single file/i.test(normalized.raw_request)) return "micro";
	return "standard";
}

function computeConfidence(normalized: NormalizedRequest, keywords: Set<string>, domains: string[], size: MissionSize, risk: RiskLevel): number {
	let score = 0.5;
	if (keywords.size > 0) score += 0.16;
	if (domains.length > 0) score += 0.12;
	if (normalized.mentioned_paths.length > 0) score += 0.08;
	if (size === "micro" || size === "large") score += 0.08;
	if (risk === "high") score += 0.06;
	if (normalized.user_intent !== "modify_code") score += 0.04;
	return clamp(score);
}

export function classifyMission(normalized: NormalizedRequest, missionId: string): MissionClassification {
	const keywords = new Set(normalized.keywords);
	const workPattern = classifyWorkPattern(normalized, keywords);
	const domains = classifyDomains(normalized, keywords);
	const riskLevel = classifyRisk(normalized, keywords, domains);
	const size = classifySize(normalized, keywords, workPattern, domains);
	const requiresResearch = normalized.user_intent === "research"
		|| domains.includes("helm")
		|| domains.includes("k8s")
		|| domains.includes("terraform")
		|| /\blatest\b|최신|version|버전/i.test(normalized.raw_request);
	const requiresScouter = !(size === "micro" && workPattern === "docs" && normalized.mentioned_paths.length <= 1);
	const confidence = computeConfidence(normalized, keywords, domains, size, riskLevel);
	return {
		missionId,
		size,
		workPattern,
		domains,
		riskLevel,
		requiresResearch,
		requiresScouter,
		mentionedPaths: normalized.mentioned_paths,
		confidence,
		reason: `classified ${workPattern}/${size} from ${normalized.keywords.length} keyword signal(s) and ${domains.length} domain signal(s)`,
	};
}
