import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MissionStore } from "../../src/mission/store";
import { MissionControlView } from "../../src/modes/components/mission-control-view";
import { ResearchStore } from "../../src/research/store";

const cleanup: Array<() => void> = [];

afterEach(() => {
	for (const item of cleanup.splice(0).reverse()) {
		item();
	}
});

function tempDb(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amaze-mission-control-view-"));
	cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
	return path.join(root, "autonomy.db");
}

describe("MissionControlView", () => {
	test("renders panelized mission summary with lanes and evidence", () => {
		const dbPath = tempDb();
		const research = new ResearchStore(dbPath);
		const brief = research.createBrief({
			id: "brief-1",
			objectiveId: "objective-1",
			question: "Improve mission control",
			lanes: ["repo"],
			requiredEvidence: [],
			disallowedEvidence: [],
			riskLevel: "medium",
			stopCriteria: [],
		});
		research.addEvidence({
			id: "ev-1",
			briefId: brief.id,
			lane: "repo",
			grade: "A",
			sourceRef: "src/file.ts:1",
			excerpt: "mission evidence",
			claims: ["claim"],
			directness: 1,
			specificity: 1,
			recency: 1,
			reproducibility: 1,
		});
		const decision = research.recordDecision({
			id: "decision-1",
			briefId: brief.id,
			hypothesis: "Ship the compact panel",
			rationale: "Evidence supports it",
			confidence: "high",
			evidenceRefs: ["ev-1"],
			rejectedOptions: [],
			nextActions: [],
		});
		const missions = new MissionStore(dbPath);
		const mission = missions.listMissions({ briefId: brief.id })[0];
		missions.updateMission(mission.id, { state: "verifying", confidence: "high", decisionId: decision.id });
		missions.createLaneRun({
			id: "lane-1",
			missionId: mission.id,
			lane: "repo",
			agent: "explore",
			epistemicRole: "repo_truth",
			status: "completed",
			evidenceCount: 1,
			emptyReason: null,
			taskId: null,
			startedAt: 1,
			endedAt: 2,
		});
		cleanup.push(
			() => missions.close(),
			() => research.close(),
		);

		const view = new MissionControlView({ dbPath });
		cleanup.push(() => view.dispose());
		const rendered = Bun.stripANSI(view.render(100).join("\n"));

		expect(rendered).toContain("Mission Control");
		expect(rendered).toContain("Objective: Improve mission control");
		expect(rendered).toContain("State: verifying | confidence high | risk medium");
		expect(rendered).toContain("Research run: <none>");
		expect(rendered).toContain("Snapshot: unavailable");
		expect(rendered).toContain("── Orchestration ──");
		expect(rendered).toContain("[repo truth] explore | repo | completed | evidence 1");
		expect(rendered).toContain("── Evidence Board ──");
		expect(rendered).toContain("[repo] ev-1 | grade A | src/file.ts:1");
		expect(rendered).toContain("── Synthesis / Critique ──");
		expect(rendered).toContain("Synthesis: <none>");
		expect(rendered).toContain("Critique: <none>");
		expect(rendered).toContain("── Decision Contract ──");
		expect(rendered).toContain("Decision: high | Ship the compact panel");
		expect(rendered).toContain("Evidence refs: ev-1");
		expect(rendered).toContain("Execution contract: <none>");
		expect(rendered).toContain("── Verification / Rollback ──");
		expect(rendered).toContain("Verification: <none>");
		expect(rendered).toContain("Rollback: <none> | snapshots 0");
		expect(rendered).toContain("Mission Inspector: Ctrl+S for tool traces, artifacts, and subagent details");
	});

	test("renders synthesis critique decision contract and rollback details", () => {
		const dbPath = tempDb();
		const research = new ResearchStore(dbPath);
		const brief = research.createBrief({
			id: "brief-rich",
			objectiveId: "objective-rich",
			question: "Panelize mission control",
			lanes: ["repo", "source"],
			requiredEvidence: [],
			disallowedEvidence: [],
			riskLevel: "high",
			stopCriteria: [],
		});
		research.addEvidence({
			id: "ev-rich-1",
			briefId: brief.id,
			lane: "source",
			grade: "B",
			sourceRef: "docs/ux.md:10",
			excerpt: "panel evidence",
			claims: ["panel claim"],
			directness: 1,
			specificity: 1,
			recency: 1,
			reproducibility: 1,
			capturedAt: 10,
		});
		research.recordSynthesis({
			id: "syn-rich",
			briefId: brief.id,
			hypothesisCount: 2,
			recommended: "Panelized console",
			summary: "Use separated operational panels",
			rawOutput: "raw synthesis",
			createdAt: 20,
		});
		research.recordCritique({
			id: "crit-rich",
			briefId: brief.id,
			blockingCount: 1,
			softCount: 2,
			verdict: "accept-with-modifications",
			summary: "Keep inspector visible",
			rawOutput: "raw critique",
			createdAt: 30,
		});
		const decision = research.recordDecision({
			id: "decision-rich",
			briefId: brief.id,
			hypothesis: "Adopt panelized text console",
			rationale: "Evidence supports it",
			confidence: "medium",
			evidenceRefs: ["ev-rich-1"],
			rejectedOptions: [],
			nextActions: ["Run focused view test"],
		});
		const missions = new MissionStore(dbPath);
		const mission = missions.listMissions({ briefId: brief.id })[0];
		missions.updateMission(mission.id, {
			state: "verifying",
			confidence: "medium",
			decisionId: decision.id,
			snapshotRef: "snapshot-rich",
		});
		missions.createResearchRun({
			id: "run-rich",
			missionId: mission.id,
			briefId: brief.id,
			objectiveId: "objective-rich",
			status: "completed",
			startedAt: 1,
			completedAt: 2,
		});
		missions.recordContract({
			id: "contract-rich",
			missionId: mission.id,
			role: "mission-control-panelizer",
			parentContractRevision: 1,
			include: ["packages/coding-agent/src/modes/components/mission-control-view.ts"],
			exclude: ["docs/**"],
			successCriteria: ["checkts", "panel-tests"],
			escalation: { onUncertainty: "ask-parent", budgetCap: 1200 },
			inputArtifact: null,
			mustProduce: ["changed files"],
			createdAt: 40,
		});
		missions.recordVerification({
			id: "verification-rich",
			missionId: mission.id,
			status: "fail",
			failedCount: 1,
			uncertainCount: 0,
			summary: "one assertion failed",
			createdAt: 50,
		});
		missions.recordRollback({
			id: "rollback-rich",
			missionId: mission.id,
			targetType: "decision",
			targetId: decision.id,
			snapshotRef: "snapshot-rich",
			summary: "restore prior decision",
			createdAt: 60,
		});
		cleanup.push(
			() => missions.close(),
			() => research.close(),
		);

		const view = new MissionControlView({ dbPath });
		cleanup.push(() => view.dispose());
		const rendered = Bun.stripANSI(view.render(140).join("\n"));

		expect(rendered).toContain("Research run: completed (run-rich)");
		expect(rendered).toContain("Snapshot: available");
		expect(rendered).toContain("[source] ev-rich-1 | grade B | docs/ux.md:10");
		expect(rendered).toContain(
			"Synthesis: Use separated operational panels | hypotheses 2 | recommended Panelized console",
		);
		expect(rendered).toContain("Critique: accept-with-modifications | blocking 1 | soft 2 | Keep inspector visible");
		expect(rendered).toContain("Decision: medium | Adopt panelized text console");
		expect(rendered).toContain("Evidence refs: ev-rich-1");
		expect(rendered).toContain("Next actions: Run focused view test");
		expect(rendered).toContain("Execution contract: mission-control-panelizer | scope +1/-1 | criteria 2");
		expect(rendered).toContain("Verification: fail | failed 1 | uncertain 0 | one assertion failed");
		expect(rendered).toContain("Rollback: restore prior decision | snapshots 1");
	});

	test("returns no lines when no mission exists", () => {
		const dbPath = tempDb();
		const view = new MissionControlView({ dbPath });
		cleanup.push(() => view.dispose());

		expect(view.render(100)).toEqual([]);
	});
});
