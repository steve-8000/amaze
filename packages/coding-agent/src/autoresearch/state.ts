import type { SessionEntry } from "../session/session-manager";
import { inferMetricUnitFromName, isBetter } from "./helpers";
import type { RunRow, SessionRow } from "./storage";
import type {
	AutoresearchControlEntryData,
	AutoresearchRuntime,
	ExperimentResult,
	ExperimentState,
	MetricDef,
	MetricDirection,
	NumericMetricMap,
	ReconstructedControlState,
	RuntimeStore,
	ParentSelectionStrategy,
} from "./types";

export function createExperimentState(): ExperimentState {
	return {
		results: [],
		bestMetric: null,
		bestDirection: "lower",
		metricName: "metric",
		metricUnit: "",
		secondaryMetrics: [],
		name: null,
		goal: null,
		currentSegment: 0,
		maxExperiments: null,
		confidence: null,
		scopePaths: [],
		offLimits: [],
		constraints: [],
		notes: "",
		branch: null,
		baselineCommit: null,
		sessionId: null,
		selectedParentRunNumber: null,
		parentSelectionStrategy: "score_child_prop",
		parentSelectionStrategyConfigured: "score_child_prop",
	};
}

export function createSessionRuntime(): AutoresearchRuntime {
	return {
		autoresearchMode: false,
		autoResumeArmed: false,
		dashboardExpanded: false,
		lastAutoResumePendingRunNumber: null,
		lastRunDuration: null,
		lastRunAsi: null,
		lastRunArtifactDir: null,
		lastRunNumber: null,
		lastRunSummary: null,
		runningExperiment: null,
		state: createExperimentState(),
		goal: null,
	};
}

export function cloneExperimentState(state: ExperimentState): ExperimentState {
	return {
		...state,
		results: state.results.map(cloneResult),
		secondaryMetrics: state.secondaryMetrics.map(metric => ({ ...metric })),
		scopePaths: [...state.scopePaths],
		offLimits: [...state.offLimits],
		constraints: [...state.constraints],
	};
}

function cloneResult(result: ExperimentResult): ExperimentResult {
	return {
		...result,
		metrics: { ...result.metrics },
		asi: result.asi ? structuredClone(result.asi) : undefined,
		modifiedPaths: [...result.modifiedPaths],
		scopeDeviations: [...result.scopeDeviations],
	};
}

export interface ParentSelectionResult {
	runNumber: number | null;
	strategy: ParentSelectionStrategy;
	candidateCount: number;
}

export function selectNextParent(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
	strategy: ParentSelectionStrategy = "score_child_prop",
	random: () => number = Math.random,
): ParentSelectionResult {
	const candidates = currentResults(results, segment).filter(result => isSelectableParent(result, results));
	if (candidates.length === 0) return { runNumber: null, strategy, candidateCount: 0 };
	if (strategy === "latest") {
		return { runNumber: candidates[candidates.length - 1]?.runNumber ?? null, strategy, candidateCount: candidates.length };
	}
	if (strategy === "best") {
		return { runNumber: bestCandidate(candidates, direction)?.runNumber ?? null, strategy, candidateCount: candidates.length };
	}
	if (strategy === "random") {
		return { runNumber: pickWeighted(candidates, candidates.map(() => 1), random)?.runNumber ?? null, strategy, candidateCount: candidates.length };
	}

	const weights = scoreWeights(candidates, direction);
	if (strategy === "score_child_prop") {
		const childCounts = countChildren(results, candidates);
		for (let index = 0; index < weights.length; index += 1) {
			const runNumber = candidates[index]?.runNumber;
			const children = runNumber === null || runNumber === undefined ? 0 : (childCounts.get(runNumber) ?? 0);
			weights[index] = (weights[index] ?? 0) * Math.exp(-((children / 8) ** 3));
		}
	}
	return { runNumber: pickWeighted(candidates, weights, random)?.runNumber ?? null, strategy, candidateCount: candidates.length };
}

function isSelectableParent(result: ExperimentResult, allResults: ExperimentResult[]): boolean {
	if (result.status !== "keep" || result.flagged || !result.validParent || !Number.isFinite(result.metric)) return false;
	if (result.parentRunNumber === null) return true;
	const parent = allResults.find(candidate => candidate.runNumber === result.parentRunNumber);
	return parent?.status === "keep" && !parent.flagged && parent.validParent;
}

function bestCandidate(candidates: ExperimentResult[], direction: MetricDirection): ExperimentResult | null {
	let best: ExperimentResult | null = null;
	for (const candidate of candidates) {
		if (best === null || isBetter(candidate.metric, best.metric, direction)) best = candidate;
	}
	return best;
}

function scoreWeights(candidates: ExperimentResult[], direction: MetricDirection): number[] {
	const scores = candidates.map(candidate => candidate.metric);
	const normalized = direction === "higher" ? scores : scores.map(score => -score);
	const sorted = [...normalized].sort((left, right) => right - left);
	const top = sorted.slice(0, 3);
	const midpoint = top.reduce((sum, value) => sum + value, 0) / top.length;
	return normalized.map(score => 1 / (1 + Math.exp(-10 * (score - midpoint))));
}

function countChildren(results: ExperimentResult[], candidates: ExperimentResult[]): Map<number, number> {
	const candidateIds = new Set(candidates.map(candidate => candidate.runNumber).filter((value): value is number => value !== null));
	const counts = new Map<number, number>();
	for (const result of results) {
		if (result.parentRunNumber !== null && candidateIds.has(result.parentRunNumber)) {
			counts.set(result.parentRunNumber, (counts.get(result.parentRunNumber) ?? 0) + 1);
		}
	}
	return counts;
}

function pickWeighted(candidates: ExperimentResult[], weights: number[], random: () => number): ExperimentResult | null {
	const total = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0);
	if (total <= 0) return candidates[Math.floor(random() * candidates.length)] ?? null;
	let threshold = random() * total;
	for (let index = 0; index < candidates.length; index += 1) {
		threshold -= weights[index] ?? 0;
		if (threshold <= 0) return candidates[index] ?? null;
	}
	return candidates[candidates.length - 1] ?? null;
}

export function currentResults(results: ExperimentResult[], segment: number): ExperimentResult[] {
	return results.filter(result => result.segment === segment);
}

export function findBaselineResult(results: ExperimentResult[], segment: number): ExperimentResult | null {
	return currentResults(results, segment).find(result => result.status === "keep" && !result.flagged) ?? null;
}

export function findBaselineMetric(results: ExperimentResult[], segment: number): number | null {
	return findBaselineResult(results, segment)?.metric ?? null;
}

export function findBestKeptMetric(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	let best: number | null = null;
	for (const result of currentResults(results, segment)) {
		if (result.status !== "keep" || result.flagged) continue;
		if (best === null || isBetter(result.metric, best, direction)) {
			best = result.metric;
		}
	}
	return best;
}

export function findBaselineRunNumber(results: ExperimentResult[], segment: number): number | null {
	const baseline = findBaselineResult(results, segment);
	if (!baseline) return null;
	if (baseline.runNumber !== null) return baseline.runNumber;
	const index = results.indexOf(baseline);
	return index >= 0 ? index + 1 : null;
}

export function findBaselineSecondary(
	results: ExperimentResult[],
	segment: number,
	knownMetrics: MetricDef[],
): NumericMetricMap {
	const baseline = findBaselineResult(results, segment);
	const values: NumericMetricMap = baseline ? { ...baseline.metrics } : {};
	for (const metric of knownMetrics) {
		if (values[metric.name] !== undefined) continue;
		for (const result of currentResults(results, segment)) {
			if (result.flagged) continue;
			const value = result.metrics[metric.name];
			if (value !== undefined) {
				values[metric.name] = value;
				break;
			}
		}
	}
	return values;
}

export function sortedMedian(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const midpoint = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
	}
	return sorted[midpoint];
}

export function computeConfidence(
	results: ExperimentResult[],
	segment: number,
	direction: MetricDirection,
): number | null {
	const current = currentResults(results, segment).filter(result => !result.flagged && result.metric > 0);
	if (current.length < 3) return null;

	const values = current.map(result => result.metric);
	const median = sortedMedian(values);
	const mad = sortedMedian(values.map(value => Math.abs(value - median)));
	if (mad === 0) return null;

	const baseline = findBaselineMetric(results, segment);
	if (baseline === null) return null;

	let bestKept: number | null = null;
	for (const result of current) {
		if (result.status !== "keep" || result.metric <= 0) continue;
		if (bestKept === null || isBetter(result.metric, bestKept, direction)) {
			bestKept = result.metric;
		}
	}
	if (bestKept === null || bestKept === baseline) return null;

	return Math.abs(bestKept - baseline) / mad;
}

export function buildExperimentState(session: SessionRow, loggedRuns: RunRow[]): ExperimentState {
	const state = createExperimentState();
	state.name = session.name;
	state.goal = session.goal;
	state.metricName = session.primaryMetric;
	state.metricUnit = session.metricUnit;
	state.bestDirection = session.direction;
	state.scopePaths = [...session.scopePaths];
	state.offLimits = [...session.offLimits];
	state.constraints = [...session.constraints];
	state.notes = session.notes;
	state.branch = session.branch;
	state.baselineCommit = session.baselineCommit;
	state.sessionId = session.id;
	state.maxExperiments = session.maxIterations;
	state.currentSegment = session.currentSegment;
	state.secondaryMetrics = session.secondaryMetrics.map(name => ({ name, unit: inferMetricUnitFromName(name) }));
	state.parentSelectionStrategyConfigured = session.parentSelectionStrategy;

	for (const run of loggedRuns) {
		if (run.status === null) continue;
		const result: ExperimentResult = {
			runNumber: run.id,
			commit: run.commitHash ?? "",
			metric: run.metric ?? 0,
			metrics: run.metrics ?? {},
			status: run.status,
			description: run.description ?? "",
			timestamp: run.loggedAt ?? run.startedAt,
			segment: run.segment,
			confidence: run.confidence,
			asi: run.asi ?? undefined,
			modifiedPaths: run.modifiedPaths ?? [],
			scopeDeviations: run.scopeDeviations ?? [],
			justification: run.justification,
			flagged: run.flagged,
			flaggedReason: run.flaggedReason,
			parentRunNumber: run.parentRunId,
			selectionStrategy: run.selectionStrategy,
			validParent: run.validParent,
		};
		state.results.push(result);
		if (run.segment === state.currentSegment) {
			registerSecondaryMetrics(state.secondaryMetrics, result.metrics);
		}
	}

	state.bestMetric = findBaselineMetric(state.results, state.currentSegment);
	state.confidence = computeConfidence(state.results, state.currentSegment, state.bestDirection);
	const parent = selectNextParent(state.results, state.currentSegment, state.bestDirection, state.parentSelectionStrategyConfigured);
	state.selectedParentRunNumber = parent.runNumber;
	state.parentSelectionStrategy = parent.strategy;
	return state;
}

export function reconstructControlState(entries: SessionEntry[]): ReconstructedControlState {
	let autoresearchMode = false;
	let goal: string | null = null;
	let lastMode: ReconstructedControlState["lastMode"] = null;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "autoresearch-control") continue;
		const data = parseControlEntry(entry.data);
		if (!data) continue;
		lastMode = data.mode;
		autoresearchMode = data.mode === "on";
		goal = data.goal ?? goal;
		if (data.mode === "clear") {
			goal = null;
		}
	}
	return { autoresearchMode, goal, lastMode };
}

export function createRuntimeStore(): RuntimeStore {
	const runtimes = new Map<string, AutoresearchRuntime>();
	return {
		clear(sessionKey: string): void {
			runtimes.delete(sessionKey);
		},
		ensure(sessionKey: string): AutoresearchRuntime {
			const existing = runtimes.get(sessionKey);
			if (existing) return existing;
			const runtime = createSessionRuntime();
			runtimes.set(sessionKey, runtime);
			return runtime;
		},
	};
}

function registerSecondaryMetrics(metrics: MetricDef[], values: NumericMetricMap): void {
	for (const name of Object.keys(values)) {
		if (metrics.some(metric => metric.name === name)) continue;
		metrics.push({
			name,
			unit: inferMetricUnitFromName(name),
		});
	}
}

function parseControlEntry(value: unknown): AutoresearchControlEntryData | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as { goal?: unknown; mode?: unknown };
	if (candidate.mode !== "on" && candidate.mode !== "off" && candidate.mode !== "clear") return null;
	const data: AutoresearchControlEntryData = { mode: candidate.mode };
	if (typeof candidate.goal === "string" && candidate.goal.trim().length > 0) {
		data.goal = candidate.goal;
	}
	return data;
}
