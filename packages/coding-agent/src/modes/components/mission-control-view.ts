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
	const rollback = mission.snapshotRef ? "available" : "unavailable";
	const verification = view.latestVerification
		? `${view.latestVerification.status} (${view.latestVerification.summary})`
		: "not yet recorded";
	const decision = view.decisionSummary
		? `${view.decisionSummary.confidence}: ${view.decisionSummary.hypothesis}`
		: "<none>";

	const lines = [
		`Mission Control — ${objective}`,
		`Layer 0 Objective: ${mission.title}`,
		`Layer 1 State: ${mission.state} | confidence ${confidence} | risk ${mission.riskLevel}`,
		`Verification: ${verification}`,
		`Rollback: ${view.rollbacks.length} recorded | snapshot ${rollback}`,
		`Layer 5 Lanes: ${view.laneRuns.length} run(s), ${view.evidenceCount} evidence card(s)`,
	];

	for (const lane of view.laneRuns) {
		lines.push(
			`  - ${lane.lane}: ${epistemicBadge(lane.epistemicRole)} ${lane.epistemicRole} | ${lane.status} | evidence ${lane.evidenceCount}`,
		);
	}

	if (view.laneRuns.length === 0) {
		lines.push("  - <none>");
	}

	lines.push(`Layer 7 Decision: ${decision}`);
	lines.push(`Verification: ${verification} | rollbacks ${view.rollbacks.length} | snapshot ${rollback}`);
	lines.push("Inspector: Ctrl+S for tool traces, artifacts, and subagent details");
	return lines;
}

function padLine(line: string, width: number): string {
	const clipped = line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
	return clipped + " ".repeat(Math.max(0, width - clipped.length));
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
