export type RuleSeverity = "info" | "warning" | "high" | "critical";

export type RuleTrust = "built-in" | "personal" | "project";

export interface RuleDetect {
	scan: string;
	match: string;
	aggregate: string;
	window?: unknown;
	check: string;
	thresholds?: Record<string, unknown>;
	severity?: unknown;
}

export interface Rule {
	id: string;
	name: string;
	group: string;
	severity: RuleSeverity;
	trust: RuleTrust;
	fileTypes?: string[];
	inherits?: string[];
	detect: RuleDetect;
	description: string;
	examples: string;
	howToImprove: string;
}
