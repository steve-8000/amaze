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
	test("renders the latest mission summary and lane counts", () => {
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
		expect(rendered).toContain("Improve mission control");
		expect(rendered).toContain("verifying");
		expect(rendered).toContain("Layer 5 Lanes: 1 run(s), 1 evidence card(s)");
		expect(rendered).toContain("repo: [repo truth] repo_truth | completed | evidence 1");
		expect(rendered).toContain("Verification: not yet recorded");
		expect(rendered).toContain("Rollback: 0 recorded | snapshot unavailable");
		expect(rendered).toContain("Ship the compact panel");
	});
});
