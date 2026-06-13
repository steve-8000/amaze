import { type AgiEvalId, type AgiEvalRunResult, type AgiEvalSpec, REQUIRED_AGI_EVAL_IDS } from "./eval-suite";

export interface AgiEvalCaseResult {
	passed: boolean;
	metrics: Record<string, { value: number | string; passed: boolean; evidenceRefs: string[] }>;
	blockers?: string[];
	humanReviewRefs?: string[];
}

export interface AgiEvalCase {
	spec: AgiEvalSpec;
	run(): Promise<AgiEvalCaseResult> | AgiEvalCaseResult;
}

export interface AgiEvalRunnerResult {
	passed: boolean;
	results: AgiEvalRunResult[];
	missingEvalIds: AgiEvalId[];
}

export class AgiEvalRunner {
	readonly #cases: Map<AgiEvalId, AgiEvalCase>;
	readonly #now: () => number;

	constructor(cases: AgiEvalCase[], now: () => number = Date.now) {
		this.#cases = new Map(cases.map(testCase => [testCase.spec.id, testCase]));
		this.#now = now;
	}

	async run(requiredIds: readonly AgiEvalId[] = REQUIRED_AGI_EVAL_IDS): Promise<AgiEvalRunnerResult> {
		const results: AgiEvalRunResult[] = [];
		const missingEvalIds: AgiEvalId[] = [];
		for (const id of requiredIds) {
			const testCase = this.#cases.get(id);
			if (!testCase) {
				missingEvalIds.push(id);
				continue;
			}
			const result = await testCase.run();
			results.push({
				specId: id,
				datasetVersion: testCase.spec.dataset.version,
				passed: result.passed && Object.values(result.metrics).every(metric => metric.passed),
				metricResults: result.metrics,
				blockers: result.blockers ?? [],
				humanReviewRefs: result.humanReviewRefs ?? [],
				createdAt: this.#now(),
			});
		}
		return {
			passed: missingEvalIds.length === 0 && results.every(result => result.passed),
			results,
			missingEvalIds,
		};
	}
}
