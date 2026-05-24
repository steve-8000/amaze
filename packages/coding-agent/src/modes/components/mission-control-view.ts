import type { Component } from "@amaze/tui";
import type { MissionEventBus, Unsubscribe } from "../../mission/event-bus";
import { MissionReadModel, type MissionView } from "../../mission/read-model";
import { getMissionEventBus } from "../../mission/runtime";

export class MissionControlView implements Component {
	#readModel: MissionReadModel;
	#getPreferredMissionInput:
		| (() => { objectiveId?: string; briefId?: string; title?: string } | undefined)
		| undefined;
	#missions: MissionView[] = [];
	#mission: MissionView | null = null;
	#selectedMissionId: string | undefined;
	#unsubscribe: Unsubscribe | undefined;
	#disposed = false;

	constructor(
		opts: {
			dbPath?: string;
			getPreferredMissionInput?: () => { objectiveId?: string; briefId?: string; title?: string } | undefined;
			missionEventBus?: MissionEventBus;
			onRefresh?: () => void;
		} = {},
	) {
		this.#readModel = new MissionReadModel({ dbPath: opts.dbPath });
		this.#getPreferredMissionInput = opts.getPreferredMissionInput;
		const bus = opts.missionEventBus ?? getMissionEventBus();
		if (bus) {
			this.#unsubscribe = bus.subscribe(event => {
				if (this.#selectedMissionId === undefined || event.missionId === this.#selectedMissionId) {
					this.refresh();
					opts.onRefresh?.();
				}
			});
		}
		this.refresh();
	}

	refresh(): void {
		if (this.#disposed) return;
		this.#missions = this.#readModel.listMissionViews();
		const selected = this.#selectedMissionId
			? this.#missions.find(view => view.mission.id === this.#selectedMissionId)
			: undefined;
		const preferred =
			selected ??
			this.#readModel.getPreferredMissionView(this.#getPreferredMissionInput?.()) ??
			this.#missions[0] ??
			null;
		this.#mission = preferred;
		this.#selectedMissionId = selected ? selected.mission.id : undefined;
	}

	selectNextMission(): boolean {
		return this.#selectMission(1);
	}

	selectPreviousMission(): boolean {
		return this.#selectMission(-1);
	}

	getSelectedMissionLabel(): string | undefined {
		if (!this.#mission) return undefined;
		const index = this.#missions.findIndex(view => view.mission.id === this.#mission?.mission.id);
		const position = index >= 0 ? `${index + 1}/${this.#missions.length}` : "preferred";
		return `${position} ${this.#mission.mission.title}`;
	}

	#selectMission(direction: 1 | -1): boolean {
		this.refresh();
		if (this.#missions.length <= 1 || !this.#mission) return false;
		const currentIndex = Math.max(
			0,
			this.#missions.findIndex(view => view.mission.id === this.#mission?.mission.id),
		);
		const nextIndex = (currentIndex + direction + this.#missions.length) % this.#missions.length;
		if (nextIndex === currentIndex) return false;
		this.#mission = this.#missions[nextIndex] ?? null;
		this.#selectedMissionId = this.#mission?.mission.id;
		return Boolean(this.#mission);
	}

	getPreferredInspectorTarget(): { sessionId?: string; sessionFile?: string } | undefined {
		const target = this.#mission?.inspectorTarget;
		if (!target) return undefined;
		return {
			sessionId: target.taskId ?? undefined,
			sessionFile: target.sessionFile ?? undefined,
		};
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.#readModel.close();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const lines = this.#mission
			? buildMissionControlLines(this.#mission, getMissionStrip(this.#missions, this.#mission))
			: buildMissionControlEmptyLines();
		return [
			`┌${"─".repeat(innerWidth)}┐`,
			...lines.map(line => `│${padLine(line, innerWidth)}│`),
			`└${"─".repeat(innerWidth)}┘`,
		];
	}
}

export function buildMissionControlEmptyLines(): string[] {
	return [
		"Mission Control",
		"No active mission yet.",
		"Mission Inspector: Ctrl+S for tool traces, artifacts, and subagent details",
	];
}

export function buildMissionControlLines(view: MissionView, missionStrip?: string): string[] {
	const mission = view.mission;
	const objective = view.objective?.title ?? mission.title;
	const confidence = mission.confidence ?? "unknown";
	const snapshot = mission.snapshotRef ? "available" : "unavailable";
	const researchRun = view.researchRun ? `${view.researchRun.status} (${view.researchRun.id})` : "<none>";
	const laneSummary = summarizeLaneRuns(view);
	const evidenceSummary = summarizeEvidence(view);
	const lines: string[] = [
		`Mission Control — ${objective}`,
		...(missionStrip ? [missionStrip] : []),
		`Objective: ${mission.title}`,
		`State: ${mission.state} | confidence ${confidence} | risk ${mission.riskLevel}`,
		`Execution: lanes ${laneSummary} | evidence ${evidenceSummary}`,
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

	lines.push(`  Summary: ${laneSummary}`);

	lines.push(section("Evidence Board"));
	const evidenceCards = view.evidenceCards.slice(0, 4);
	if (evidenceCards.length === 0) {
		lines.push("  <none>");
	} else {
		for (const card of evidenceCards) {
			lines.push(`  ${laneBadge(card.lane)} ${card.id} | grade ${card.grade} | ${card.sourceRef}`);
		}
	}
	lines.push(`  Summary: ${evidenceSummary}`);

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
		lines.push(
			`  Evidence refs: ${formatList(view.decisionSummary.evidenceRefs)} | rejected ${view.decision?.rejectedOptions.length ?? 0}`,
		);
		if (view.decision?.nextActions.length) {
			lines.push(`  Next actions: ${formatList(view.decision.nextActions)}`);
		}
	} else {
		lines.push("  Decision: <none>");
	}
	const latestContract = view.contracts.at(-1);
	lines.push(
		latestContract
			? `  Execution contract: ${latestContract.role} | scope +${latestContract.include.length}/-${latestContract.exclude.length} | criteria ${latestContract.successCriteria.length} | escalation ${latestContract.escalation.onUncertainty}`
			: "  Execution contract: <none>",
	);
	if (view.inspectorTarget) {
		const label = view.inspectorTarget.taskId ?? view.inspectorTarget.sessionFile ?? "linked trace";
		lines.push(`  Linked trace: ${label}`);
	}

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
	lines.push(
		view.inspectorTarget
			? "Mission Inspector: Ctrl+S opens linked contract trace first"
			: "Mission Inspector: Ctrl+S for tool traces, artifacts, and subagent details",
	);
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

function getMissionStrip(missions: MissionView[], selected: MissionView): string | undefined {
	if (missions.length <= 1) return undefined;
	const index = missions.findIndex(view => view.mission.id === selected.mission.id);
	const position = index >= 0 ? index + 1 : 1;
	return `Missions: ${missions.length} total | selected ${position}/${missions.length} | ${selected.mission.title}`;
}

function summarizeLaneRuns(view: MissionView): string {
	if (view.laneRuns.length === 0) return "0 lanes";
	const counts = new Map<string, number>();
	for (const lane of view.laneRuns) {
		counts.set(lane.status, (counts.get(lane.status) ?? 0) + 1);
	}
	return [...counts.entries()].map(([status, count]) => `${status} ${count}`).join(", ");
}

function summarizeEvidence(view: MissionView): string {
	if (view.evidenceCards.length === 0) return "0 cards";
	const lanes = new Set(view.evidenceCards.map(card => card.lane));
	return `${view.evidenceCards.length} cards across ${lanes.size} lanes`;
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
