import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MissionEventBus } from "../mission/event-bus";
import { MissionStore } from "../mission/store";
import type { Mission } from "../mission/types";
import {
	CONFIDENCE_LEVELS,
	type ConfidenceLevel,
	CRITIQUE_VERDICTS,
	type CritiqueRecord,
	type CritiqueVerdict,
	type DecisionRecord,
	EVIDENCE_GRADES,
	type EvidenceCard,
	type EvidenceGrade,
	type NewCritiqueRecord,
	type NewDecisionRecord,
	type NewEvidenceCard,
	type NewResearchBrief,
	type NewSynthesisRecord,
	RESEARCH_LANES,
	type ResearchBrief,
	type ResearchLane,
	type SynthesisRecord,
} from "./types";

export const DEFAULT_DB_PATH = path.join(os.homedir(), ".amaze", "autonomy", "autonomy.db");

const VALID_LANES = new Set<ResearchLane>(RESEARCH_LANES);
const VALID_GRADES = new Set<EvidenceGrade>(EVIDENCE_GRADES);
const VALID_CONFIDENCE = new Set<ConfidenceLevel>(CONFIDENCE_LEVELS);
const VALID_CRITIQUE_VERDICTS = new Set<CritiqueVerdict>(CRITIQUE_VERDICTS);

type ResearchBriefRow = {
	id: string;
	objective_id: string | null;
	question: string;
	lanes: string;
	required_evidence: string;
	disallowed_evidence: string;
	risk_level: ResearchBrief["riskLevel"];
	stop_criteria: string;
	created_at: number;
	updated_at: number;
};

type EvidenceCardRow = {
	id: string;
	brief_id: string;
	lane: ResearchLane;
	grade: EvidenceGrade;
	source_ref: string;
	excerpt: string;
	claims: string;
	captured_at: number;
	directness: number;
	specificity: number;
	recency: number;
	reproducibility: number;
};

type DecisionRecordRow = {
	id: string;
	brief_id: string;
	hypothesis: string;
	rationale: string;
	confidence: ConfidenceLevel;
	evidence_refs: string;
	rejected_options: string;
	next_actions: string;
	created_at: number;
};

type SynthesisRecordRow = {
	id: string;
	brief_id: string;
	hypothesis_count: number;
	recommended: string | null;
	summary: string;
	raw_output: string;
	created_at: number;
};

type CritiqueRecordRow = {
	id: string;
	brief_id: string;
	blocking_count: number;
	soft_count: number;
	verdict: CritiqueVerdict;
	summary: string;
	raw_output: string;
	created_at: number;
};

export class ResearchStore {
	readonly dbPath: string;
	readonly #db: Database;
	#missionEventBus: MissionEventBus | undefined;

	constructor(dbPath = DEFAULT_DB_PATH, missionEventBus?: MissionEventBus) {
		this.dbPath = dbPath;
		if (dbPath !== ":memory:") {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		}
		this.#db = new Database(dbPath, { create: true, strict: true });
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#missionEventBus = missionEventBus;
		this.#init();
	}

	close(): void {
		this.#db.close();
	}

	createBrief(input: NewResearchBrief): ResearchBrief {
		for (const lane of input.lanes) {
			assertResearchLane(lane);
		}
		const now = Date.now();
		const brief: ResearchBrief = {
			...input,
			id: input.id ?? generateId("research", now),
			createdAt: now,
			updatedAt: now,
		};
		this.#db
			.query(
				`INSERT INTO research_briefs
					(id, objective_id, question, lanes, required_evidence, disallowed_evidence, risk_level, stop_criteria, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				brief.id,
				brief.objectiveId,
				brief.question,
				JSON.stringify(brief.lanes),
				JSON.stringify(brief.requiredEvidence),
				JSON.stringify(brief.disallowedEvidence),
				brief.riskLevel,
				JSON.stringify(brief.stopCriteria),
				brief.createdAt,
				brief.updatedAt,
			);
		const mission = this.#createMissionForBrief(brief);
		this.#missionEventBus?.emit({
			type: "research.brief.created",
			missionId: mission.id,
			briefId: brief.id,
			objectiveId: brief.objectiveId,
			lanes: brief.lanes,
			ts: brief.createdAt,
		});
		return brief;
	}

	getBrief(id: string): ResearchBrief | undefined {
		const row = this.#db.query("SELECT * FROM research_briefs WHERE id = ?").get(id) as ResearchBriefRow | null;
		return row ? rowToBrief(row) : undefined;
	}

	listBriefs(opts: { objectiveId?: string } = {}): ResearchBrief[] {
		const rows = opts.objectiveId
			? (this.#db
					.query("SELECT * FROM research_briefs WHERE objective_id = ? ORDER BY created_at DESC, id DESC")
					.all(opts.objectiveId) as ResearchBriefRow[])
			: (this.#db
					.query("SELECT * FROM research_briefs ORDER BY created_at DESC, id DESC")
					.all() as ResearchBriefRow[]);
		return rows.map(rowToBrief);
	}

	addEvidence(input: NewEvidenceCard): EvidenceCard {
		if (!this.getBrief(input.briefId)) {
			throw new Error(`Research brief not found: ${input.briefId}`);
		}
		assertResearchLane(input.lane);
		assertEvidenceGrade(input.grade);
		const now = Date.now();
		const evidence: EvidenceCard = {
			...input,
			id: input.id ?? generateId("ev", now),
			capturedAt: input.capturedAt ?? now,
			directness: clamp01(input.directness),
			specificity: clamp01(input.specificity),
			recency: clamp01(input.recency),
			reproducibility: clamp01(input.reproducibility),
		};
		this.#db
			.query(
				`INSERT INTO evidence_cards
					(id, brief_id, lane, grade, source_ref, excerpt, claims, captured_at, directness, specificity, recency, reproducibility)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				evidence.id,
				evidence.briefId,
				evidence.lane,
				evidence.grade,
				evidence.sourceRef,
				evidence.excerpt,
				JSON.stringify(evidence.claims),
				evidence.capturedAt,
				evidence.directness,
				evidence.specificity,
				evidence.recency,
				evidence.reproducibility,
			);
		const mission = this.getMissionForBrief(evidence.briefId);
		if (mission) {
			this.#updateLiveLaneRunForEvidence(mission.id, evidence.briefId, evidence.lane, evidence.capturedAt);
			this.#missionEventBus?.emit({
				type: "research.evidence.added",
				missionId: mission.id,
				briefId: evidence.briefId,
				evidenceId: evidence.id,
				lane: evidence.lane,
				grade: evidence.grade,
				ts: evidence.capturedAt,
			});
		}
		return evidence;
	}

	listEvidence(briefId: string): EvidenceCard[] {
		const rows = this.#db
			.query("SELECT * FROM evidence_cards WHERE brief_id = ? ORDER BY captured_at ASC, id ASC")
			.all(briefId) as EvidenceCardRow[];
		return rows.map(rowToEvidence);
	}

	getMissionForBrief(briefId: string): Mission | undefined {
		const missions = new MissionStore(this.dbPath);
		try {
			return missions.listMissions({ briefId })[0];
		} finally {
			missions.close();
		}
	}

	recordDecision(input: NewDecisionRecord): DecisionRecord {
		if (!this.getBrief(input.briefId)) {
			throw new Error(`Research brief not found: ${input.briefId}`);
		}
		assertConfidence(input.confidence);
		const now = Date.now();
		const decision: DecisionRecord = {
			...input,
			id: input.id ?? generateId("dec", now),
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO decision_records
					(id, brief_id, hypothesis, rationale, confidence, evidence_refs, rejected_options, next_actions, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				decision.id,
				decision.briefId,
				decision.hypothesis,
				decision.rationale,
				decision.confidence,
				JSON.stringify(decision.evidenceRefs),
				JSON.stringify(decision.rejectedOptions),
				JSON.stringify(decision.nextActions),
				decision.createdAt,
			);
		const mission = this.getMissionForBrief(decision.briefId);
		if (mission) {
			const missions = new MissionStore(this.dbPath);
			try {
				missions.updateMission(mission.id, {
					decisionId: decision.id,
					state: "deciding",
					confidence: decision.confidence,
				});
				this.#missionEventBus?.emit({
					type: "decision.recorded",
					missionId: mission.id,
					briefId: decision.briefId,
					decisionId: decision.id,
					confidence: decision.confidence,
					ts: decision.createdAt,
				});
			} finally {
				missions.close();
			}
		}
		return decision;
	}

	recordSynthesis(input: NewSynthesisRecord): SynthesisRecord {
		if (!this.getBrief(input.briefId)) {
			throw new Error(`Research brief not found: ${input.briefId}`);
		}
		const now = Date.now();
		const synthesis: SynthesisRecord = {
			...input,
			id: input.id ?? generateId("syn", now),
			createdAt: input.createdAt ?? now,
		};
		this.#db
			.query(
				`INSERT INTO research_syntheses
					(id, brief_id, hypothesis_count, recommended, summary, raw_output, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				synthesis.id,
				synthesis.briefId,
				synthesis.hypothesisCount,
				synthesis.recommended,
				synthesis.summary,
				synthesis.rawOutput,
				synthesis.createdAt,
			);
		const mission = this.getMissionForBrief(synthesis.briefId);
		if (mission) {
			const missions = new MissionStore(this.dbPath);
			try {
				missions.updateMission(mission.id, { state: "synthesizing" });
				this.#finalizeLatestResearchRun(missions, mission.id, synthesis.briefId, "completed", synthesis.createdAt);
				this.#missionEventBus?.emit({
					type: "research.synthesis.proposed",
					missionId: mission.id,
					briefId: synthesis.briefId,
					hypothesisCount: synthesis.hypothesisCount,
					recommended: synthesis.recommended,
					ts: synthesis.createdAt,
				});
			} finally {
				missions.close();
			}
		}
		return synthesis;
	}

	getLatestSynthesis(briefId: string): SynthesisRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM research_syntheses WHERE brief_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(briefId) as SynthesisRecordRow | null;
		return row ? rowToSynthesis(row) : undefined;
	}

	listSyntheses(briefId: string): SynthesisRecord[] {
		const rows = this.#db
			.query("SELECT * FROM research_syntheses WHERE brief_id = ? ORDER BY created_at ASC, id ASC")
			.all(briefId) as SynthesisRecordRow[];
		return rows.map(rowToSynthesis);
	}

	recordCritique(input: NewCritiqueRecord): CritiqueRecord {
		if (!this.getBrief(input.briefId)) {
			throw new Error(`Research brief not found: ${input.briefId}`);
		}
		assertCritiqueVerdict(input.verdict);
		const now = Date.now();
		const critique: CritiqueRecord = {
			...input,
			id: input.id ?? generateId("crit", now),
			createdAt: input.createdAt ?? now,
		};
		this.#db
			.query(
				`INSERT INTO research_critiques
					(id, brief_id, blocking_count, soft_count, verdict, summary, raw_output, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				critique.id,
				critique.briefId,
				critique.blockingCount,
				critique.softCount,
				critique.verdict,
				critique.summary,
				critique.rawOutput,
				critique.createdAt,
			);
		const mission = this.getMissionForBrief(critique.briefId);
		if (mission) {
			const missions = new MissionStore(this.dbPath);
			try {
				const runStatus =
					critique.blockingCount > 0 || critique.verdict === "reject" || critique.verdict === "needs-more-research"
						? "blocked"
						: "completed";
				missions.updateMission(mission.id, {
					state: runStatus === "blocked" ? "blocked" : "critiquing",
				});
				this.#finalizeLatestResearchRun(missions, mission.id, critique.briefId, runStatus, critique.createdAt);
				this.#missionEventBus?.emit({
					type: "research.critique.completed",
					missionId: mission.id,
					briefId: critique.briefId,
					blockingCount: critique.blockingCount,
					softCount: critique.softCount,
					verdict: critique.verdict,
					ts: critique.createdAt,
				});
			} finally {
				missions.close();
			}
		}
		return critique;
	}

	getLatestCritique(briefId: string): CritiqueRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM research_critiques WHERE brief_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(briefId) as CritiqueRecordRow | null;
		return row ? rowToCritique(row) : undefined;
	}

	listCritiques(briefId: string): CritiqueRecord[] {
		const rows = this.#db
			.query("SELECT * FROM research_critiques WHERE brief_id = ? ORDER BY created_at ASC, id ASC")
			.all(briefId) as CritiqueRecordRow[];
		return rows.map(rowToCritique);
	}

	getDecision(briefId: string): DecisionRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM decision_records WHERE brief_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(briefId) as DecisionRecordRow | null;
		return row ? rowToDecision(row) : undefined;
	}

	listDecisions(briefId: string): DecisionRecord[] {
		const rows = this.#db
			.query("SELECT * FROM decision_records WHERE brief_id = ? ORDER BY created_at ASC, id ASC")
			.all(briefId) as DecisionRecordRow[];
		return rows.map(rowToDecision);
	}

	#updateLiveLaneRunForEvidence(missionId: string, briefId: string, lane: ResearchLane, ts: number): void {
		const missions = new MissionStore(this.dbPath);
		try {
			const run = missions.getLatestResearchRunForMissionBrief(missionId, briefId);
			if (!run || run.status !== "running") return;
			const laneRun = missions.getLatestLaneRunForMissionLane(missionId, lane);
			if (!laneRun) return;
			const evidenceCount = this.#countEvidenceForLane(briefId, lane);
			missions.updateLaneRun(laneRun.id, {
				status: laneRun.status === "pending" ? "running" : laneRun.status,
				evidenceCount,
				startedAt: laneRun.startedAt ?? ts,
				emptyReason: evidenceCount > 0 ? null : laneRun.emptyReason,
			});
		} finally {
			missions.close();
		}
	}

	#finalizeLatestResearchRun(
		missions: MissionStore,
		missionId: string,
		briefId: string,
		status: "completed" | "blocked",
		completedAt: number,
	): void {
		const run = missions.getLatestResearchRunForMissionBrief(missionId, briefId);
		if (!run || run.status !== "running") return;
		const brief = this.getBrief(briefId);
		if (!brief) return;
		for (const laneRun of missions.listLatestLaneRunsForMissionLanes(missionId, brief.lanes)) {
			if (laneRun.status === "completed" || laneRun.status === "empty") continue;
			if (laneRun.evidenceCount > 0) {
				missions.updateLaneRun(laneRun.id, {
					status: "completed",
					endedAt: laneRun.endedAt ?? completedAt,
				});
			} else {
				missions.updateLaneRun(laneRun.id, {
					status: "empty",
					emptyReason: laneRun.emptyReason ?? "no evidence recorded",
					endedAt: laneRun.endedAt ?? completedAt,
				});
			}
		}
		missions.updateResearchRun(run.id, { status, completedAt: run.completedAt ?? completedAt });
	}

	#countEvidenceForLane(briefId: string, lane: ResearchLane): number {
		const row = this.#db
			.query("SELECT COUNT(*) AS count FROM evidence_cards WHERE brief_id = ? AND lane = ?")
			.get(briefId, lane) as { count: number } | null;
		return row?.count ?? 0;
	}

	#createMissionForBrief(brief: ResearchBrief): Mission {
		const missions = new MissionStore(this.dbPath);
		try {
			return missions.createMission({
				title: brief.question,
				objectiveId: brief.objectiveId,
				briefId: brief.id,
				decisionId: null,
				riskLevel: brief.riskLevel,
				state: "researching",
				confidence: null,
				snapshotRef: null,
			});
		} finally {
			missions.close();
		}
	}

	#init(): void {
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS research_briefs (
				id TEXT PRIMARY KEY,
				objective_id TEXT,
				question TEXT NOT NULL,
				lanes TEXT NOT NULL,
				required_evidence TEXT NOT NULL,
				disallowed_evidence TEXT NOT NULL,
				risk_level TEXT NOT NULL,
				stop_criteria TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS research_briefs_objective_idx ON research_briefs(objective_id);

			CREATE TABLE IF NOT EXISTS evidence_cards (
				id TEXT PRIMARY KEY,
				brief_id TEXT NOT NULL,
				lane TEXT NOT NULL,
				grade TEXT NOT NULL,
				source_ref TEXT NOT NULL,
				excerpt TEXT NOT NULL,
				claims TEXT NOT NULL,
				captured_at INTEGER NOT NULL,
				directness REAL NOT NULL,
				specificity REAL NOT NULL,
				recency REAL NOT NULL,
				reproducibility REAL NOT NULL,
				FOREIGN KEY (brief_id) REFERENCES research_briefs(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS evidence_cards_brief_idx ON evidence_cards(brief_id);
			CREATE INDEX IF NOT EXISTS evidence_cards_lane_idx ON evidence_cards(brief_id, lane);

			CREATE TABLE IF NOT EXISTS decision_records (
				id TEXT PRIMARY KEY,
				brief_id TEXT NOT NULL,
				hypothesis TEXT NOT NULL,
				rationale TEXT NOT NULL,
				confidence TEXT NOT NULL,
				evidence_refs TEXT NOT NULL,
				rejected_options TEXT NOT NULL,
				next_actions TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (brief_id) REFERENCES research_briefs(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS decision_records_brief_idx ON decision_records(brief_id);

			CREATE TABLE IF NOT EXISTS research_syntheses (
				id TEXT PRIMARY KEY,
				brief_id TEXT NOT NULL,
				hypothesis_count INTEGER NOT NULL,
				recommended TEXT,
				summary TEXT NOT NULL,
				raw_output TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (brief_id) REFERENCES research_briefs(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS research_syntheses_brief_idx ON research_syntheses(brief_id);

			CREATE TABLE IF NOT EXISTS research_critiques (
				id TEXT PRIMARY KEY,
				brief_id TEXT NOT NULL,
				blocking_count INTEGER NOT NULL,
				soft_count INTEGER NOT NULL,
				verdict TEXT NOT NULL,
				summary TEXT NOT NULL,
				raw_output TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (brief_id) REFERENCES research_briefs(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS research_critiques_brief_idx ON research_critiques(brief_id);
		`);
	}
}

function generateId(prefix: string, now: number): string {
	return `${prefix}-${now}-${randomBytes(4).toString("hex")}`;
}

function assertResearchLane(lane: ResearchLane): void {
	if (!VALID_LANES.has(lane)) {
		throw new Error(`Invalid research lane: ${lane}`);
	}
}

function assertEvidenceGrade(grade: EvidenceGrade): void {
	if (!VALID_GRADES.has(grade)) {
		throw new Error(`Invalid evidence grade: ${grade}`);
	}
}

function assertConfidence(confidence: ConfidenceLevel): void {
	if (!VALID_CONFIDENCE.has(confidence)) {
		throw new Error(`Invalid decision confidence: ${confidence}`);
	}
}

function assertCritiqueVerdict(verdict: CritiqueVerdict): void {
	if (!VALID_CRITIQUE_VERDICTS.has(verdict)) {
		throw new Error(`Invalid critique verdict: ${verdict}`);
	}
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function rowToBrief(row: ResearchBriefRow): ResearchBrief {
	return {
		id: row.id,
		objectiveId: row.objective_id,
		question: row.question,
		lanes: JSON.parse(row.lanes) as ResearchLane[],
		requiredEvidence: JSON.parse(row.required_evidence) as string[],
		disallowedEvidence: JSON.parse(row.disallowed_evidence) as string[],
		riskLevel: row.risk_level,
		stopCriteria: JSON.parse(row.stop_criteria) as string[],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToEvidence(row: EvidenceCardRow): EvidenceCard {
	return {
		id: row.id,
		briefId: row.brief_id,
		lane: row.lane,
		grade: row.grade,
		sourceRef: row.source_ref,
		excerpt: row.excerpt,
		claims: JSON.parse(row.claims) as string[],
		capturedAt: row.captured_at,
		directness: row.directness,
		specificity: row.specificity,
		recency: row.recency,
		reproducibility: row.reproducibility,
	};
}

function rowToDecision(row: DecisionRecordRow): DecisionRecord {
	return {
		id: row.id,
		briefId: row.brief_id,
		hypothesis: row.hypothesis,
		rationale: row.rationale,
		confidence: row.confidence,
		evidenceRefs: JSON.parse(row.evidence_refs) as string[],
		rejectedOptions: JSON.parse(row.rejected_options) as Array<{ id: string; reason: string }>,
		nextActions: JSON.parse(row.next_actions) as string[],
		createdAt: row.created_at,
	};
}

function rowToSynthesis(row: SynthesisRecordRow): SynthesisRecord {
	return {
		id: row.id,
		briefId: row.brief_id,
		hypothesisCount: row.hypothesis_count,
		recommended: row.recommended,
		summary: row.summary,
		rawOutput: row.raw_output,
		createdAt: row.created_at,
	};
}

function rowToCritique(row: CritiqueRecordRow): CritiqueRecord {
	return {
		id: row.id,
		briefId: row.brief_id,
		blockingCount: row.blocking_count,
		softCount: row.soft_count,
		verdict: row.verdict,
		summary: row.summary,
		rawOutput: row.raw_output,
		createdAt: row.created_at,
	};
}
