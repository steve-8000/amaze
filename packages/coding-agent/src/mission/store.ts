import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	CONFIDENCE_LEVELS,
	type ConfidenceLevel,
	RESEARCH_LANES,
	type ResearchLane,
	RISK_LEVELS,
	type RiskLevel,
} from "../research/types";
import type { MissionEventBus } from "./event-bus";
import { getMissionEventBus } from "./runtime";
import {
	EPISTEMIC_ROLES,
	type EpistemicRole,
	MISSION_LANE_STATUSES,
	MISSION_STATES,
	type Mission,
	type MissionContractRecord,
	type MissionLaneRun,
	type MissionLaneStatus,
	type MissionRollbackRecord,
	type MissionState,
	type MissionVerificationRecord,
	type NewMission,
	type NewMissionContractRecord,
	type NewMissionLaneRun,
	type NewMissionRollbackRecord,
	type NewMissionVerificationRecord,
	type NewResearchRun,
	RESEARCH_RUN_STATUSES,
	type ResearchRun,
	type ResearchRunStatus,
} from "./types";

export const DEFAULT_DB_PATH = path.join(os.homedir(), ".amaze", "autonomy", "autonomy.db");

const VALID_MISSION_STATES = new Set<MissionState>(MISSION_STATES);
const VALID_EPISTEMIC_ROLES = new Set<EpistemicRole>(EPISTEMIC_ROLES);
const VALID_LANE_STATUSES = new Set<MissionLaneStatus>(MISSION_LANE_STATUSES);
const VALID_RESEARCH_RUN_STATUSES = new Set<ResearchRunStatus>(RESEARCH_RUN_STATUSES);
const VALID_LANES = new Set<ResearchLane>(RESEARCH_LANES);
const VALID_RISK_LEVELS = new Set<RiskLevel>(RISK_LEVELS);
const VALID_CONFIDENCE = new Set<ConfidenceLevel>(CONFIDENCE_LEVELS);

type MissionRow = {
	id: string;
	title: string;
	objective_id: string | null;
	brief_id: string | null;
	decision_id: string | null;
	risk_level: RiskLevel;
	state: MissionState;
	confidence: ConfidenceLevel | null;
	snapshot_ref: string | null;
	created_at: number;
	updated_at: number;
};

type MissionLaneRunRow = {
	id: string;
	mission_id: string;
	lane: ResearchLane;
	agent: string;
	epistemic_role: EpistemicRole;
	status: MissionLaneStatus;
	evidence_count: number;
	empty_reason: string | null;
	task_id: string | null;
	started_at: number | null;
	ended_at: number | null;
};

type ResearchRunRow = {
	id: string;
	mission_id: string;
	brief_id: string;
	objective_id: string | null;
	status: ResearchRunStatus;
	started_at: number;
	completed_at: number | null;
};

type MissionContractRow = {
	id: string;
	mission_id: string;
	role: string;
	parent_contract_revision: number | null;
	include_json: string;
	exclude_json: string;
	success_criteria_json: string;
	escalation_json: string;
	input_artifact: string | null;
	must_produce_json: string;
	created_at: number;
};

type MissionVerificationRow = {
	id: string;
	mission_id: string;
	status: MissionVerificationRecord["status"];
	failed_count: number;
	uncertain_count: number;
	summary: string;
	created_at: number;
};

type MissionRollbackRow = {
	id: string;
	mission_id: string;
	target_type: MissionRollbackRecord["targetType"];
	target_id: string;
	snapshot_ref: string | null;
	summary: string;
	created_at: number;
};

export class MissionStore {
	readonly dbPath: string;
	readonly #db: Database;

	#eventBus: MissionEventBus | undefined;

	constructor(dbPath = DEFAULT_DB_PATH, eventBus?: MissionEventBus) {
		this.dbPath = dbPath;
		if (dbPath !== ":memory:") {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		}
		this.#db = new Database(dbPath, { create: true, strict: true });
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#eventBus = eventBus ?? (dbPath === ":memory:" ? undefined : getMissionEventBus());
		this.#init();
	}

	close(): void {
		this.#db.close();
	}

	createMission(input: NewMission): Mission {
		assertRiskLevel(input.riskLevel);
		assertMissionState(input.state);
		if (input.confidence !== null) {
			assertConfidence(input.confidence);
		}
		const now = Date.now();
		const mission: Mission = {
			...input,
			id: input.id ?? generateId("mission", now),
			createdAt: now,
			updatedAt: now,
		};
		this.#db
			.query(
				`INSERT INTO missions
					(id, title, objective_id, brief_id, decision_id, risk_level, state, confidence, snapshot_ref, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				mission.id,
				mission.title,
				mission.objectiveId,
				mission.briefId,
				mission.decisionId,
				mission.riskLevel,
				mission.state,
				mission.confidence,
				mission.snapshotRef,
				mission.createdAt,
				mission.updatedAt,
			);
		return mission;
	}

	getMission(id: string): Mission | undefined {
		const row = this.#db.query("SELECT * FROM missions WHERE id = ?").get(id) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	listMissions(opts: { objectiveId?: string; briefId?: string; state?: MissionState } = {}): Mission[] {
		const clauses: string[] = [];
		const params: string[] = [];
		if (opts.objectiveId !== undefined) {
			clauses.push("objective_id = ?");
			params.push(opts.objectiveId);
		}
		if (opts.briefId !== undefined) {
			clauses.push("brief_id = ?");
			params.push(opts.briefId);
		}
		if (opts.state !== undefined) {
			assertMissionState(opts.state);
			clauses.push("state = ?");
			params.push(opts.state);
		}
		const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.#db
			.query(`SELECT * FROM missions${where} ORDER BY created_at DESC, id DESC`)
			.all(...params) as MissionRow[];
		return rows.map(rowToMission);
	}

	getPreferredMission(opts: { objectiveId?: string; briefId?: string; title?: string } = {}): Mission | undefined {
		const clauses: string[] = [];
		const params: string[] = [];
		if (opts.objectiveId !== undefined) {
			clauses.push("objective_id = ?");
			params.push(opts.objectiveId);
		}
		if (opts.briefId !== undefined) {
			clauses.push("brief_id = ?");
			params.push(opts.briefId);
		}
		if (opts.title !== undefined) {
			clauses.push("title = ?");
			params.push(opts.title);
		}
		const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
		const row = this.#db
			.query(
				`SELECT * FROM missions${where}
				ORDER BY
					CASE WHEN state IN ('completed', 'rolled_back', 'blocked', 'cancelled') THEN 1 ELSE 0 END ASC,
					updated_at DESC,
					created_at DESC,
					id DESC
				LIMIT 1`,
			)
			.get(...params) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByObjectiveId(objectiveId: string): Mission | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE objective_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(objectiveId) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByBriefId(briefId: string): Mission | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE brief_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(briefId) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByTitle(title: string): Mission | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE title = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(title) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	updateMission(
		id: string,
		patch: Partial<Pick<Mission, "state" | "confidence" | "decisionId" | "snapshotRef">>,
	): Mission {
		const existing = this.getMission(id);
		if (!existing) {
			throw new Error(`Mission not found: ${id}`);
		}
		const next: Mission = {
			...existing,
			...patch,
			updatedAt: Date.now(),
		};
		assertMissionState(next.state);
		if (next.confidence !== null) {
			assertConfidence(next.confidence);
		}
		this.#db
			.query(
				`UPDATE missions
				SET state = ?, confidence = ?, decision_id = ?, snapshot_ref = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(next.state, next.confidence, next.decisionId, next.snapshotRef, next.updatedAt, id);
		return next;
	}

	createLaneRun(input: NewMissionLaneRun): MissionLaneRun {
		if (!this.getMission(input.missionId)) {
			throw new Error(`Mission not found: ${input.missionId}`);
		}
		assertResearchLane(input.lane);
		assertEpistemicRole(input.epistemicRole);
		assertLaneStatus(input.status);
		const now = Date.now();
		const run: MissionLaneRun = {
			...input,
			id: input.id ?? generateId("lane", now),
		};
		this.#db
			.query(
				`INSERT INTO mission_lane_runs
					(id, mission_id, lane, agent, epistemic_role, status, evidence_count, empty_reason, task_id, started_at, ended_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				run.id,
				run.missionId,
				run.lane,
				run.agent,
				run.epistemicRole,
				run.status,
				run.evidenceCount,
				run.emptyReason,
				run.taskId,
				run.startedAt,
				run.endedAt,
			);
		this.#eventBus?.emit({
			type: "research.lane.started",
			missionId: run.missionId,
			laneRunId: run.id,
			lane: run.lane,
			agent: run.agent,
			epistemicRole: run.epistemicRole,
			ts: run.startedAt ?? now,
		});
		return run;
	}

	listLaneRuns(missionId: string): MissionLaneRun[] {
		const rows = this.#db
			.query("SELECT * FROM mission_lane_runs WHERE mission_id = ? ORDER BY rowid ASC")
			.all(missionId) as MissionLaneRunRow[];
		return rows.map(rowToLaneRun);
	}

	getLatestLaneRunForMissionLane(missionId: string, lane: ResearchLane): MissionLaneRun | undefined {
		assertResearchLane(lane);
		const row = this.#db
			.query("SELECT * FROM mission_lane_runs WHERE mission_id = ? AND lane = ? ORDER BY rowid DESC LIMIT 1")
			.get(missionId, lane) as MissionLaneRunRow | null;
		return row ? rowToLaneRun(row) : undefined;
	}

	listLatestLaneRunsForMissionLanes(missionId: string, lanes: ResearchLane[]): MissionLaneRun[] {
		return lanes
			.map(lane => this.getLatestLaneRunForMissionLane(missionId, lane))
			.filter((run): run is MissionLaneRun => run !== undefined);
	}

	createResearchRun(input: NewResearchRun): ResearchRun {
		if (!this.getMission(input.missionId)) {
			throw new Error(`Mission not found: ${input.missionId}`);
		}
		assertResearchRunStatus(input.status);
		const now = Date.now();
		const run: ResearchRun = {
			...input,
			id: input.id ?? generateId("research-run", now),
			startedAt: input.startedAt ?? now,
		};
		this.#db
			.query(
				`INSERT INTO research_runs
					(id, mission_id, brief_id, objective_id, status, started_at, completed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(run.id, run.missionId, run.briefId, run.objectiveId, run.status, run.startedAt, run.completedAt);
		return run;
	}

	getResearchRun(id: string): ResearchRun | undefined {
		const row = this.#db.query("SELECT * FROM research_runs WHERE id = ?").get(id) as ResearchRunRow | null;
		return row ? rowToResearchRun(row) : undefined;
	}

	getLatestResearchRunForMission(missionId: string): ResearchRun | undefined {
		const row = this.#db
			.query("SELECT * FROM research_runs WHERE mission_id = ? ORDER BY started_at DESC, id DESC LIMIT 1")
			.get(missionId) as ResearchRunRow | null;
		return row ? rowToResearchRun(row) : undefined;
	}

	getLatestResearchRunForMissionBrief(missionId: string, briefId: string): ResearchRun | undefined {
		const row = this.#db
			.query(
				"SELECT * FROM research_runs WHERE mission_id = ? AND brief_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
			)
			.get(missionId, briefId) as ResearchRunRow | null;
		return row ? rowToResearchRun(row) : undefined;
	}

	listResearchRuns(opts: { missionId?: string; briefId?: string; status?: ResearchRunStatus } = {}): ResearchRun[] {
		const clauses: string[] = [];
		const params: string[] = [];
		if (opts.missionId !== undefined) {
			clauses.push("mission_id = ?");
			params.push(opts.missionId);
		}
		if (opts.briefId !== undefined) {
			clauses.push("brief_id = ?");
			params.push(opts.briefId);
		}
		if (opts.status !== undefined) {
			assertResearchRunStatus(opts.status);
			clauses.push("status = ?");
			params.push(opts.status);
		}
		const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.#db
			.query(`SELECT * FROM research_runs${where} ORDER BY started_at DESC, id DESC`)
			.all(...params) as ResearchRunRow[];
		return rows.map(rowToResearchRun);
	}

	updateResearchRun(id: string, patch: Partial<Pick<ResearchRun, "status" | "completedAt">>): ResearchRun {
		const existing = this.getResearchRun(id);
		if (!existing) {
			throw new Error(`Research run not found: ${id}`);
		}
		const next: ResearchRun = {
			...existing,
			...patch,
		};
		assertResearchRunStatus(next.status);
		this.#db
			.query(
				`UPDATE research_runs
				SET status = ?, completed_at = ?
				WHERE id = ?`,
			)
			.run(next.status, next.completedAt, id);
		return next;
	}

	recordContract(input: NewMissionContractRecord): MissionContractRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionContractRecord = {
			...input,
			id: input.id ?? generateId("contract", now),
			include: [...input.include],
			exclude: [...input.exclude],
			successCriteria: [...input.successCriteria],
			escalation: { ...input.escalation },
			mustProduce: [...input.mustProduce],
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_contracts
					(id, mission_id, role, parent_contract_revision, include_json, exclude_json, success_criteria_json, escalation_json, input_artifact, must_produce_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.role,
				record.parentContractRevision,
				JSON.stringify(record.include),
				JSON.stringify(record.exclude),
				JSON.stringify(record.successCriteria),
				JSON.stringify(record.escalation),
				record.inputArtifact,
				JSON.stringify(record.mustProduce),
				record.createdAt,
			);
		this.#eventBus?.emit({
			type: "contract.created",
			missionId: record.missionId,
			contractId: record.id,
			role: record.role,
			ts: record.createdAt,
		});
		return record;
	}

	listContracts(missionId: string): MissionContractRecord[] {
		const rows = this.#db
			.query("SELECT * FROM mission_contracts WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionContractRow[];
		return rows.map(rowToContract);
	}

	recordVerification(input: NewMissionVerificationRecord): MissionVerificationRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionVerificationRecord = {
			...input,
			id: input.id ?? generateId("verification", now),
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_verifications
					(id, mission_id, status, failed_count, uncertain_count, summary, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.status,
				record.failedCount,
				record.uncertainCount,
				record.summary,
				record.createdAt,
			);
		this.#eventBus?.emit({
			type: "verification.completed",
			missionId: record.missionId,
			verificationId: record.id,
			status: record.status,
			failedCount: record.failedCount,
			uncertainCount: record.uncertainCount,
			ts: record.createdAt,
		});
		return record;
	}

	getLatestVerification(missionId: string): MissionVerificationRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM mission_verifications WHERE mission_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(missionId) as MissionVerificationRow | null;
		return row ? rowToVerification(row) : undefined;
	}

	recordRollback(input: NewMissionRollbackRecord): MissionRollbackRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionRollbackRecord = {
			...input,
			id: input.id ?? generateId("rollback", now),
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_rollbacks
					(id, mission_id, target_type, target_id, snapshot_ref, summary, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.targetType,
				record.targetId,
				record.snapshotRef,
				record.summary,
				record.createdAt,
			);
		this.#eventBus?.emit({
			type: "rollback.snapshot.created",
			missionId: record.missionId,
			rollbackId: record.id,
			targetType: record.targetType,
			targetId: record.targetId,
			snapshotRef: record.snapshotRef,
			ts: record.createdAt,
		});
		return record;
	}

	listRollbacks(missionId: string): MissionRollbackRecord[] {
		const rows = this.#db
			.query("SELECT * FROM mission_rollbacks WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionRollbackRow[];
		return rows.map(rowToRollback);
	}

	updateLaneRun(
		id: string,
		patch: Partial<
			Pick<MissionLaneRun, "status" | "evidenceCount" | "emptyReason" | "taskId" | "startedAt" | "endedAt">
		>,
	): MissionLaneRun {
		const row = this.#db.query("SELECT * FROM mission_lane_runs WHERE id = ?").get(id) as MissionLaneRunRow | null;
		if (!row) {
			throw new Error(`Mission lane run not found: ${id}`);
		}
		const next: MissionLaneRun = {
			...rowToLaneRun(row),
			...patch,
		};
		assertLaneStatus(next.status);
		this.#db
			.query(
				`UPDATE mission_lane_runs
				SET status = ?, evidence_count = ?, empty_reason = ?, task_id = ?, started_at = ?, ended_at = ?
				WHERE id = ?`,
			)
			.run(next.status, next.evidenceCount, next.emptyReason, next.taskId, next.startedAt, next.endedAt, id);
		if (isTerminalLaneStatus(next.status)) {
			this.#eventBus?.emit({
				type: "research.lane.completed",
				missionId: next.missionId,
				laneRunId: next.id,
				lane: next.lane,
				status: next.status,
				evidenceCount: next.evidenceCount,
				emptyReason: next.emptyReason,
				ts: next.endedAt ?? Date.now(),
			});
		}
		return next;
	}

	#init(): void {
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS missions (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				objective_id TEXT,
				brief_id TEXT,
				decision_id TEXT,
				risk_level TEXT NOT NULL,
				state TEXT NOT NULL,
				confidence TEXT,
				snapshot_ref TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS missions_objective_idx ON missions(objective_id);
			CREATE INDEX IF NOT EXISTS missions_brief_idx ON missions(brief_id);
			CREATE INDEX IF NOT EXISTS missions_state_idx ON missions(state);

			CREATE TABLE IF NOT EXISTS mission_lane_runs (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				lane TEXT NOT NULL,
				agent TEXT NOT NULL,
				epistemic_role TEXT NOT NULL,
				status TEXT NOT NULL,
				evidence_count INTEGER NOT NULL,
				empty_reason TEXT,
				task_id TEXT,
				started_at INTEGER,
				ended_at INTEGER,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_lane_runs_mission_idx ON mission_lane_runs(mission_id);
			CREATE INDEX IF NOT EXISTS mission_lane_runs_status_idx ON mission_lane_runs(mission_id, status);

			CREATE TABLE IF NOT EXISTS research_runs (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				brief_id TEXT NOT NULL,
				objective_id TEXT,
				status TEXT NOT NULL,
				started_at INTEGER NOT NULL,
				completed_at INTEGER,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS research_runs_mission_idx ON research_runs(mission_id);
			CREATE INDEX IF NOT EXISTS research_runs_brief_idx ON research_runs(brief_id);
			CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status);

			CREATE TABLE IF NOT EXISTS mission_contracts (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				role TEXT NOT NULL,
				parent_contract_revision INTEGER,
				include_json TEXT NOT NULL CHECK (json_valid(include_json)),
				exclude_json TEXT NOT NULL CHECK (json_valid(exclude_json)),
				success_criteria_json TEXT NOT NULL CHECK (json_valid(success_criteria_json)),
				escalation_json TEXT NOT NULL CHECK (json_valid(escalation_json)),
				input_artifact TEXT,
				must_produce_json TEXT NOT NULL CHECK (json_valid(must_produce_json)),
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_contracts_mission_idx ON mission_contracts(mission_id);

			CREATE TABLE IF NOT EXISTS mission_verifications (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				status TEXT NOT NULL,
				failed_count INTEGER NOT NULL,
				uncertain_count INTEGER NOT NULL,
				summary TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_verifications_mission_idx ON mission_verifications(mission_id);

			CREATE TABLE IF NOT EXISTS mission_rollbacks (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				target_type TEXT NOT NULL,
				target_id TEXT NOT NULL,
				snapshot_ref TEXT,
				summary TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_rollbacks_mission_idx ON mission_rollbacks(mission_id);
		`);
	}
}

function generateId(prefix: string, now: number): string {
	return `${prefix}-${now}-${randomBytes(4).toString("hex")}`;
}

function assertMissionState(state: MissionState): void {
	if (!VALID_MISSION_STATES.has(state)) {
		throw new Error(`Invalid mission state: ${state}`);
	}
}

function assertEpistemicRole(role: EpistemicRole): void {
	if (!VALID_EPISTEMIC_ROLES.has(role)) {
		throw new Error(`Invalid epistemic role: ${role}`);
	}
}

function assertLaneStatus(status: MissionLaneStatus): void {
	if (!VALID_LANE_STATUSES.has(status)) {
		throw new Error(`Invalid mission lane status: ${status}`);
	}
}

function assertResearchRunStatus(status: ResearchRunStatus): void {
	if (!VALID_RESEARCH_RUN_STATUSES.has(status)) {
		throw new Error(`Invalid research run status: ${status}`);
	}
}

function assertResearchLane(lane: ResearchLane): void {
	if (!VALID_LANES.has(lane)) {
		throw new Error(`Invalid research lane: ${lane}`);
	}
}

function assertRiskLevel(riskLevel: RiskLevel): void {
	if (!VALID_RISK_LEVELS.has(riskLevel)) {
		throw new Error(`Invalid mission risk level: ${riskLevel}`);
	}
}

function assertConfidence(confidence: ConfidenceLevel): void {
	if (!VALID_CONFIDENCE.has(confidence)) {
		throw new Error(`Invalid mission confidence: ${confidence}`);
	}
}

function isTerminalLaneStatus(status: MissionLaneStatus): boolean {
	return status === "completed" || status === "empty" || status === "failed" || status === "aborted";
}

function rowToMission(row: MissionRow): Mission {
	return {
		id: row.id,
		title: row.title,
		objectiveId: row.objective_id,
		briefId: row.brief_id,
		decisionId: row.decision_id,
		riskLevel: row.risk_level,
		state: row.state,
		confidence: row.confidence,
		snapshotRef: row.snapshot_ref,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToLaneRun(row: MissionLaneRunRow): MissionLaneRun {
	return {
		id: row.id,
		missionId: row.mission_id,
		lane: row.lane,
		agent: row.agent,
		epistemicRole: row.epistemic_role,
		status: row.status,
		evidenceCount: row.evidence_count,
		emptyReason: row.empty_reason,
		taskId: row.task_id,
		startedAt: row.started_at,
		endedAt: row.ended_at,
	};
}

function rowToResearchRun(row: ResearchRunRow): ResearchRun {
	return {
		id: row.id,
		missionId: row.mission_id,
		briefId: row.brief_id,
		objectiveId: row.objective_id,
		status: row.status,
		startedAt: row.started_at,
		completedAt: row.completed_at,
	};
}

function rowToContract(row: MissionContractRow): MissionContractRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		role: row.role,
		parentContractRevision: row.parent_contract_revision,
		include: parseStringArray(row.include_json, "include_json"),
		exclude: parseStringArray(row.exclude_json, "exclude_json"),
		successCriteria: parseStringArray(row.success_criteria_json, "success_criteria_json"),
		escalation: parseEscalation(row.escalation_json),
		inputArtifact: row.input_artifact,
		mustProduce: parseStringArray(row.must_produce_json, "must_produce_json"),
		createdAt: row.created_at,
	};
}

function rowToVerification(row: MissionVerificationRow): MissionVerificationRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		status: row.status,
		failedCount: row.failed_count,
		uncertainCount: row.uncertain_count,
		summary: row.summary,
		createdAt: row.created_at,
	};
}

function rowToRollback(row: MissionRollbackRow): MissionRollbackRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		targetType: row.target_type,
		targetId: row.target_id,
		snapshotRef: row.snapshot_ref,
		summary: row.summary,
		createdAt: row.created_at,
	};
}

function parseStringArray(value: string, column: string): string[] {
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string")) {
		throw new Error(`Invalid mission contract JSON column: ${column}`);
	}
	return parsed;
}

function parseEscalation(value: string): MissionContractRecord["escalation"] {
	const parsed = JSON.parse(value) as Partial<MissionContractRecord["escalation"]>;
	if (
		(parsed.onUncertainty !== "ask-parent" && parsed.onUncertainty !== "block") ||
		typeof parsed.budgetCap !== "number"
	) {
		throw new Error("Invalid mission contract JSON column: escalation_json");
	}
	return { onUncertainty: parsed.onUncertainty, budgetCap: parsed.budgetCap };
}
