import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MissionStore } from "../../src/mission/store";
import { hashExcerpt, type LaneExecutor, ResearchRunner } from "../../src/research/runner";
import { ResearchStore } from "../../src/research/store";
import type { NewResearchBrief } from "../../src/research/types";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(): { research: ResearchStore; missions: MissionStore } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-research-runner-"));
	const dbPath = path.join(root, "autonomy.db");
	const research = new ResearchStore(dbPath);
	const missions = new MissionStore(dbPath);
	cleanups.push(() => {
		missions.close();
		research.close();
		fs.rmSync(root, { recursive: true, force: true });
	});
	return { research, missions };
}

function brief(overrides: Partial<NewResearchBrief> = {}): NewResearchBrief {
	return {
		objectiveId: null,
		question: "Does the runner persist hashed evidence?",
		lanes: ["source"],
		requiredEvidence: [],
		disallowedEvidence: [],
		riskLevel: "medium",
		stopCriteria: [],
		...overrides,
	};
}

const stubExecutor =
	(cards: Array<{ excerpt: string; sourceRef: string }>): LaneExecutor =>
	async () =>
		cards.map(card => ({
			grade: "C" as const,
			sourceRef: card.sourceRef,
			excerpt: card.excerpt,
			claims: [card.excerpt],
			directness: 0.5,
			specificity: 0.5,
			recency: 0.5,
			reproducibility: 0.2,
		}));

describe("ResearchRunner", () => {
	test("executes a lane, stores evidence with content hash, completes the run", async () => {
		const { research, missions } = setup();
		const created = research.createBrief(brief());
		const runner = new ResearchRunner({
			research,
			missions,
			executors: { source: stubExecutor([{ excerpt: "fact A", sourceRef: "https://example.com/a" }]) },
		});

		const outcome = await runner.run(created.id);

		expect(outcome.ok).toBe(true);
		expect(outcome.lanes).toHaveLength(1);
		expect(outcome.lanes[0]?.status).toBe("completed");

		const evidence = research.listEvidence(created.id);
		expect(evidence).toHaveLength(1);
		expect(evidence[0]?.contentHash).toBe(hashExcerpt("fact A"));
		expect(evidence[0]?.sourceRef).toBe("https://example.com/a");

		const run = missions.getResearchRun(outcome.runId);
		expect(run?.status).toBe("completed");
		expect(run?.completedAt).not.toBeNull();
	});

	test("marks lane failed and run blocked when the executor throws", async () => {
		const { research, missions } = setup();
		const created = research.createBrief(brief());
		const runner = new ResearchRunner({
			research,
			missions,
			executors: {
				source: async () => {
					throw new Error("provider down");
				},
			},
		});

		const outcome = await runner.run(created.id);

		expect(outcome.ok).toBe(false);
		expect(outcome.lanes[0]?.status).toBe("failed");
		expect(outcome.lanes[0]?.error).toContain("provider down");
		expect(missions.getResearchRun(outcome.runId)?.status).toBe("blocked");
		const laneRuns = missions.listLaneRuns(outcome.missionId);
		expect(laneRuns.some(laneRun => laneRun.status === "failed")).toBe(true);
	});

	test("records lanes without executor as skipped/empty for manual collection", async () => {
		const { research, missions } = setup();
		const created = research.createBrief(brief({ lanes: ["repo", "source"] }));
		const runner = new ResearchRunner({
			research,
			missions,
			executors: { source: stubExecutor([{ excerpt: "doc", sourceRef: "https://example.com/doc" }]) },
		});

		const outcome = await runner.run(created.id);

		const repoLane = outcome.lanes.find(lane => lane.lane === "repo");
		const sourceLane = outcome.lanes.find(lane => lane.lane === "source");
		expect(repoLane?.status).toBe("skipped");
		expect(sourceLane?.status).toBe("completed");
		// Critic checks must flag the uncovered repo lane.
		expect(outcome.criticChecks.some(check => check.trigger === "missing-lane-evidence")).toBe(true);
	});

	test("refreshes runtime critic checks after the run", async () => {
		const { research, missions } = setup();
		const created = research.createBrief(brief({ requiredEvidence: ["primary spec"] }));
		const runner = new ResearchRunner({
			research,
			missions,
			executors: { source: stubExecutor([{ excerpt: "unrelated note", sourceRef: "https://example.com/x" }]) },
		});

		const outcome = await runner.run(created.id);

		expect(outcome.criticChecks.length).toBeGreaterThan(0);
		const persisted = research.listRuntimeCriticChecks(created.id);
		expect(persisted.length).toBe(outcome.criticChecks.length);
	});
});
