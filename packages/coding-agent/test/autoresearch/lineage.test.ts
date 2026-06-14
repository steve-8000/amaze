import { describe, expect, test } from "bun:test";
import { buildExperimentState, selectNextParent } from "../../src/autoresearch/state";
import { AutoresearchStorage } from "../../src/autoresearch/storage";
import type { ExperimentResult } from "../../src/autoresearch/types";

function result(overrides: Partial<ExperimentResult>): ExperimentResult {
	return {
		runNumber: 1,
		commit: "abc",
		metric: 1,
		metrics: {},
		status: "keep",
		description: "run",
		timestamp: 1,
		segment: 0,
		confidence: null,
		modifiedPaths: [],
		scopeDeviations: [],
		justification: null,
		flagged: false,
		flaggedReason: null,
		parentRunNumber: null,
		selectionStrategy: null,
		validParent: true,
		...overrides,
	};
}

describe("autoresearch lineage", () => {
	test("selects the best valid parent in both metric directions", () => {
		const runs = [
			result({ runNumber: 1, metric: 10 }),
			result({ runNumber: 2, metric: 5 }),
			result({ runNumber: 3, metric: 1, flagged: true }),
			result({ runNumber: 4, metric: 2, status: "crash" }),
			result({ runNumber: 5, metric: 3, validParent: false }),
		];

		expect(selectNextParent(runs, 0, "lower", "best").runNumber).toBe(2);
		expect(selectNextParent(runs, 0, "higher", "best").runNumber).toBe(1);
	});

	test("score_child_prop penalizes over-explored parents", () => {
		const runs = [
			result({ runNumber: 1, metric: 0.9 }),
			result({ runNumber: 2, metric: 0.8 }),
			...Array.from({ length: 40 }, (_, index) =>
				result({ runNumber: 100 + index, metric: 0.7, parentRunNumber: 1, status: "discard" }),
			),
		];

		expect(selectNextParent(runs, 0, "higher", "score_child_prop", () => 0.99).runNumber).toBe(2);
	});

	test("persists parent metadata and projects it into state", () => {
		const storage = new AutoresearchStorage(":memory:", "/tmp/amaze-autoresearch-test");
		try {
			const session = storage.openSession({
				name: "lineage",
				goal: null,
				primaryMetric: "score",
				metricUnit: "",
				direction: "higher",
				preferredCommand: "bash autoresearch.sh",
				branch: null,
				baselineCommit: null,
				maxIterations: null,
				scopePaths: [],
				offLimits: [],
				constraints: [],
				secondaryMetrics: [],
				parentSelectionStrategy: "latest",
			});
			const parent = storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "",
				preRunDirtyPaths: [],
				startedAt: 1,
			});
			storage.markRunLogged({
				runId: parent.id,
				status: "keep",
				description: "parent",
				metric: 1,
				metrics: {},
				asi: null,
				commitHash: "parent",
				confidence: null,
				modifiedPaths: [],
				scopeDeviations: [],
				justification: null,
				loggedAt: 2,
			});
			const child = storage.insertRun({
				sessionId: session.id,
				segment: 0,
				command: "bash autoresearch.sh",
				logPath: "",
				preRunDirtyPaths: [],
				startedAt: 3,
				parentRunId: parent.id,
				selectionStrategy: "score_child_prop",
			});
			storage.markRunLogged({
				runId: child.id,
				status: "keep",
				description: "child",
				metric: 2,
				metrics: {},
				asi: null,
				commitHash: "child",
				confidence: null,
				modifiedPaths: [],
				scopeDeviations: [],
				justification: null,
				loggedAt: 4,
			});

			const projected = buildExperimentState(session, storage.listLoggedRuns(session.id));
			expect(projected.results[1]?.parentRunNumber).toBe(parent.id);
			expect(projected.results[1]?.selectionStrategy).toBe("score_child_prop");
			expect(projected.selectedParentRunNumber).not.toBeNull();
			expect(projected.parentSelectionStrategyConfigured).toBe("latest");
			expect(projected.parentSelectionStrategy).toBe("latest");
		} finally {
			storage.close();
		}
	});
});
