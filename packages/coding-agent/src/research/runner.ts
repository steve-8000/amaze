/**
 * ResearchRunner — automated lane execution for a research brief.
 *
 * Bridges the gap between the manual research protocol (CLI `research run` +
 * `research add-evidence`) and an automatic loop: given a brief, the runner
 * starts a research run, executes each lane through a {@link LaneExecutor},
 * stores the collected evidence as {@link EvidenceCard}s with content hashes
 * (citation provenance), finalizes lane/run states, and refreshes runtime
 * critic checks so blocking gaps surface immediately.
 *
 * The `source` lane ships with a real executor backed by the web-search
 * provider chain ({@link webSearchLaneExecutor}). `repo` and `social` lanes are
 * caller-injectable: agents already collect that evidence through read/search
 * and x_search tools and can hand the cards to the runner.
 */

import { createHash } from "node:crypto";
import type { MissionStore } from "../mission/store";
import type { EpistemicRole } from "../mission/types";
import { runSearchQuery } from "../web/search";
import type { ResearchStore } from "./store";
import type { EvidenceCard, EvidenceGrade, ResearchBrief, ResearchLane, RuntimeCriticCheck } from "./types";

/** SHA-256 hex of an excerpt — stable citation fingerprint for staleness checks. */
export function hashExcerpt(excerpt: string): string {
	return createHash("sha256").update(excerpt).digest("hex");
}

/** Evidence payload a lane executor returns; the runner fills ids/hashes/timestamps. */
export interface LaneEvidenceInput {
	grade: EvidenceGrade;
	sourceRef: string;
	excerpt: string;
	claims: string[];
	directness: number;
	specificity: number;
	recency: number;
	reproducibility: number;
}

/** Executes one lane of a brief and returns collected evidence (possibly empty). */
export type LaneExecutor = (brief: ResearchBrief, signal?: AbortSignal) => Promise<LaneEvidenceInput[]>;

/**
 * Default `source` lane executor: queries the configured web-search provider
 * chain with the brief question and converts returned sources into graded
 * evidence inputs. Throws when no provider is configured (the lane is then
 * recorded as failed evidence collection, not silently empty).
 */
export function webSearchLaneExecutor(options: { limit?: number } = {}): LaneExecutor {
	return async (brief, signal) => {
		const { details } = await runSearchQuery({ query: brief.question, limit: options.limit ?? 5 });
		if (signal?.aborted) throw new Error("research lane aborted");
		if (details.error) throw new Error(`web search failed: ${details.error}`);
		const sources = details.response.sources.slice(0, options.limit ?? 5);
		return sources.map(source => ({
			// External web content is secondary until verified — grade C by default.
			grade: "C" as EvidenceGrade,
			sourceRef: source.url,
			excerpt: source.snippet ?? source.title,
			claims: [source.title],
			directness: 0.5,
			specificity: source.snippet ? 0.5 : 0.3,
			recency: recencyScore(source.ageSeconds),
			reproducibility: 0.2,
		}));
	};
}

/** Map source age to a 0..1 recency score (unknown age ⇒ neutral 0.5). */
function recencyScore(ageSeconds: number | undefined): number {
	if (ageSeconds === undefined) return 0.5;
	const days = ageSeconds / 86_400;
	if (days <= 7) return 1;
	if (days <= 30) return 0.8;
	if (days <= 180) return 0.6;
	if (days <= 365) return 0.4;
	return 0.2;
}

export interface LaneOutcome {
	lane: ResearchLane;
	status: "completed" | "empty" | "failed" | "skipped";
	evidence: EvidenceCard[];
	error?: string;
}

export interface ResearchRunOutcome {
	runId: string;
	missionId: string;
	briefId: string;
	lanes: LaneOutcome[];
	criticChecks: RuntimeCriticCheck[];
	/** True when every executed lane completed (or was legitimately empty) without error. */
	ok: boolean;
}

export interface ResearchRunnerDeps {
	research: ResearchStore;
	missions: MissionStore;
	/** Per-lane executors. Missing lanes are recorded as `skipped` (manual collection). */
	executors: Partial<Record<ResearchLane, LaneExecutor>>;
	now?: () => number;
}

export class ResearchRunner {
	readonly #research: ResearchStore;
	readonly #missions: MissionStore;
	readonly #executors: Partial<Record<ResearchLane, LaneExecutor>>;
	readonly #now: () => number;

	constructor(deps: ResearchRunnerDeps) {
		this.#research = deps.research;
		this.#missions = deps.missions;
		this.#executors = deps.executors;
		this.#now = deps.now ?? Date.now;
	}

	/**
	 * Execute a full research run for a brief: create run + lane runs, execute
	 * lanes, persist evidence with content hashes, finalize lane states, and
	 * refresh runtime critic checks.
	 */
	async run(briefId: string, signal?: AbortSignal): Promise<ResearchRunOutcome> {
		const brief = this.#research.getBrief(briefId);
		if (!brief) throw new Error(`Research brief not found: ${briefId}`);
		const mission = this.#research.getMissionForBrief(briefId);
		if (!mission) throw new Error(`Mission not found for research brief: ${briefId}`);

		const run = this.#missions.createResearchRun({
			missionId: mission.id,
			briefId: brief.id,
			objectiveId: brief.objectiveId,
			status: "running",
			completedAt: null,
		});
		const laneRuns = new Map(
			brief.lanes.map(lane => [
				lane,
				this.#missions.createLaneRun({
					missionId: mission.id,
					lane,
					agent: lane === "social" ? "Researcher_X" : "Researcher",
					epistemicRole: epistemicRoleForLane(lane),
					status: "pending",
					evidenceCount: 0,
					emptyReason: null,
					taskId: null,
					startedAt: null,
					endedAt: null,
				}),
			]),
		);
		this.#missions.updateMission(mission.id, { state: "researching" });

		const lanes: LaneOutcome[] = [];
		for (const lane of brief.lanes) {
			const laneRun = laneRuns.get(lane);
			if (!laneRun) continue;
			const executor = this.#executors[lane];
			if (!executor) {
				this.#missions.updateLaneRun(laneRun.id, {
					status: "empty",
					emptyReason: "no executor configured (manual collection)",
					endedAt: this.#now(),
				});
				lanes.push({ lane, status: "skipped", evidence: [] });
				continue;
			}
			this.#missions.updateLaneRun(laneRun.id, { status: "running", startedAt: this.#now() });
			try {
				const inputs = await executor(brief, signal);
				const evidence = inputs.map(input =>
					this.#research.addEvidence({
						briefId: brief.id,
						lane,
						...input,
						contentHash: hashExcerpt(input.excerpt),
					}),
				);
				this.#missions.updateLaneRun(laneRun.id, {
					status: evidence.length > 0 ? "completed" : "empty",
					evidenceCount: evidence.length,
					emptyReason: evidence.length > 0 ? null : "executor returned no evidence",
					endedAt: this.#now(),
				});
				lanes.push({ lane, status: evidence.length > 0 ? "completed" : "empty", evidence });
			} catch (error) {
				this.#missions.updateLaneRun(laneRun.id, {
					status: "failed",
					emptyReason: String(error),
					endedAt: this.#now(),
				});
				lanes.push({ lane, status: "failed", evidence: [], error: String(error) });
			}
		}

		const failed = lanes.some(outcome => outcome.status === "failed");
		this.#missions.updateResearchRun(run.id, {
			status: failed ? "blocked" : "completed",
			completedAt: this.#now(),
		});
		const criticChecks = this.#research.refreshRuntimeCriticChecks(brief.id);

		return {
			runId: run.id,
			missionId: mission.id,
			briefId: brief.id,
			lanes,
			criticChecks,
			ok: !failed,
		};
	}
}

function epistemicRoleForLane(lane: ResearchLane): EpistemicRole {
	if (lane === "repo") return "repo_truth";
	if (lane === "source") return "source_harvest";
	return "social_signal";
}
