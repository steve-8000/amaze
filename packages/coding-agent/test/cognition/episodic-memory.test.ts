import { afterEach, describe, expect, test } from "bun:test";
import {
	deriveEpisode,
	episodesForObjective,
	heuristicsForPlanning,
	learnFromMissionOutcome,
	type MissionOutcomeSnapshot,
	recordEpisode,
} from "../../src/cognition";
import { episodeMarker } from "../../src/cognition/learner";
import { KnowledgeStore } from "../../src/memory/knowledge-store";
import { MissionStore } from "../../src/mission/store";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function knowledgeStore(): KnowledgeStore {
	const store = new KnowledgeStore(":memory:");
	cleanups.push(() => store.close());
	return store;
}

function missionStore(): MissionStore {
	const store = new MissionStore(":memory:");
	cleanups.push(() => store.close());
	return store;
}

function snapshot(over: Partial<MissionOutcomeSnapshot> = {}): MissionOutcomeSnapshot {
	return {
		missionId: "mission-1",
		objective: "Reduce flaky integration tests in the payments module",
		status: "success",
		checkpoints: [],
		verificationVerdict: "pass",
		...over,
	};
}

describe("deriveEpisode", () => {
	test("captures status, verdict, and checkpoint tallies with a mission marker", () => {
		const episode = deriveEpisode(snapshot({ status: "failure", verificationVerdict: "fail" }));
		expect(episode.claim).toContain(episodeMarker("mission-1"));
		expect(episode.claim).toContain("status=failure");
		expect(episode.claim).toContain("verdict=fail");
		expect(episode.claim.startsWith("EPISODE ")).toBe(true);
		expect(episode.sourceRefs).toEqual(["mission://mission-1"]);
	});

	test("a successful mission yields high confidence; otherwise medium", () => {
		expect(deriveEpisode(snapshot({ status: "success" })).confidence).toBe("high");
		expect(deriveEpisode(snapshot({ status: "blocked" })).confidence).toBe("medium");
	});
});

describe("recordEpisode", () => {
	test("persists an episode at mission scope and is idempotent per mission", () => {
		const knowledge = knowledgeStore();
		const first = recordEpisode(snapshot(), knowledge);
		const second = recordEpisode(snapshot(), knowledge);

		expect(first).toBeDefined();
		expect(second).toBeUndefined(); // idempotent: same mission id skipped
		const stored = knowledge.query({ scope: "mission", activeOnly: true });
		expect(stored).toHaveLength(1);
		expect(stored[0]?.scope).toBe("mission");
	});

	test("episodes do NOT leak into global heuristic planning context", () => {
		const knowledge = knowledgeStore();
		recordEpisode(snapshot(), knowledge);
		// heuristicsForPlanning reads global scope only.
		expect(heuristicsForPlanning(knowledge)).toEqual([]);
	});
});

describe("episodesForObjective", () => {
	test("recalls past episodes matching the objective text", () => {
		const knowledge = knowledgeStore();
		recordEpisode(snapshot({ missionId: "m-a", objective: "Improve payments retry logic" }), knowledge);
		recordEpisode(snapshot({ missionId: "m-b", objective: "Rewrite the search indexer" }), knowledge);

		const recalled = episodesForObjective(knowledge, "payments retry");
		expect(recalled).toHaveLength(1);
		expect(recalled[0]).toContain("[mission:m-a]");
	});

	test("returns all episodes when the objective filter is empty", () => {
		const knowledge = knowledgeStore();
		recordEpisode(snapshot({ missionId: "m-a" }), knowledge);
		recordEpisode(snapshot({ missionId: "m-b" }), knowledge);
		expect(episodesForObjective(knowledge, "   ")).toHaveLength(2);
	});
});

describe("learnFromMissionOutcome episodic integration", () => {
	test("records both global heuristics and a mission-scoped episode", () => {
		const missions = missionStore();
		const knowledge = knowledgeStore();
		const mission = missions.createMission({
			title: "Episodic integration",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "completed",
			confidence: null,
			snapshotRef: null,
		});

		learnFromMissionOutcome({ missions, knowledge }, snapshot({ missionId: mission.id }));

		// Episode lives at mission scope...
		const episodes = knowledge.query({ scope: "mission", activeOnly: true });
		expect(episodes.some(e => e.claim.includes(episodeMarker(mission.id)))).toBe(true);
		// ...and a clean-success heuristic lives at global scope (proves both paths ran).
		expect(knowledge.query({ scope: "global", activeOnly: true }).length).toBeGreaterThan(0);
	});
});
