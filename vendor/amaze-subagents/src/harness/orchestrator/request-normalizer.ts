/// <reference types="node" />

import type { NormalizedRequest } from "./types.ts";

const PATH_PATTERN = /(?:^|\s|`)([A-Za-z0-9_.@~/-]+\/[A-Za-z0-9_.@~/-]*|(?:Chart|values|package|tsconfig)\.json|Chart\.yaml|values\.ya?ml)(?=\s|`|$|[,.):])/g;

const KEYWORD_PATTERNS: Array<[string, RegExp]> = [
	["helm", /\bhelm\b|chart\.yaml|values\.ya?ml/i],
	["k8s", /\bk8s\b|\bkubernetes\b|\bkube\b/i],
	["terraform", /\bterraform\b|\.tf\b/i],
	["runtime", /\bruntime\b|런타임/i],
	["resume", /\bresume\b|재개|이어/i],
	["checkpoint", /\bcheckpoint\b|체크포인트/i],
	["orchestrator", /\borchestrator\b|오케스트레이터/i],
	["planner", /\bplanner\b|플래너/i],
	["contract", /\bcontract\b|계약/i],
	["dag", /\bdag\b/i],
	["memory", /\bmemory\b|메모리/i],
	["agent", /\bagent\b|에이전트/i],
	["architecture", /\barchitecture\b|\bdesign\b|설계/i],
	["research", /\bresearch\b|조사|최신|문서/i],
	["bugfix", /\bbug\b|\bfix\b|broken|error|오류|고쳐|수정/i],
	["feature", /\bfeature\b|add|implement|만들|추가|구현/i],
	["refactor", /\brefactor\b|리팩터|개선/i],
	["test", /\btest\b|테스트/i],
	["docs", /\breadme\b|docs?|문서|오타/i],
	["urgent", /\burgent\b|emergency|hotfix|긴급|장애/i],
	["explore", /\bexplore\b|look into|investigate|파악|조사만/i],
];

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function extractMentionedPaths(rawRequest: string): string[] {
	const paths: string[] = [];
	for (const match of rawRequest.matchAll(PATH_PATTERN)) {
		const candidate = match[1]?.trim().replace(/^`|`$/g, "");
		if (candidate) paths.push(candidate);
	}
	if (/\bhelm chart\b/i.test(rawRequest) || /Helm chart/i.test(rawRequest)) paths.push("charts/**");
	if (/\bterraform\b/i.test(rawRequest)) paths.push("infra/**");
	if (/\breadme\b/i.test(rawRequest)) paths.push("README*");
	return unique(paths);
}

export function extractKeywords(rawRequest: string): string[] {
	const keywords: string[] = [];
	for (const [keyword, pattern] of KEYWORD_PATTERNS) {
		if (pattern.test(rawRequest)) keywords.push(keyword);
	}
	return unique(keywords);
}

export function inferUserIntent(rawRequest: string, keywords = extractKeywords(rawRequest)): NormalizedRequest["user_intent"] {
	const keywordSet = new Set(keywords);
	if (keywordSet.has("explore") && !keywordSet.has("feature") && !keywordSet.has("bugfix")) return "explore";
	if (keywordSet.has("research")) return "research";
	if (keywordSet.has("architecture")) return "design";
	if (keywordSet.has("helm") || keywordSet.has("k8s") || keywordSet.has("terraform")) return "modify_infra_config";
	if (keywordSet.has("bugfix") || keywordSet.has("urgent")) return "fix";
	if (keywordSet.has("test")) return "test";
	if (keywordSet.has("docs")) return "docs";
	return "modify_code";
}

export function normalizeRequest(rawRequest: string): NormalizedRequest {
	const trimmed = rawRequest.trim();
	const keywords = extractKeywords(trimmed);
	return {
		raw_request: trimmed,
		mentioned_paths: extractMentionedPaths(trimmed),
		keywords,
		user_intent: inferUserIntent(trimmed, keywords),
	};
}
