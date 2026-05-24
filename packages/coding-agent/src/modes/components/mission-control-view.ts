import type { Component } from "@amaze/tui";
import { MissionReadModel, type MissionView } from "../../mission/read-model";

export class MissionControlView implements Component {
	#readModel: MissionReadModel;
	#mission: MissionView | null = null;
	#disposed = false;

	constructor(opts: { dbPath?: string } = {}) {
		this.#readModel = new MissionReadModel({ dbPath: opts.dbPath });
		this.refresh();
	}

	refresh(): void {
		if (this.#disposed) return;
		this.#mission = this.#readModel.listMissionViews()[0] ?? null;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#readModel.close();
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.#mission) return [];

		const innerWidth = Math.max(20, width - 2);
		const lines = buildMissionControlLines(this.#mission);
		return [
			`┌${"─".repeat(innerWidth)}┐`,
			...lines.map(line => `│${padLine(line, innerWidth)}│`),
			`└${"─".repeat(innerWidth)}┘`,
		];
	}
}

export function buildMissionControlLines(view: MissionView): string[] {
	const mission = view.mission;
	const objective = view.objective?.title ?? mission.title;
	const confidence = mission.confidence ?? "unknown";
	const snapshot = mission.snapshotRef ? "available" : "unavailable";
	const researchRun = view.researchRun ? `${view.researchRun.status} (${view.researchRun.id})` : "<none>";
	const lines: string[] = [
		`Mission Control — ${objective}`,
		`Objective: ${mission.title}`,
		`State: ${mission.state} | confidence ${confidence} | risk ${mission.riskLevel}`,
		`Research run: ${researchRun}`,
		`Snapshot: ${snapshot}`,
		section("Orchestration"),
	];

	if (view.laneRuns.length === 0) {
		lines.push("  <none>");
	} else {
		for (const lane of view.laneRuns) {
			const emptyReason = lane.emptyReason ? ` | empty: ${lane.emptyReason}` : "";
			lines.push(
				`  ${epistemicBadge(lane.epistemicRole)} ${lane.agent} | ${lane.lane} | ${lane.status} | evidence ${lane.evidenceCount}${emptyReason}`,
			);
		}
	}

	lines.push(section("Evidence Board"));
	const evidenceCards = view.evidenceCards.slice(0, 4);
	if (evidenceCards.length === 0) {
		lines.push("  <none>");
	} else {
		for (const card of evidenceCards) {
			lines.push(`  ${laneBadge(card.lane)} ${card.id} | grade ${card.grade} | ${card.sourceRef}`);
		}
	}

	lines.push(section("Synthesis / Critique"));
	lines.push(
		view.latestSynthesis
			? `  Synthesis: ${view.latestSynthesis.summary} | hypotheses ${view.latestSynthesis.hypothesisCount}${view.latestSynthesis.recommended ? ` | recommended ${view.latestSynthesis.recommended}` : ""}`
			: "  Synthesis: <none>",
	);
	lines.push(
		view.latestCritique
			? `  Critique: ${view.latestCritique.verdict} | blocking ${view.latestCritique.blockingCount} | soft ${view.latestCritique.softCount} | ${view.latestCritique.summary}`
			: "  Critique: <none>",
	);

	lines.push(section("Decision Contract"));
	if (view.decisionSummary) {
		lines.push(`  Decision: ${view.decisionSummary.confidence} | ${view.decisionSummary.hypothesis}`);
		lines.push(`  Evidence refs: ${formatList(view.decisionSummary.evidenceRefs)}`);
		if (view.decision?.nextActions.length) {
			lines.push(`  Next actions: ${formatList(view.decision.nextActions)}`);
		}
	} else {
		lines.push("  Decision: <none>");
	}
	const latestContract = view.contracts.at(-1);
	lines.push(
		latestContract
			? `  Execution contract: ${latestContract.role} | scope +${latestContract.include.length}/-${latestContract.exclude.length} | criteria ${latestContract.successCriteria.length}`
			: "  Execution contract: <none>",
	);

	lines.push(section("Verification / Rollback"));
	lines.push(
		view.latestVerification
			? `  Verification: ${view.latestVerification.status} | failed ${view.latestVerification.failedCount} | uncertain ${view.latestVerification.uncertainCount} | ${view.latestVerification.summary}`
			: "  Verification: <none>",
	);
	const latestRollback = view.rollbacks.at(-1);
	lines.push(
		latestRollback
			? `  Rollback: ${latestRollback.summary} | snapshots ${countRollbackSnapshots(view.rollbacks)}`
			: `  Rollback: <none> | snapshots ${countRollbackSnapshots(view.rollbacks)}`,
	);
	lines.push("Mission Inspector: Ctrl+S for tool traces, artifacts, and subagent details");
	return lines;
}

function padLine(line: string, width: number): string {
	const clipped = line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
	return clipped + " ".repeat(Math.max(0, width - clipped.length));
}

function section(title: string): string {
	return `── ${title} ──`;
}

function formatList(items: string[]): string {
	return items.length > 0 ? items.join(", ") : "<none>";
}

function countRollbackSnapshots(rollbacks: MissionView["rollbacks"]): number {
	return rollbacks.filter(rollback => rollback.snapshotRef).length;
}

function laneBadge(lane: string): string {
	if (lane === "repo") return "[repo]";
	if (lane === "source") return "[source]";
	if (lane === "social") return "[social]";
	if (lane === "memory") return "[memory]";
	return "[lane]";
}

function epistemicBadge(role: string): string {
	if (role === "repo_truth") return "[repo truth]";
	if (role === "source_harvest") return "[source]";
	if (role === "social_signal") return "[social]";
	if (role === "memory_prior") return "[memory]";
	if (role === "synthesis") return "[synth]";
	if (role === "critic") return "[critic]";
	return "[unknown]";
}
