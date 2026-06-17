/// <reference types="node" />

import { BASE_RUNTIME_MANIFESTS, DOMAIN_OVERLAY_PROFILES, MAX_DOMAIN_OVERLAYS } from "./profile-catalog.ts";
import type { BaseRuntime, MissionClassification, NormalizedRequest, ProfileRoute, ValidatorPack } from "./types.ts";

interface RuntimeScore {
	runtime: BaseRuntime;
	score: number;
	reason: string;
}

function clamp(value: number): number {
	return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function hasKeyword(normalized: NormalizedRequest | undefined, keyword: string): boolean {
	return normalized?.keywords.includes(keyword) ?? false;
}

function hasDomain(classification: MissionClassification, domain: string): boolean {
	return classification.domains.includes(domain);
}

function triggerScore(runtime: BaseRuntime, classification: MissionClassification, normalized?: NormalizedRequest): RuntimeScore {
	let score = 0.35;
	const reasons: string[] = [];
	if (runtime === "micro-direct" && classification.size === "micro") {
		score += 0.46;
		reasons.push("micro size");
	}
	if (runtime === "standard-contract" && classification.size === "standard") {
		score += 0.2;
		reasons.push("standard size");
	}
	if (runtime === "large-mission" && classification.size === "large") {
		score += 0.32;
		reasons.push("large size");
	}
	if (runtime === "large-mission" && hasDomain(classification, "agent-runtime")) {
		score += 0.2;
		reasons.push("agent runtime domain");
	}
	if (runtime === "infra-k8s" && (hasDomain(classification, "helm") || hasDomain(classification, "k8s") || hasDomain(classification, "terraform"))) {
		score += 0.45;
		reasons.push("infra domain");
	}
	if (runtime === "research-first" && classification.requiresResearch && !hasDomain(classification, "helm") && !hasDomain(classification, "k8s")) {
		score += 0.3;
		reasons.push("research required");
	}
	if (runtime === "architecture-design" && classification.workPattern === "architecture") {
		score += 0.42;
		reasons.push("architecture pattern");
	}
	if (runtime === "emergency-hotfix" && (classification.riskLevel === "high" && hasKeyword(normalized, "urgent"))) {
		score += 0.44;
		reasons.push("urgent high risk");
	}
	if (runtime === "exploration-only" && normalized?.user_intent === "explore") {
		score += 0.42;
		reasons.push("exploration intent");
	}
	if (runtime === "standard-contract") {
		score += classification.confidence < 0.75 ? 0.12 : 0.04;
		reasons.push("safe fallback");
	}
	if (classification.riskLevel === "high" && runtime === "micro-direct") score -= 0.25;
	if (classification.size === "large" && runtime === "micro-direct") score -= 0.35;
	return {
		runtime,
		score: clamp(score),
		reason: reasons.join(", ") || "catalog fallback",
	};
}

function selectBaseRuntime(classification: MissionClassification, normalized?: NormalizedRequest): RuntimeScore {
	const candidates = BASE_RUNTIME_MANIFESTS.map((manifest) => triggerScore(manifest.id as BaseRuntime, classification, normalized))
		.sort((a, b) => b.score - a.score);
	const selected = candidates[0];
	if (!selected || classification.confidence < 0.45) {
		return { runtime: "standard-contract", score: 0.45, reason: "low confidence fallback" };
	}
	if (classification.confidence < 0.75 && selected.score < 0.8) {
		return { runtime: "standard-contract", score: Math.max(0.55, selected.score), reason: `conservative fallback from ${selected.runtime}` };
	}
	return selected;
}

function selectOverlays(classification: MissionClassification, normalized?: NormalizedRequest): string[] {
	const scored = Object.values(DOMAIN_OVERLAY_PROFILES).map((overlay) => {
		let score = 0;
		for (const trigger of overlay.triggers) {
			const normalizedTrigger = trigger.toLowerCase();
			if (normalized?.keywords.includes(normalizedTrigger)) score += 2;
			if (classification.domains.includes(normalizedTrigger)) score += 2;
			if (classification.reason.toLowerCase().includes(normalizedTrigger)) score += 1;
			if (normalized?.raw_request.toLowerCase().includes(normalizedTrigger)) score += 1;
		}
		if (overlay.id === "path-specialist-harness" && classification.domains.includes("agent-runtime")) score += 3;
		if (overlay.id === "persistent-agent-runtime" && classification.domains.includes("agent-runtime")) score += 3;
		if (overlay.id === "k8s-validator-operator" && (classification.domains.includes("helm") || classification.domains.includes("k8s"))) score += 4;
		if (overlay.id === "final-architecture-first" && classification.workPattern === "architecture") score += 3;
		return { id: overlay.id, score };
	}).filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	return scored.slice(0, MAX_DOMAIN_OVERLAYS).map((item) => item.id);
}

function selectValidatorPack(runtime: BaseRuntime, classification: MissionClassification): ValidatorPack {
	if (classification.workPattern === "security") return "security-audit";
	if (runtime === "infra-k8s" || classification.workPattern === "infra") return "infra-k8s";
	if (runtime === "research-first" || classification.requiresResearch) return "research-evidence";
	if (runtime === "architecture-design" || classification.workPattern === "architecture") return "architecture-review";
	if (runtime === "large-mission") return "integration-heavy";
	if (runtime === "micro-direct") return "basic-diff";
	return classification.riskLevel === "high" ? "strict-boundary" : "standard-code";
}

function fallbackRuntime(runtime: BaseRuntime): BaseRuntime {
	if (runtime === "large-mission") return "standard-contract";
	if (runtime === "standard-contract") return "large-mission";
	if (runtime === "research-first") return "standard-contract";
	if (runtime === "architecture-design") return "standard-contract";
	if (runtime === "infra-k8s") return "standard-contract";
	return "standard-contract";
}

export function routeProfiles(classification: MissionClassification, normalized?: NormalizedRequest): ProfileRoute {
	const selected = selectBaseRuntime(classification, normalized);
	const baseRuntime = selected.runtime;
	const validatorPack = selectValidatorPack(baseRuntime, classification);
	return {
		baseRuntime,
		workPattern: classification.workPattern,
		domainOverlays: selectOverlays(classification, normalized),
		validatorPack,
		confidence: clamp(Math.max(classification.confidence, selected.score)),
		reason: `${selected.reason}; validator=${validatorPack}`,
		fallbackRuntime: fallbackRuntime(baseRuntime),
	};
}
