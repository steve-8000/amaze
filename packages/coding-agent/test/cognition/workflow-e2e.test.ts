/**
 * End-to-end cognition workflow simulation: the "develop from docs" scenario.
 *
 * Validates the full autonomous loop over real stores (no mocks except the LLM
 * seam): mission creation → research with hashed evidence → goal decomposition
 * with heuristic injection → critic rejection → replanning → execution
 * checkpoints → mission outcome → learning → next mission benefits.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { learnFromTerminalMission, openRuntimeKnowledge, planMission, replanMission } from "../../src/cognition";
import type { PlannerLlm } from "../../src/cognition/planner";
import { Settings } from "../../src/config/settings";
import { KnowledgeStore } from "../../src/memory/knowledge-store";
import { MissionStore } from "../../src/mission/store";
import { ResearchRunner } from "../../src/research/runner";
import { ResearchStore } from "../../src/research/store";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("docs-driven development workflow (e2e over real stores)", () => {
	test("research → plan → critic reject → replan → fail → learn → next mission improves", async () => {
		// Shared autonomy DB (research store resolves the brief's mission through
		// the same SQLite file, so :memory: per-store would split the universe).
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-cognition-e2e-"));
		cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
		const dbPath = path.join(root, "autonomy.db");
		const missions = new MissionStore(dbPath);
		const research = new ResearchStore(dbPath);
		const knowledge = new KnowledgeStore(path.join(root, "knowledge.db"));
		cleanups.push(() => {
			missions.close();
			research.close();
			knowledge.close();
		});

		// ── 1. User: "docs를 보고 개발을 진행해줘" → mission + research brief.
		const mission = missions.createMission({
			title: "Implement feature from docs",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});

		const brief = research.createBrief({
			objectiveId: null,
			question: "What does the docs spec require for the feature?",
			lanes: ["source"],
			requiredEvidence: [],
			disallowedEvidence: [],
			riskLevel: "medium",
			stopCriteria: [],
		});

		// ── 2. Research runs automatically; evidence lands with content hashes.
		const runner = new ResearchRunner({
			research,
			missions,
			executors: {
				source: async () => [
					{
						grade: "B" as const,
						sourceRef: "docs/feature-spec.md",
						excerpt: "The feature must expose a validate() API returning typed errors.",
						claims: ["spec requires validate() with typed errors"],
						directness: 0.9,
						specificity: 0.8,
						recency: 1,
						reproducibility: 0.7,
					},
				],
			},
		});
		const researchOutcome = await runner.run(brief.id);
		expect(researchOutcome.ok).toBe(true);
		const evidence = research.listEvidence(brief.id);
		expect(evidence).toHaveLength(1);
		expect(evidence[0]?.contentHash).toBeTruthy();

		// ── 3. Planner decomposes the objective (evidence informs the prompt upstream).
		const planLlm: PlannerLlm = async () =>
			JSON.stringify({
				rationale: "implement per docs spec",
				steps: [
					{ id: "s1", description: "read docs spec and define validate() types", dependsOn: [] },
					{ id: "s2", description: "implement validate()", dependsOn: ["s1"] },
				],
			});
		const planned = await planMission(
			{ missions, knowledge, llm: planLlm },
			{ missionId: mission.id, objective: "Implement the documented feature" },
		);
		expect(planned.plan.revision).toBe(1);
		expect(missions.getPlan(mission.id)?.steps).toHaveLength(2);

		// ── 4. Critic rejects step 2 as unverifiable → replan to revision 2.
		const replanLlm: PlannerLlm = async (_s, user) => {
			expect(user).toContain("<critic-feedback>");
			return JSON.stringify({
				rationale: "split implementation from verification",
				steps: [
					{ id: "s1", description: "define validate() types from docs", dependsOn: [] },
					{ id: "s2", description: "implement validate()", dependsOn: ["s1"] },
					{ id: "s3", description: "add tests asserting typed errors", dependsOn: ["s2"] },
				],
			});
		};
		const replanned = await replanMission(
			{ missions, knowledge, llm: replanLlm },
			{
				missionId: mission.id,
				objective: "Implement the documented feature",
				criticFeedback: ["step s2 has no verification step backing it"],
			},
		);
		expect(replanned.plan.revision).toBe(2);
		// Decomposition trail is in the world model: 2 plan actions.
		expect(missions.listWorldModel(mission.id).filter(r => r.kind === "action")).toHaveLength(2);

		// ── 5. Execution produces repeated contract failures (observable checkpoints).
		for (const attempt of [1, 2]) {
			missions.recordTaskAttemptCheckpoint({
				missionId: mission.id,
				taskId: "t-impl",
				agent: "Builder",
				role: "builder",
				attempt,
				status: "failed",
				failureMode: "contract-fail",
				lastVerdict: "fail",
				failedCount: 1,
				uncertainCount: 0,
				remediationAction: "retry",
				sessionFile: null,
				artifactRefs: [],
				error: "validate() returned untyped errors",
			});
		}

		// ── 6. Mission terminalizes; learner derives heuristics from the trail.
		const learnResult = learnFromTerminalMission(
			{ missions, knowledge },
			{
				id: mission.id,
				objective: "Implement the documented feature",
				outcome: { status: "failed" },
				verification: { verdict: "fail" },
			},
		);
		expect(learnResult?.recorded.length).toBeGreaterThanOrEqual(1);
		// Heuristic is persisted at L5 with mission provenance.
		const heuristics = knowledge.query({ scope: "global" });
		expect(heuristics.length).toBeGreaterThanOrEqual(1);
		expect(heuristics[0]?.sourceRefs).toContain(`mission://${mission.id}`);
		// And mirrored into the failed mission's world model as an outcome.
		expect(missions.listWorldModel(mission.id).some(r => r.kind === "outcome" && r.outcomeStatus === "fail")).toBe(
			true,
		);

		// ── 7. The NEXT mission's planner automatically sees the lesson.
		const nextMission = missions.createMission({
			title: "Implement second documented feature",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});
		let nextPrompt = "";
		const nextLlm: PlannerLlm = async (_s, user) => {
			nextPrompt = user;
			return JSON.stringify({
				steps: [{ id: "s1", description: "scoped first step", dependsOn: [] }],
			});
		};
		const nextPlanned = await planMission(
			{ missions, knowledge, llm: nextLlm },
			{ missionId: nextMission.id, objective: "Implement another documented feature" },
		);
		expect(nextPlanned.injectedHeuristics).toBeGreaterThanOrEqual(1);
		expect(nextPrompt).toContain("<learned-heuristics>");
		expect(nextPrompt).toContain("narrower file scope");
	});

	test("okf runtime memory persists lessons and feeds the next plan", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-okf-cognition-e2e-"));
		cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
		const dbPath = path.join(root, "autonomy.db");
		const missions = new MissionStore(dbPath);
		const knowledge = openRuntimeKnowledge(
			Settings.isolated({
				"knowledge.enabled": true,
				"knowledge.provider": "okf",
				"knowledge.okfPath": path.join(root, "okf-documents.json"),
			}),
		);
		cleanups.push(() => {
			missions.close();
			knowledge.close();
		});

		const mission = missions.createMission({
			title: "Implement feature with okf memory",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});

		const initialLlm: PlannerLlm = async () =>
			JSON.stringify({
				steps: [{ id: "s1", description: "implement validate()", dependsOn: [] }],
			});
		await planMission({ missions, knowledge: knowledge.knowledge, llm: initialLlm }, { missionId: mission.id, objective: "x" });

		for (const attempt of [1, 2]) {
			missions.recordTaskAttemptCheckpoint({
				missionId: mission.id,
				taskId: "t-impl",
				agent: "Builder",
				role: "builder",
				attempt,
				status: "failed",
				failureMode: "contract-fail",
				lastVerdict: "fail",
				failedCount: 1,
				uncertainCount: 0,
				remediationAction: "retry",
				sessionFile: null,
				artifactRefs: [],
				error: "returned untyped errors",
			});
		}

		const learned = learnFromTerminalMission(
			{ missions, knowledge: knowledge.knowledge },
			{
				id: mission.id,
				objective: "x",
				outcome: { status: "failed" },
				verification: { verdict: "fail" },
			},
		);
		expect(learned?.recorded.length).toBeGreaterThanOrEqual(1);
		const stored = knowledge.knowledge.query({ scope: "global", activeOnly: true, limit: 10 });
		expect(stored.length).toBeGreaterThanOrEqual(1);

		const nextMission = missions.createMission({
			title: "Next mission with okf memory",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "drafting",
			confidence: null,
			snapshotRef: null,
		});
		let nextPrompt = "";
		const nextLlm: PlannerLlm = async (_s, user) => {
			nextPrompt = user;
			return JSON.stringify({
				steps: [{ id: "s1", description: "scoped first step", dependsOn: [] }],
			});
		};
		const planned = await planMission(
			{ missions, knowledge: knowledge.knowledge, llm: nextLlm },
			{ missionId: nextMission.id, objective: "y" },
		);
		expect(planned.injectedHeuristics).toBeGreaterThanOrEqual(1);
		expect(nextPrompt).toContain("narrower file scope");
	});

	test("learnFromTerminalMission is a no-op without a recorded outcome", () => {
		const missions = new MissionStore(":memory:");
		const knowledge = new KnowledgeStore(":memory:");
		cleanups.push(() => {
			missions.close();
			knowledge.close();
		});
		const mission = missions.createMission({
			title: "No outcome yet",
			objectiveId: null,
			briefId: null,
			decisionId: null,
			riskLevel: "medium",
			state: "executing",
			confidence: null,
			snapshotRef: null,
		});
		const result = learnFromTerminalMission(
			{ missions, knowledge },
			{ id: mission.id, objective: "x", outcome: undefined },
		);
		expect(result).toBeUndefined();
		expect(knowledge.query({ scope: "global" })).toHaveLength(0);
	});
});
