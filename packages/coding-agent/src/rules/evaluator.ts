import type { SessionEvent } from "../observability";
import { compileExpr, evaluate } from "./expr";
import type { Rule, RuleSeverity } from "./types";

export interface RuleFinding {
	ruleId: string;
	severity: RuleSeverity;
	count: number;
	windowSize: number;
	sampleEvents: SessionEvent[];
	message: string;
}

interface WindowSpec {
	last?: number;
	type?: string;
	since?: number;
}

interface SeverityBranch {
	condition?: string;
	severity: RuleSeverity;
}

const VALID_SEVERITIES = new Set<RuleSeverity>(["info", "warning", "high", "critical"]);

export function evaluateRule(rule: Rule, events: SessionEvent[]): RuleFinding | null {
	if (rule.detect.scan !== "events") {
		throw new Error(`Unsupported rule scan: ${rule.detect.scan}`);
	}
	if (!["count", "ratio", "distinct"].includes(rule.detect.aggregate)) {
		throw new Error(`Unsupported rule aggregate: ${rule.detect.aggregate}`);
	}

	const windowEvents = selectWindow(events, rule.detect.window);
	const matchExpr = compileExpr(rule.detect.match);
	const matchedEvents = windowEvents.filter(event => Boolean(evaluate(matchExpr, { $: event })));
	const count = aggregateCount(rule.detect.aggregate, matchedEvents);
	const windowSize = windowEvents.length;
	const ctx = {
		$: {},
		count,
		windowSize,
		thresholds: rule.detect.thresholds,
	};

	if (!evaluate(compileExpr(rule.detect.check), ctx)) {
		return null;
	}

	const severity = evaluateSeverity(rule, ctx);
	return {
		ruleId: rule.id,
		severity,
		count,
		windowSize,
		sampleEvents: matchedEvents.slice(0, 3),
		message: `${rule.name}: ${count} matching event${count === 1 ? "" : "s"} in ${windowSize} event window`,
	};
}

function selectWindow(events: SessionEvent[], rawWindow: unknown): SessionEvent[] {
	const window = normalizeWindow(rawWindow);
	let selected = events;
	if (window.type !== undefined) {
		selected = selected.filter(event => event.type === window.type);
	}
	if (window.since !== undefined) {
		selected = selected.filter(event => event.ts >= window.since);
	}
	if (window.last !== undefined) {
		selected = selected.slice(-window.last);
	}
	return selected;
}

function normalizeWindow(rawWindow: unknown): WindowSpec {
	if (rawWindow === undefined || rawWindow === null) {
		return {};
	}
	if (typeof rawWindow !== "object" || Array.isArray(rawWindow)) {
		throw new Error("Rule window must be an object");
	}
	const record = rawWindow as Record<string, unknown>;
	const window: WindowSpec = {};
	if (record.last !== undefined) {
		if (!Number.isInteger(record.last) || (record.last as number) < 0) {
			throw new Error("Rule window.last must be a non-negative integer");
		}
		window.last = record.last as number;
	}
	if (record.type !== undefined) {
		if (typeof record.type !== "string") {
			throw new Error("Rule window.type must be a string");
		}
		window.type = record.type;
	}
	if (record.since !== undefined) {
		if (typeof record.since !== "number" || !Number.isFinite(record.since)) {
			throw new Error("Rule window.since must be a finite number");
		}
		window.since = record.since;
	}
	return window;
}

function aggregateCount(aggregate: string, matchedEvents: SessionEvent[]): number {
	if (aggregate === "distinct") {
		return new Set(matchedEvents.map(event => event.sessionId)).size;
	}
	return matchedEvents.length;
}

function evaluateSeverity(
	rule: Rule,
	ctx: { $: unknown; count: number; windowSize: number; thresholds?: Record<string, unknown> },
): RuleSeverity {
	const branches = parseSeverityBranches(rule.detect.severity);
	for (const branch of branches) {
		if (branch.condition === undefined || evaluate(compileExpr(branch.condition), ctx)) {
			return branch.severity;
		}
	}
	return rule.severity;
}

function parseSeverityBranches(rawSeverity: unknown): SeverityBranch[] {
	if (rawSeverity === undefined || rawSeverity === null) {
		return [];
	}
	if (typeof rawSeverity !== "object" || Array.isArray(rawSeverity)) {
		throw new Error("Rule detect.severity must be an object");
	}
	const record = rawSeverity as Record<string, unknown>;
	const branches: SeverityBranch[] = [];
	for (const key of ["if", "else if", "else"] as const) {
		if (record[key] === undefined) {
			continue;
		}
		if (typeof record[key] !== "string") {
			throw new Error(`Rule detect.severity.${key} must be a string`);
		}
		branches.push(parseSeverityBranch(key, record[key]));
	}
	return branches;
}

function parseSeverityBranch(key: "if" | "else if" | "else", source: string): SeverityBranch {
	if (key === "else") {
		const match = source.match(/^\s*"(info|warning|high|critical)"\s*$/);
		if (!match) {
			throw new Error("Rule detect.severity.else must be a quoted severity");
		}
		return { severity: match[1] as RuleSeverity };
	}

	const match = source.match(/^\s*(.*?)\s+then\s+"(info|warning|high|critical)"\s*$/);
	if (!match) {
		throw new Error(`Rule detect.severity.${key} must be '<expr> then "<severity>"'`);
	}
	const severity = match[2] as RuleSeverity;
	if (!VALID_SEVERITIES.has(severity)) {
		throw new Error(`Unsupported rule severity: ${severity}`);
	}
	return { condition: match[1], severity };
}
