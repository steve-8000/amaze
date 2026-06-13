import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CapabilityLease } from "../agi/capability-lease";
import type { ObjectiveContract, RuntimeAction } from "../autonomy/types";

import {
	CONFIDENCE_LEVELS,
	type ConfidenceLevel,
	RESEARCH_LANES,
	type ResearchLane,
	RISK_LEVELS,
	type RiskLevel,
} from "../research/types";
import type { ContinuationStatus, MissionContinuationRecord } from "./continuation/types";
import type { AcceptanceCriterion } from "./core/acceptance-criteria";
import type { MissionPlan, MissionPlanStep, MissionPlanStepEdge } from "./core/mission";
import type { MissionBudget, MissionContextBudget } from "./core/mission-budget";
import type { MissionProposal, MissionProposalStatus, NewMissionProposal } from "./core/mission-proposal";
import { MISSION_PROPOSAL_STATUSES } from "./core/mission-proposal";
import type { MissionScopeGuard } from "./core/mission-scope";
import type { MissionTask, MissionTaskStatus } from "./core/mission-task";
import type { MissionEventBus } from "./event-bus";
import { getMissionEventBus } from "./runtime";
import {
	type CriticDialogueRole,
	EPISTEMIC_ROLES,
	type EpistemicRole,
	MISSION_LANE_STATUSES,
	MISSION_STATES,
	type MissionContractRecord,
	type MissionCriticDialogueTurn,
	type MissionLaneRun,
	type MissionLaneStatus,
	type MissionPhaseRecord,
	type MissionPhaseVerificationRecord,
	type MissionReviewRecord,
	type MissionRollbackRecord,
	type MissionState,
	type MissionTaskAttemptCheckpoint,
	type MissionVerificationRecord,
	type MissionWorldModelLink,
	type MissionWorldModelRecord,
	type MissionWorldModelRecordKind,
	type MissionWorldModelRecordSource,
	type NewMissionContractRecord,
	type NewMissionCriticDialogueTurn,
	type NewMissionLaneRun,
	type NewMissionPhaseRecord,
	type NewMissionPhaseVerificationRecord,
	type NewMissionReviewRecord,
	type NewMissionRollbackRecord,
	type NewMissionTaskAttemptCheckpoint,
	type NewMissionVerificationRecord,
	type NewMissionWorldModelRecord,
	type NewResearchCampaign,
	type NewResearchRun,
	RESEARCH_RUN_STATUSES,
	type ResearchCampaign,
	type ResearchRun,
	type ResearchRunStatus,
	type RuntimeEvent,
	type RuntimeEventDraft,
	type RuntimeEventType,
} from "./types";

export const DEFAULT_DB_PATH = path.join(os.homedir(), ".amaze", "autonomy", "autonomy.db");

const VALID_MISSION_STATES = new Set<MissionState>(MISSION_STATES);
const VALID_EPISTEMIC_ROLES = new Set<EpistemicRole>(EPISTEMIC_ROLES);
const VALID_LANE_STATUSES = new Set<MissionLaneStatus>(MISSION_LANE_STATUSES);
const VALID_RESEARCH_RUN_STATUSES = new Set<ResearchRunStatus>(RESEARCH_RUN_STATUSES);
const VALID_LANES = new Set<ResearchLane>(RESEARCH_LANES);
const VALID_RISK_LEVELS = new Set<RiskLevel>(RISK_LEVELS);
const VALID_CONFIDENCE = new Set<ConfidenceLevel>(CONFIDENCE_LEVELS);

type StoreMigration = {
	version: number;
	description: string;
	up: (db: Database) => void;
};

const MIGRATIONS: StoreMigration[] = [
	{
		version: 1,
		description: "baseline schema (all current CREATE TABLE/INDEX + ensureColumn additive backfills)",
		up: db => {
			db.exec(`
			CREATE TABLE IF NOT EXISTS missions (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				objective TEXT,
				objective_id TEXT,
				brief_id TEXT,
				decision_id TEXT,
				risk_level TEXT NOT NULL,
				state TEXT NOT NULL,
				confidence TEXT,
				snapshot_ref TEXT,
				mode TEXT NOT NULL DEFAULT 'interactive',
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
				task_id TEXT,
				session_file TEXT,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_contracts_mission_idx ON mission_contracts(mission_id);

			CREATE TABLE IF NOT EXISTS mission_phases (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				status TEXT NOT NULL,
				plan_step_ids_json TEXT NOT NULL CHECK (json_valid(plan_step_ids_json)),
				acceptance_criteria_json TEXT NOT NULL CHECK (json_valid(acceptance_criteria_json)),
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				closed_at INTEGER,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_phases_mission_idx ON mission_phases(mission_id);

			CREATE TABLE IF NOT EXISTS mission_phase_verifications (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				phase_id TEXT NOT NULL,
				status TEXT NOT NULL,
				failed_count INTEGER NOT NULL,
				uncertain_count INTEGER NOT NULL,
				summary TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				FOREIGN KEY (phase_id) REFERENCES mission_phases(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_phase_verifications_mission_idx ON mission_phase_verifications(mission_id);

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

			CREATE TABLE IF NOT EXISTS mission_reviews (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				status TEXT NOT NULL,
				verdict TEXT NOT NULL,
				failed_count INTEGER NOT NULL,
				uncertain_count INTEGER NOT NULL,
				summary TEXT NOT NULL,
				source_files_json TEXT NOT NULL CHECK (json_valid(source_files_json)),
				excluded_markdown_files_json TEXT NOT NULL CHECK (json_valid(excluded_markdown_files_json)),
				created_at INTEGER NOT NULL,
				reviewed_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_reviews_mission_idx ON mission_reviews(mission_id);

			CREATE TABLE IF NOT EXISTS mission_task_attempt_checkpoints (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				task_id TEXT NOT NULL,
				agent TEXT NOT NULL,
				role TEXT NOT NULL,
				attempt INTEGER NOT NULL,
				status TEXT NOT NULL,
				failure_mode TEXT,
				last_verdict TEXT,
				failed_count INTEGER NOT NULL,
				uncertain_count INTEGER NOT NULL,
				remediation_action TEXT NOT NULL,
				session_file TEXT,
				artifact_refs_json TEXT NOT NULL CHECK (json_valid(artifact_refs_json)),
				error TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_task_attempt_checkpoints_mission_idx ON mission_task_attempt_checkpoints(mission_id);
			CREATE INDEX IF NOT EXISTS mission_task_attempt_checkpoints_task_idx ON mission_task_attempt_checkpoints(mission_id, task_id);


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

			CREATE TABLE IF NOT EXISTS mission_critic_dialogue (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				role TEXT NOT NULL,
				summary TEXT NOT NULL,
				check_ids_json TEXT NOT NULL CHECK (json_valid(check_ids_json)),
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_critic_dialogue_mission_idx ON mission_critic_dialogue(mission_id);


			CREATE TABLE IF NOT EXISTS mission_world_model (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				source TEXT NOT NULL,
				source_id TEXT NOT NULL,
				claim TEXT NOT NULL,
				evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
				links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links_json)),
				outcome_status TEXT,
				verified INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_world_model_mission_idx ON mission_world_model(mission_id);

			CREATE TABLE IF NOT EXISTS mission_tasks (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				title TEXT NOT NULL,
				objective TEXT,
				status TEXT NOT NULL,
				assigned_agent TEXT,
				plan_step_id TEXT,
				data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_tasks_mission_idx ON mission_tasks(mission_id);
			CREATE INDEX IF NOT EXISTS mission_tasks_status_idx ON mission_tasks(mission_id, status);

			CREATE TABLE IF NOT EXISTS mission_plans (
				mission_id TEXT PRIMARY KEY,
				rationale TEXT,
				revision INTEGER,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS mission_plan_steps (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL,
				description TEXT NOT NULL,
				edges_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(edges_json)),
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_plan_steps_mission_idx ON mission_plan_steps(mission_id);

			CREATE TABLE IF NOT EXISTS mission_acceptance_criteria (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL,
				description TEXT NOT NULL,
				satisfied INTEGER NOT NULL DEFAULT 0,
				verification_method TEXT,
				evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_acceptance_criteria_mission_idx ON mission_acceptance_criteria(mission_id);

			CREATE TABLE IF NOT EXISTS mission_budgets (
				mission_id TEXT PRIMARY KEY,
				token_budget INTEGER NOT NULL,
				tokens_used INTEGER NOT NULL DEFAULT 0,
				time_budget_ms INTEGER,
				time_used_ms INTEGER,
				task_budget INTEGER,
				tasks_used INTEGER,
				max_context_tokens INTEGER NOT NULL,
				context_tokens_used INTEGER NOT NULL DEFAULT 0,
				compaction_threshold REAL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS mission_scope_guards (
				mission_id TEXT PRIMARY KEY,
				allowed_paths_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_paths_json)),
				denied_paths_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(denied_paths_json)),
				allowed_tools_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_tools_json)),
				allow_sub_missions INTEGER NOT NULL DEFAULT 0,
				notes TEXT,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS mission_proposals (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				artifact_uri TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				status TEXT NOT NULL,
				approved_by TEXT,
				approved_at INTEGER,
				summary TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_proposals_mission_idx ON mission_proposals(mission_id);
			CREATE INDEX IF NOT EXISTS mission_proposals_status_idx ON mission_proposals(mission_id, status);

			CREATE TABLE IF NOT EXISTS runtime_events (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				stream_id TEXT NOT NULL,
				sequence INTEGER NOT NULL,
				type TEXT NOT NULL,
				occurred_at INTEGER NOT NULL,
				correlation_id TEXT,
				causation_id TEXT,
				actor TEXT,
				idempotency_key TEXT,
				payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
				evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
				schema_version INTEGER NOT NULL,
				hash TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				UNIQUE(stream_id, sequence),
				UNIQUE(stream_id, idempotency_key)
			);
			CREATE INDEX IF NOT EXISTS runtime_events_mission_idx ON runtime_events(mission_id, occurred_at);
			CREATE INDEX IF NOT EXISTS runtime_events_stream_idx ON runtime_events(stream_id, sequence);
			CREATE INDEX IF NOT EXISTS runtime_events_hash_idx ON runtime_events(hash);
			`);
			ensureColumn(db, "missions", "intent", "TEXT");
			ensureColumn(db, "missions", "mode", "TEXT NOT NULL DEFAULT 'interactive'");
			ensureColumn(db, "missions", "objective", "TEXT");
			db.run("UPDATE missions SET objective = title WHERE objective IS NULL");
			ensureColumn(db, "missions", "lifecycle", "TEXT");
			ensureColumn(db, "missions", "proposal_id", "TEXT");
			ensureColumn(db, "missions", "regression_contract_id", "TEXT");
			ensureColumn(
				db,
				"missions",
				"design_answers_json",
				"TEXT CHECK (design_answers_json IS NULL OR json_valid(design_answers_json))",
			);
			ensureColumn(db, "mission_contracts", "task_id", "TEXT");
			ensureColumn(db, "mission_contracts", "session_file", "TEXT");
			ensureColumn(
				db,
				"mission_world_model",
				"links_json",
				"TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links_json))",
			);
			ensureColumn(db, "mission_world_model", "outcome_status", "TEXT");
		},
	},
	{
		version: 2,
		description: "add missions.revision",
		up: db => {
			ensureColumn(db, "missions", "revision", "INTEGER NOT NULL DEFAULT 0");
		},
	},
	{
		version: 3,
		description: "add mission_continuation ledger",
		up: db => {
			db.exec(`
			CREATE TABLE IF NOT EXISTS mission_continuation (
				mission_id TEXT PRIMARY KEY,
				session_id TEXT,
				owner_branch TEXT,
				owner_tree_id TEXT,
				status TEXT NOT NULL,
				generation INTEGER NOT NULL DEFAULT 0,
				auto_turn_count INTEGER NOT NULL DEFAULT 0,
				tokens_used INTEGER NOT NULL DEFAULT 0,
				time_used_seconds INTEGER NOT NULL DEFAULT 0,
				progress_fingerprint TEXT,
				no_progress_count INTEGER NOT NULL DEFAULT 0,
				last_reason TEXT,
				last_scheduled_at INTEGER,
				last_started_at INTEGER,
				last_ended_at INTEGER,
				last_turn_id TEXT,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_continuation_status_idx ON mission_continuation(status);
			`);
		},
	},
	{
		version: 4,
		description: "add mission review verdicts",
		up: db => {
			db.exec(`
			CREATE TABLE IF NOT EXISTS mission_reviews (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				status TEXT NOT NULL,
				verdict TEXT NOT NULL,
				failed_count INTEGER NOT NULL,
				uncertain_count INTEGER NOT NULL,
				summary TEXT NOT NULL,
				source_files_json TEXT NOT NULL CHECK (json_valid(source_files_json)),
				excluded_markdown_files_json TEXT NOT NULL CHECK (json_valid(excluded_markdown_files_json)),
				created_at INTEGER NOT NULL,
				reviewed_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS mission_reviews_mission_idx ON mission_reviews(mission_id);
			`);
		},
	},
	{
		version: 5,
		description: "scope mission_plan_steps primary key per mission",
		up: db => {
			// Step ids are planner-local slugs (s1, s2, …): two missions legitimately
			// reuse the same id. The baseline table made `id` a global PRIMARY KEY,
			// so the second mission's savePlan hit UNIQUE constraint failures.
			// Recreate with a composite (mission_id, id) key.
			db.exec(`
			CREATE TABLE IF NOT EXISTS mission_plan_steps_v5 (
				id TEXT NOT NULL,
				mission_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL,
				description TEXT NOT NULL,
				edges_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(edges_json)),
				PRIMARY KEY (mission_id, id)
			);
			INSERT OR IGNORE INTO mission_plan_steps_v5 (id, mission_id, ordinal, description, edges_json)
				SELECT id, mission_id, ordinal, description, edges_json FROM mission_plan_steps;
			DROP TABLE mission_plan_steps;
			ALTER TABLE mission_plan_steps_v5 RENAME TO mission_plan_steps;
			CREATE INDEX IF NOT EXISTS mission_plan_steps_mission_idx ON mission_plan_steps(mission_id);
			`);
		},
	},
	{
		version: 6,
		description: "add mission objectives and runtime event ledger",
		up: db => {
			ensureColumn(db, "missions", "objective", "TEXT");
			ensureColumn(db, "missions", "mode", "TEXT NOT NULL DEFAULT 'interactive'");
			db.run("UPDATE missions SET objective = title WHERE objective IS NULL");
			db.exec(`
			CREATE TABLE IF NOT EXISTS runtime_events (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				stream_id TEXT NOT NULL,
				sequence INTEGER NOT NULL,
				type TEXT NOT NULL,
				occurred_at INTEGER NOT NULL,
				correlation_id TEXT,
				causation_id TEXT,
				actor TEXT,
				idempotency_key TEXT,
				payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
				evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
				schema_version INTEGER NOT NULL,
				hash TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				UNIQUE(stream_id, sequence),
				UNIQUE(stream_id, idempotency_key)
			);
			CREATE INDEX IF NOT EXISTS runtime_events_mission_idx ON runtime_events(mission_id, occurred_at);
			CREATE INDEX IF NOT EXISTS runtime_events_stream_idx ON runtime_events(stream_id, sequence);
			CREATE INDEX IF NOT EXISTS runtime_events_hash_idx ON runtime_events(hash);

			CREATE TABLE IF NOT EXISTS objective_contracts (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				contract_json TEXT NOT NULL CHECK (json_valid(contract_json)),
				created_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS objective_contracts_mission_idx ON objective_contracts(mission_id);

			CREATE TABLE IF NOT EXISTS runtime_actions (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				objective_contract_id TEXT NOT NULL,
				plan_id TEXT NOT NULL,
				step_id TEXT NOT NULL,
				action_json TEXT NOT NULL CHECK (json_valid(action_json)),
				lease_json TEXT NOT NULL CHECK (json_valid(lease_json)),
				status TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				FOREIGN KEY (objective_contract_id) REFERENCES objective_contracts(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS runtime_actions_mission_idx ON runtime_actions(mission_id, created_at);
			CREATE INDEX IF NOT EXISTS runtime_actions_status_idx ON runtime_actions(status);
			`);
		},
	},
	{
		version: 7,
		description: "persist mission mode with interactive legacy default",
		up: db => {
			ensureColumn(db, "missions", "mode", "TEXT NOT NULL DEFAULT 'interactive'");
			db.run("UPDATE missions SET mode = 'interactive' WHERE mode IS NULL OR trim(mode) = ''");
		},
	},
	{
		version: 8,
		description: "durable AGI objective contracts, runtime actions, and capability leases",
		up: db => {
			db.exec(`
			CREATE TABLE IF NOT EXISTS objective_contracts (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				contract_hash TEXT NOT NULL DEFAULT '',
				contract_json TEXT NOT NULL CHECK (json_valid(contract_json)),
				status TEXT NOT NULL DEFAULT 'active',
				created_at INTEGER NOT NULL,
				approved_at INTEGER,
				approved_by TEXT,
				supersedes_contract_id TEXT,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS runtime_actions (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				objective_contract_id TEXT NOT NULL,
				plan_id TEXT NOT NULL,
				step_id TEXT NOT NULL,
				plan_step_id TEXT NOT NULL DEFAULT '',
				role TEXT NOT NULL DEFAULT '',
				instruction TEXT NOT NULL DEFAULT '',
				dependencies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dependencies_json)),
				acceptance_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_criteria_json)),
				required_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_evidence_json)),
				scope_guard_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_guard_json)),
				budget_guard_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(budget_guard_json)),
				action_json TEXT NOT NULL CHECK (json_valid(action_json)),
				lease_json TEXT CHECK (lease_json IS NULL OR json_valid(lease_json)),
				lease_id TEXT,
				status TEXT NOT NULL,
				attempt_count INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER,
				last_error TEXT,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				FOREIGN KEY (objective_contract_id) REFERENCES objective_contracts(id) ON DELETE CASCADE
			);
			`);
			ensureColumn(db, "objective_contracts", "contract_hash", "TEXT NOT NULL DEFAULT ''");
			ensureColumn(db, "objective_contracts", "status", "TEXT NOT NULL DEFAULT 'active'");
			ensureColumn(db, "objective_contracts", "approved_at", "INTEGER");
			ensureColumn(db, "objective_contracts", "approved_by", "TEXT");
			ensureColumn(db, "objective_contracts", "supersedes_contract_id", "TEXT");
			ensureColumn(db, "runtime_actions", "plan_step_id", "TEXT NOT NULL DEFAULT ''");
			ensureColumn(db, "runtime_actions", "role", "TEXT NOT NULL DEFAULT ''");
			ensureColumn(db, "runtime_actions", "instruction", "TEXT NOT NULL DEFAULT ''");
			ensureColumn(
				db,
				"runtime_actions",
				"dependencies_json",
				"TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dependencies_json))",
			);
			ensureColumn(
				db,
				"runtime_actions",
				"acceptance_criteria_json",
				"TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_criteria_json))",
			);
			ensureColumn(
				db,
				"runtime_actions",
				"required_evidence_json",
				"TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_evidence_json))",
			);
			ensureColumn(
				db,
				"runtime_actions",
				"scope_guard_json",
				"TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_guard_json))",
			);
			ensureColumn(
				db,
				"runtime_actions",
				"budget_guard_json",
				"TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(budget_guard_json))",
			);
			ensureColumn(db, "runtime_actions", "lease_id", "TEXT");
			ensureColumn(db, "runtime_actions", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
			ensureColumn(db, "runtime_actions", "started_at", "INTEGER");
			ensureColumn(db, "runtime_actions", "completed_at", "INTEGER");
			ensureColumn(db, "runtime_actions", "last_error", "TEXT");
			db.exec(`
			CREATE INDEX IF NOT EXISTS objective_contracts_mission_idx ON objective_contracts(mission_id, created_at);
			CREATE INDEX IF NOT EXISTS objective_contracts_hash_idx ON objective_contracts(contract_hash);
			CREATE INDEX IF NOT EXISTS runtime_actions_mission_idx ON runtime_actions(mission_id, created_at);
			CREATE INDEX IF NOT EXISTS runtime_actions_status_idx ON runtime_actions(status, created_at);
			CREATE INDEX IF NOT EXISTS runtime_actions_contract_step_idx ON runtime_actions(objective_contract_id, plan_step_id);
			CREATE TABLE IF NOT EXISTS capability_leases (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				runtime_action_id TEXT NOT NULL,
				lease_json TEXT NOT NULL CHECK (json_valid(lease_json)),
				status TEXT NOT NULL,
				issued_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				revoked_at INTEGER,
				revoked_reason TEXT,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
				FOREIGN KEY (runtime_action_id) REFERENCES runtime_actions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS capability_leases_action_idx ON capability_leases(runtime_action_id);
			CREATE INDEX IF NOT EXISTS capability_leases_status_idx ON capability_leases(status, expires_at);
			`);
		},
	},
	{
		version: 9,
		description: "durable AGI governance approvals and emergency stops",
		up: db => {
			db.exec(`
			CREATE TABLE IF NOT EXISTS agi_approval_requests (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL,
				action_id TEXT NOT NULL,
				risk TEXT NOT NULL,
				status TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				decided_at INTEGER,
				decided_by TEXT,
				reason TEXT,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS agi_approval_requests_mission_idx ON agi_approval_requests(mission_id, created_at);
			CREATE INDEX IF NOT EXISTS agi_approval_requests_action_idx ON agi_approval_requests(action_id);

			CREATE TABLE IF NOT EXISTS agi_emergency_stops (
				mission_id TEXT PRIMARY KEY,
				stopped_at INTEGER NOT NULL,
				reason TEXT,
				FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
			);
			`);
		},
	},
];

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
	const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (rows.some(row => row.name === column)) return;
	db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

type MissionRow = {
	id: string;
	title: string;
	objective: string | null;
	objective_id: string | null;
	brief_id: string | null;
	decision_id: string | null;
	risk_level: RiskLevel;
	state: MissionState;
	confidence: ConfidenceLevel | null;
	snapshot_ref: string | null;
	created_at: number;
	updated_at: number;
	revision: number;
	intent: string | null;
	lifecycle: string | null;
	mode: string | null;
	proposal_id: string | null;
	regression_contract_id: string | null;
};

type RuntimeEventRow = {
	id: string;
	mission_id: string;
	stream_id: string;
	sequence: number;
	type: RuntimeEventType;
	occurred_at: number;
	correlation_id: string | null;
	causation_id: string | null;
	actor: string | null;
	idempotency_key: string | null;
	payload_json: string;
	evidence_refs_json: string;
	schema_version: number;
	hash: string;
	created_at: number;
};

type ObjectiveContractRow = {
	id: string;
	mission_id: string;
	contract_hash: string;
	contract_json: string;
	status: ObjectiveContractRecord["status"];
	created_at: number;
	approved_at: number | null;
	approved_by: string | null;
	supersedes_contract_id: string | null;
};

type AgiApprovalRequestRow = {
	id: string;
	mission_id: string;
	action_id: string;
	risk: "low" | "medium" | "high" | "critical";
	status: "pending" | "approved" | "rejected";
	created_at: number;
	decided_at: number | null;
	decided_by: string | null;
	reason: string | null;
};

type AgiEmergencyStopRow = {
	mission_id: string;
	stopped_at: number;
	reason: string | null;
};

type RuntimeActionRow = {
	id: string;
	mission_id: string;
	objective_contract_id: string;
	plan_id: string;
	step_id: string;
	plan_step_id: string;
	action_json: string;
	lease_json: string | null;
	status: RuntimeAction["status"];
	attempt_count: number;
	created_at: number;
	updated_at: number;
	started_at: number | null;
	completed_at: number | null;
	last_error: string | null;
};

type CapabilityLeaseRow = {
	id: string;
	mission_id: string;
	runtime_action_id: string;
	lease_json: string;
	status: CapabilityLeaseRecord["status"];
	issued_at: number;
	expires_at: number;
	revoked_at: number | null;
	revoked_reason: string | null;
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
	task_id: string | null;
	session_file: string | null;
	created_at: number;
};

type MissionPhaseRow = {
	id: string;
	mission_id: string;
	ordinal: number;
	name: string;
	description: string | null;
	status: MissionPhaseRecord["status"];
	plan_step_ids_json: string;
	acceptance_criteria_json: string;
	created_at: number;
	updated_at: number;
	closed_at: number | null;
};

type MissionPhaseVerificationRow = {
	id: string;
	mission_id: string;
	phase_id: string;
	status: MissionPhaseVerificationRecord["status"];
	failed_count: number;
	uncertain_count: number;
	summary: string;
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

type MissionReviewRow = {
	id: string;
	mission_id: string;
	status: MissionReviewRecord["status"];
	verdict: MissionReviewRecord["verdict"];
	failed_count: number;
	uncertain_count: number;
	summary: string;
	source_files_json: string;
	excluded_markdown_files_json: string;
	created_at: number;
	reviewed_at: number;
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

type MissionTaskAttemptCheckpointRow = {
	id: string;
	mission_id: string;
	task_id: string;
	agent: string;
	role: string;
	attempt: number;
	status: MissionTaskAttemptCheckpoint["status"];
	failure_mode: MissionTaskAttemptCheckpoint["failureMode"];
	last_verdict: MissionTaskAttemptCheckpoint["lastVerdict"];
	failed_count: number;
	uncertain_count: number;
	remediation_action: MissionTaskAttemptCheckpoint["remediationAction"];
	session_file: string | null;
	artifact_refs_json: string;
	error: string | null;
	created_at: number;
	updated_at: number;
};

type MissionCriticDialogueTurnRow = {
	id: string;
	mission_id: string;
	role: CriticDialogueRole;
	summary: string;
	check_ids_json: string;
	created_at: number;
};

type MissionWorldModelRow = {
	id: string;
	mission_id: string;
	kind: MissionWorldModelRecordKind;
	source: MissionWorldModelRecordSource;
	source_id: string;
	claim: string;
	evidence_refs_json: string;
	links_json?: string;
	outcome_status?: MissionWorldModelRecord["outcomeStatus"];
	verified: number;
	created_at: number;
};
type MissionContinuationRow = {
	mission_id: string;
	session_id: string | null;
	owner_branch: string | null;
	owner_tree_id: string | null;
	status: string;
	generation: number;
	auto_turn_count: number;
	tokens_used: number;
	time_used_seconds: number;
	progress_fingerprint: string | null;
	no_progress_count: number;
	last_reason: string | null;
	last_scheduled_at: number | null;
	last_started_at: number | null;
	last_ended_at: number | null;
	last_turn_id: string | null;
	updated_at: number;
};

function rowToContinuation(row: MissionContinuationRow): MissionContinuationRecord {
	return {
		missionId: row.mission_id,
		sessionId: row.session_id,
		ownerBranch: row.owner_branch,
		ownerTreeId: row.owner_tree_id,
		status: row.status as ContinuationStatus,
		generation: row.generation,
		autoTurnCount: row.auto_turn_count,
		tokensUsed: row.tokens_used,
		timeUsedSeconds: row.time_used_seconds,
		progressFingerprint: row.progress_fingerprint,
		noProgressCount: row.no_progress_count,
		lastReason: row.last_reason,
		lastScheduledAt: row.last_scheduled_at,
		lastStartedAt: row.last_started_at,
		lastEndedAt: row.last_ended_at,
		lastTurnId: row.last_turn_id,
		updatedAt: row.updated_at,
	};
}

export interface ObjectiveContractRecord {
	id: string;
	missionId: string;
	contractHash: string;
	contract: ObjectiveContract;
	status: "active" | "superseded" | "revoked";
	createdAt: number;
	approvedAt?: number;
	approvedBy?: string;
	supersedesContractId?: string;
}

export interface RuntimeActionRecord {
	id: string;
	missionId: string;
	objectiveContractId: string;
	planId: string;
	planStepId: string;
	action: RuntimeAction;
	lease?: CapabilityLease;
	status: RuntimeAction["status"];
	attemptCount: number;
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	completedAt?: number;
	lastError?: string;
}

export interface CapabilityLeaseRecord {
	id: string;
	missionId: string;
	runtimeActionId: string;
	lease: CapabilityLease;
	status: "active" | "revoked" | "expired";
	issuedAt: number;
	expiresAt: number;
	revokedAt?: number;
	revokedReason?: string;
}

export interface AgiApprovalRequestRecord {
	id: string;
	missionId: string;
	actionId: string;
	risk: "low" | "medium" | "high" | "critical";
	status: "pending" | "approved" | "rejected";
	createdAt: number;
	decidedAt?: number;
	decidedBy?: string;
	reason?: string;
}

export interface AgiEmergencyStopRecord {
	missionId: string;
	stoppedAt: number;
	reason?: string;
}

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
		this.#eventBus = eventBus ?? (dbPath === ":memory:" ? undefined : getMissionEventBus());
		this.#init();
	}

	close(): void {
		this.#db.close();
	}

	createMission(input: NewResearchCampaign): ResearchCampaign {
		assertRiskLevel(input.riskLevel);
		assertMissionState(input.state);
		if (input.confidence !== null) {
			assertConfidence(input.confidence);
		}
		const now = Date.now();
		const mission: ResearchCampaign = {
			...input,
			id: input.id ?? generateId("mission", now),
			createdAt: now,
			updatedAt: now,
			revision: input.revision ?? 0,
			objective: input.objective ?? input.title,
			// Normalize the durable core pointers so the returned aggregate matches what a
			// subsequent getMission()/listMissions() read reconstructs from the row.
			intent: input.intent ?? null,
			lifecycle: input.lifecycle ?? null,
			proposalId: input.proposalId ?? null,
			regressionContractId: input.regressionContractId ?? null,
			mode: input.mode ?? "interactive",
		};
		this.#db
			.query(
				`INSERT INTO missions
					(id, title, objective, objective_id, brief_id, decision_id, risk_level, state, confidence, snapshot_ref, mode, created_at, updated_at, revision,
					 intent, lifecycle, proposal_id, regression_contract_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				mission.id,
				mission.title,
				mission.objective ?? mission.title,
				mission.objectiveId,
				mission.briefId,
				mission.decisionId,
				mission.riskLevel,
				mission.state,
				mission.confidence,
				mission.snapshotRef,
				mission.mode ?? "interactive",
				mission.createdAt,
				mission.updatedAt,
				mission.revision,
				mission.intent ?? null,
				mission.lifecycle ?? null,
				mission.proposalId ?? null,
				mission.regressionContractId ?? null,
			);
		return mission;
	}

	getMission(id: string): ResearchCampaign | undefined {
		const row = this.#db.query("SELECT * FROM missions WHERE id = ?").get(id) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	listMissions(opts: { objectiveId?: string; briefId?: string; state?: MissionState } = {}): ResearchCampaign[] {
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
			.query(`SELECT * FROM missions${where} ORDER BY created_at DESC, rowid DESC`)
			.all(...params) as MissionRow[];
		return rows.map(rowToMission);
	}

	getPreferredMission(
		opts: { objectiveId?: string; briefId?: string; title?: string } = {},
	): ResearchCampaign | undefined {
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
					rowid DESC
				LIMIT 1`,
			)
			.get(...params) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByObjectiveId(objectiveId: string): ResearchCampaign | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE objective_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
			.get(objectiveId) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByBriefId(briefId: string): ResearchCampaign | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE brief_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
			.get(briefId) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	findLatestMissionByTitle(title: string): ResearchCampaign | undefined {
		const row = this.#db
			.query("SELECT * FROM missions WHERE title = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
			.get(title) as MissionRow | null;
		return row ? rowToMission(row) : undefined;
	}

	updateMission(
		id: string,
		patch: Partial<
			Pick<
				ResearchCampaign,
				| "title"
				| "objective"
				| "state"
				| "confidence"
				| "decisionId"
				| "snapshotRef"
				| "objectiveId"
				| "briefId"
				| "riskLevel"
				| "intent"
				| "lifecycle"
				| "proposalId"
				| "regressionContractId"
				| "mode"
			>
		>,
	): ResearchCampaign {
		const existing = this.getMission(id);
		if (!existing) {
			throw new Error(`Mission not found: ${id}`);
		}
		const next: ResearchCampaign = {
			...existing,
			...patch,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
		};
		assertMissionState(next.state);
		assertRiskLevel(next.riskLevel);
		if (next.confidence !== null) {
			assertConfidence(next.confidence);
		}
		this.#db
			.query(
				`UPDATE missions
				SET title = ?, objective = ?, state = ?, confidence = ?, decision_id = ?, snapshot_ref = ?, objective_id = ?, brief_id = ?, risk_level = ?, mode = ?, updated_at = ?,
					revision = revision + 1, intent = ?, lifecycle = ?, proposal_id = ?, regression_contract_id = ?
				WHERE id = ?`,
			)
			.run(
				next.title,
				next.objective ?? next.title,
				next.state,
				next.confidence,
				next.decisionId,
				next.snapshotRef,
				next.objectiveId,
				next.briefId,
				next.riskLevel,
				next.mode ?? "interactive",
				next.updatedAt,
				next.intent ?? null,
				next.lifecycle ?? null,
				next.proposalId ?? null,
				next.regressionContractId ?? null,
				id,
			);
		return next;
	}

	setMissionDesignAnswers(missionId: string, answers: Record<string, string> | null): void {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		this.#db
			.query("UPDATE missions SET design_answers_json = ?, updated_at = ?, revision = revision + 1 WHERE id = ?")
			.run(answers ? JSON.stringify(answers) : null, Date.now(), missionId);
	}

	getMissionRevision(missionId: string): number | undefined {
		const row = this.#db.query("SELECT revision FROM missions WHERE id = ?").get(missionId) as {
			revision: number;
		} | null;
		return row?.revision;
	}

	getMissionDesignAnswers(missionId: string): Record<string, string> | undefined {
		const row = this.#db.query("SELECT design_answers_json FROM missions WHERE id = ?").get(missionId) as {
			design_answers_json: string | null;
		} | null;
		if (!row?.design_answers_json) return undefined;
		return JSON.parse(row.design_answers_json) as Record<string, string>;
	}

	appendRuntimeEvent(input: RuntimeEventDraft): RuntimeEvent {
		if (!this.getMission(input.missionId)) {
			throw new Error(`Mission not found: ${input.missionId}`);
		}
		assertRuntimeEventType(input.type);
		if (input.idempotencyKey) {
			const existing = this.getRuntimeEventByIdempotencyKey(input.streamId, input.idempotencyKey);
			if (existing) return existing;
		}
		return this.#tx(() => {
			if (input.idempotencyKey) {
				const existing = this.getRuntimeEventByIdempotencyKey(input.streamId, input.idempotencyKey);
				if (existing) return existing;
			}
			const now = Date.now();
			const sequence =
				input.sequence ??
				(
					this.#db
						.query("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM runtime_events WHERE stream_id = ?")
						.get(input.streamId) as { sequence: number }
				).sequence ??
				1;
			const event: RuntimeEvent = {
				id: input.id ?? generateId("runtime-event", now),
				missionId: input.missionId,
				streamId: input.streamId,
				sequence,
				type: input.type,
				occurredAt: input.occurredAt ?? now,
				correlationId: input.correlationId ?? null,
				causationId: input.causationId ?? null,
				actor: input.actor ?? null,
				idempotencyKey: input.idempotencyKey ?? null,
				payload: input.payload ?? {},
				evidenceRefs: input.evidenceRefs ?? [],
				schemaVersion: input.schemaVersion ?? 1,
				hash: "",
				createdAt: input.createdAt ?? now,
			};
			event.hash = canonicalRuntimeEventHash(event);
			try {
				this.#db
					.query(
						`INSERT INTO runtime_events
							(id, mission_id, stream_id, sequence, type, occurred_at, correlation_id, causation_id, actor,
							 idempotency_key, payload_json, evidence_refs_json, schema_version, hash, created_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						event.id,
						event.missionId,
						event.streamId,
						event.sequence,
						event.type,
						event.occurredAt,
						event.correlationId,
						event.causationId,
						event.actor,
						event.idempotencyKey,
						stringifyCanonicalJson(event.payload),
						stringifyCanonicalJson(event.evidenceRefs),
						event.schemaVersion,
						event.hash,
						event.createdAt,
					);
				return event;
			} catch (error) {
				if (input.idempotencyKey && error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
					const existing = this.getRuntimeEventByIdempotencyKey(input.streamId, input.idempotencyKey);
					if (existing) return existing;
				}
				throw error;
			}
		});
	}

	listRuntimeEvents(missionId: string, opts: { streamId?: string } = {}): RuntimeEvent[] {
		const rows =
			opts.streamId === undefined
				? (this.#db
						.query("SELECT * FROM runtime_events WHERE mission_id = ? ORDER BY stream_id ASC, sequence ASC")
						.all(missionId) as RuntimeEventRow[])
				: (this.#db
						.query("SELECT * FROM runtime_events WHERE mission_id = ? AND stream_id = ? ORDER BY sequence ASC")
						.all(missionId, opts.streamId) as RuntimeEventRow[]);
		return rows.map(rowToRuntimeEvent);
	}

	listRuntimeEventsByType(missionId: string, type: RuntimeEventType): RuntimeEvent[] {
		assertRuntimeEventType(type);
		const rows = this.#db
			.query("SELECT * FROM runtime_events WHERE mission_id = ? AND type = ? ORDER BY stream_id ASC, sequence ASC")
			.all(missionId, type) as RuntimeEventRow[];
		return rows.map(rowToRuntimeEvent);
	}

	getRuntimeEventByIdempotencyKey(streamId: string, idempotencyKey: string): RuntimeEvent | undefined {
		const row = this.#db
			.query("SELECT * FROM runtime_events WHERE stream_id = ? AND idempotency_key = ?")
			.get(streamId, idempotencyKey) as RuntimeEventRow | null;
		return row ? rowToRuntimeEvent(row) : undefined;
	}

	saveObjectiveContract(missionId: string, contract: ObjectiveContract): ObjectiveContractRecord {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		const now = Date.now();
		const contractJson = stringifyCanonicalJson(contract);
		const contractHash = sha256Hex(contractJson);
		this.#db
			.query(
				`INSERT INTO objective_contracts
					(id, mission_id, contract_hash, contract_json, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					contract_hash = excluded.contract_hash,
					contract_json = excluded.contract_json,
					status = excluded.status`,
			)
			.run(contract.id, missionId, contractHash, contractJson, "active", now);
		const record = this.getObjectiveContractRecord(contract.id);
		if (!record) throw new Error(`Objective contract not found after save: ${contract.id}`);
		return record;
	}

	getObjectiveContract(id: string): ObjectiveContract | undefined {
		return this.getObjectiveContractRecord(id)?.contract;
	}

	getObjectiveContractRecord(id: string): ObjectiveContractRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM objective_contracts WHERE id = ?")
			.get(id) as ObjectiveContractRow | null;
		return row ? rowToObjectiveContractRecord(row) : undefined;
	}

	getLatestObjectiveContractForMission(missionId: string): ObjectiveContractRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM objective_contracts WHERE mission_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(missionId) as ObjectiveContractRow | null;
		return row ? rowToObjectiveContractRecord(row) : undefined;
	}

	saveRuntimeAction(action: RuntimeAction, lease: CapabilityLease): RuntimeActionRecord {
		if (!this.getMission(action.missionId)) throw new Error(`Mission not found: ${action.missionId}`);
		if (!this.getObjectiveContract(action.objectiveContractId)) {
			throw new Error(`Objective contract not found: ${action.objectiveContractId}`);
		}
		const existing = this.getRuntimeAction(action.id);
		if (existing) assertRuntimeActionTransition(existing.status, action.status);
		const now = Date.now();
		const actionJson = stringifyCanonicalJson(action);
		const leaseJson = stringifyCanonicalJson(lease);
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO runtime_actions
						(id, mission_id, objective_contract_id, plan_id, step_id, plan_step_id, role, instruction,
						 dependencies_json, acceptance_criteria_json, required_evidence_json, scope_guard_json, budget_guard_json,
						 action_json, lease_json, lease_id, status, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						role = excluded.role,
						instruction = excluded.instruction,
						dependencies_json = excluded.dependencies_json,
						acceptance_criteria_json = excluded.acceptance_criteria_json,
						required_evidence_json = excluded.required_evidence_json,
						scope_guard_json = excluded.scope_guard_json,
						budget_guard_json = excluded.budget_guard_json,
						action_json = excluded.action_json,
						lease_json = excluded.lease_json,
						lease_id = excluded.lease_id,
						status = excluded.status,
						updated_at = excluded.updated_at`,
				)
				.run(
					action.id,
					action.missionId,
					action.objectiveContractId,
					action.planId,
					action.stepId,
					action.stepId,
					action.role,
					action.instruction,
					stringifyCanonicalJson(action.dependencies),
					stringifyCanonicalJson(action.acceptanceCriteria),
					stringifyCanonicalJson(action.requiredEvidence),
					stringifyCanonicalJson(action.scopeGuard),
					stringifyCanonicalJson(action.budgetGuard),
					actionJson,
					leaseJson,
					lease.leaseId,
					action.status,
					now,
					now,
				);
			this.saveCapabilityLease(lease);
		});
		const record = this.getRuntimeAction(action.id);
		if (!record) throw new Error(`Runtime action not found after save: ${action.id}`);
		return record;
	}

	getRuntimeAction(actionId: string): RuntimeActionRecord | undefined {
		const row = this.#db.query("SELECT * FROM runtime_actions WHERE id = ?").get(actionId) as RuntimeActionRow | null;
		return row ? rowToRuntimeActionRecord(row) : undefined;
	}

	listRunnableActions(missionId: string): RuntimeActionRecord[] {
		const rows = this.#db
			.query("SELECT * FROM runtime_actions WHERE mission_id = ? AND status = 'queued' ORDER BY created_at ASC")
			.all(missionId) as RuntimeActionRow[];
		return rows.map(rowToRuntimeActionRecord);
	}

	listRuntimeActionsForMission(missionId: string): RuntimeActionRecord[] {
		const rows = this.#db
			.query("SELECT * FROM runtime_actions WHERE mission_id = ? ORDER BY created_at ASC")
			.all(missionId) as RuntimeActionRow[];
		return rows.map(rowToRuntimeActionRecord);
	}

	markRuntimeAction(actionId: string, status: RuntimeAction["status"]): RuntimeActionRecord {
		const existing = this.getRuntimeAction(actionId);
		if (!existing) throw new Error(`Runtime action not found: ${actionId}`);
		assertRuntimeActionTransition(existing.status, status);
		const now = Date.now();
		this.#db
			.query(
				`UPDATE runtime_actions
				SET status = ?,
					started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
					completed_at = CASE WHEN ? IN ('succeeded', 'failed', 'verified') THEN ? ELSE completed_at END,
					updated_at = ?
				WHERE id = ?`,
			)
			.run(status, status, now, status, now, now, actionId);
		const next = this.getRuntimeAction(actionId);
		if (!next) throw new Error(`Runtime action not found after update: ${actionId}`);
		return next;
	}

	markActionFailed(actionId: string, error: string): RuntimeActionRecord {
		const existing = this.getRuntimeAction(actionId);
		if (!existing) throw new Error(`Runtime action not found: ${actionId}`);
		assertRuntimeActionTransition(existing.status, "failed");
		const now = Date.now();
		this.#db
			.query(
				`UPDATE runtime_actions
				SET status = 'failed', last_error = ?, completed_at = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(error, now, now, actionId);
		const next = this.getRuntimeAction(actionId);
		if (!next) throw new Error(`Runtime action not found after update: ${actionId}`);
		return next;
	}

	saveCapabilityLease(lease: CapabilityLease): CapabilityLeaseRecord {
		const now = Date.now();
		this.#db
			.query(
				`INSERT INTO capability_leases
					(id, mission_id, runtime_action_id, lease_json, status, issued_at, expires_at, revoked_at, revoked_reason)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					lease_json = excluded.lease_json,
					status = excluded.status,
					expires_at = excluded.expires_at,
					revoked_at = excluded.revoked_at,
					revoked_reason = excluded.revoked_reason`,
			)
			.run(
				lease.leaseId,
				lease.missionId,
				lease.actionId,
				stringifyCanonicalJson(lease),
				lease.revokedAt ? "revoked" : lease.expiresAt <= now ? "expired" : "active",
				lease.issuedAt,
				lease.expiresAt,
				lease.revokedAt ?? null,
				lease.revokedReason ?? null,
			);
		const record = this.getCapabilityLease(lease.leaseId);
		if (!record) throw new Error(`Capability lease not found after save: ${lease.leaseId}`);
		return record;
	}

	getCapabilityLease(id: string): CapabilityLeaseRecord | undefined {
		const row = this.#db.query("SELECT * FROM capability_leases WHERE id = ?").get(id) as CapabilityLeaseRow | null;
		return row ? rowToCapabilityLeaseRecord(row) : undefined;
	}

	revokeCapabilityLease(id: string, reason: string): CapabilityLeaseRecord {
		const existing = this.getCapabilityLease(id);
		if (!existing) throw new Error(`Capability lease not found: ${id}`);
		const now = Date.now();
		const lease = { ...existing.lease, revokedAt: now, revokedReason: reason };
		this.#db
			.query(
				`UPDATE capability_leases
				SET lease_json = ?, status = 'revoked', revoked_at = ?, revoked_reason = ?
				WHERE id = ?`,
			)
			.run(stringifyCanonicalJson(lease), now, reason, id);
		const record = this.getCapabilityLease(id);
		if (!record) throw new Error(`Capability lease not found after revoke: ${id}`);
		return record;
	}

	saveAgiApprovalRequest(request: AgiApprovalRequestRecord): AgiApprovalRequestRecord {
		if (!this.getMission(request.missionId)) throw new Error(`Mission not found: ${request.missionId}`);
		this.#db
			.query(
				`INSERT INTO agi_approval_requests
					(id, mission_id, action_id, risk, status, created_at, decided_at, decided_by, reason)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					status = excluded.status,
					decided_at = excluded.decided_at,
					decided_by = excluded.decided_by,
					reason = excluded.reason`,
			)
			.run(
				request.id,
				request.missionId,
				request.actionId,
				request.risk,
				request.status,
				request.createdAt,
				request.decidedAt ?? null,
				request.decidedBy ?? null,
				request.reason ?? null,
			);
		const saved = this.getAgiApprovalRequest(request.id);
		if (!saved) throw new Error(`AGI approval request not found after save: ${request.id}`);
		return saved;
	}

	getAgiApprovalRequest(id: string): AgiApprovalRequestRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM agi_approval_requests WHERE id = ?")
			.get(id) as AgiApprovalRequestRow | null;
		return row ? rowToAgiApprovalRequestRecord(row) : undefined;
	}

	recordAgiEmergencyStop(missionId: string, reason?: string): AgiEmergencyStopRecord {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		const now = Date.now();
		this.#db
			.query(
				`INSERT INTO agi_emergency_stops (mission_id, stopped_at, reason)
				VALUES (?, ?, ?)
				ON CONFLICT(mission_id) DO UPDATE SET
					stopped_at = excluded.stopped_at,
					reason = excluded.reason`,
			)
			.run(missionId, now, reason ?? null);
		const stop = this.getAgiEmergencyStop(missionId);
		if (!stop) throw new Error(`AGI emergency stop not found after save: ${missionId}`);
		return stop;
	}

	getAgiEmergencyStop(missionId: string): AgiEmergencyStopRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM agi_emergency_stops WHERE mission_id = ?")
			.get(missionId) as AgiEmergencyStopRow | null;
		return row ? rowToAgiEmergencyStopRecord(row) : undefined;
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
			taskId: input.taskId ?? null,
			sessionFile: input.sessionFile ?? null,
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_contracts
					(id, mission_id, role, parent_contract_revision, include_json, exclude_json, success_criteria_json, escalation_json, input_artifact, must_produce_json, task_id, session_file, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.role,
				record.parentMissionRev,
				JSON.stringify(record.include),
				JSON.stringify(record.exclude),
				JSON.stringify(record.successCriteria),
				JSON.stringify(record.escalation),
				record.inputArtifact,
				JSON.stringify(record.mustProduce),
				record.taskId,
				record.sessionFile,
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

	createPhase(input: NewMissionPhaseRecord): MissionPhaseRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = Date.now();
		const record: MissionPhaseRecord = {
			...input,
			id: input.id ?? generateId("mission-phase", now),
			planStepIds: [...input.planStepIds],
			createdAt: input.createdAt ?? now,
			updatedAt: input.updatedAt ?? now,
		};
		this.#db
			.query(
				`INSERT INTO mission_phases
					(id, mission_id, ordinal, name, description, status, plan_step_ids_json, acceptance_criteria_json, created_at, updated_at, closed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.ordinal,
				record.name,
				record.description,
				record.status,
				JSON.stringify(record.planStepIds),
				record.acceptanceCriteriaJson,
				record.createdAt,
				record.updatedAt,
				record.closedAt,
			);
		return record;
	}

	updatePhase(
		id: string,
		patch: Partial<Omit<MissionPhaseRecord, "id" | "missionId" | "createdAt">>,
	): MissionPhaseRecord {
		const row = this.#db.query("SELECT * FROM mission_phases WHERE id = ?").get(id) as MissionPhaseRow | null;
		if (!row) throw new Error(`Mission phase not found: ${id}`);
		const current = rowToPhase(row);
		const updated: MissionPhaseRecord = {
			...current,
			...patch,
			planStepIds: patch.planStepIds ? [...patch.planStepIds] : current.planStepIds,
			updatedAt: patch.updatedAt ?? Date.now(),
		};
		this.#db
			.query(
				`UPDATE mission_phases SET
					ordinal = ?, name = ?, description = ?, status = ?, plan_step_ids_json = ?,
					acceptance_criteria_json = ?, updated_at = ?, closed_at = ?
				WHERE id = ?`,
			)
			.run(
				updated.ordinal,
				updated.name,
				updated.description,
				updated.status,
				JSON.stringify(updated.planStepIds),
				updated.acceptanceCriteriaJson,
				updated.updatedAt,
				updated.closedAt,
				updated.id,
			);
		return updated;
	}

	listPhases(missionId: string): MissionPhaseRecord[] {
		const rows = this.#db
			.query("SELECT * FROM mission_phases WHERE mission_id = ? ORDER BY ordinal ASC, created_at ASC, id ASC")
			.all(missionId) as MissionPhaseRow[];
		return rows.map(rowToPhase);
	}

	recordPhaseVerification(input: NewMissionPhaseVerificationRecord): MissionPhaseVerificationRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionPhaseVerificationRecord = {
			...input,
			id: input.id ?? generateId("phase-verification", now),
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_phase_verifications
					(id, mission_id, phase_id, status, failed_count, uncertain_count, summary, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.phaseId,
				record.status,
				record.failedCount,
				record.uncertainCount,
				record.summary,
				record.createdAt,
			);
		return record;
	}

	listPhaseVerifications(missionId: string): MissionPhaseVerificationRecord[] {
		const rows = this.#db
			.query("SELECT * FROM mission_phase_verifications WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionPhaseVerificationRow[];
		return rows.map(rowToPhaseVerification);
	}

	recordVerification(input: NewMissionVerificationRecord): MissionVerificationRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionVerificationRecord = {
			...input,
			id: input.id ?? generateId("verification", now),
			createdAt: now,
		};
		this.#tx(() => {
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
			this.#bumpRevision(input.missionId);
		});
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

	recordReview(input: NewMissionReviewRecord): MissionReviewRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionReviewRecord = {
			...input,
			id: input.id ?? generateId("review", now),
			sourceFiles: [...input.sourceFiles],
			excludedMarkdownFiles: [...input.excludedMarkdownFiles],
			createdAt: now,
		};
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_reviews
					(id, mission_id, status, verdict, failed_count, uncertain_count, summary,
					 source_files_json, excluded_markdown_files_json, created_at, reviewed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					record.id,
					record.missionId,
					record.status,
					record.verdict,
					record.failedCount,
					record.uncertainCount,
					record.summary,
					JSON.stringify(record.sourceFiles),
					JSON.stringify(record.excludedMarkdownFiles),
					record.createdAt,
					record.reviewedAt,
				);
			this.#bumpRevision(input.missionId);
		});

		return record;
	}

	getLatestReview(missionId: string): MissionReviewRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM mission_reviews WHERE mission_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
			.get(missionId) as MissionReviewRow | null;
		return row ? rowToReview(row) : undefined;
	}

	recordTaskAttemptCheckpoint(input: NewMissionTaskAttemptCheckpoint): MissionTaskAttemptCheckpoint {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionTaskAttemptCheckpoint = {
			...input,
			id: input.id ?? generateId("task-attempt", now),
			artifactRefs: [...input.artifactRefs],
			createdAt: now,
			updatedAt: input.updatedAt ?? now,
		};
		this.#db
			.query(
				`INSERT INTO mission_task_attempt_checkpoints
					(id, mission_id, task_id, agent, role, attempt, status, failure_mode, last_verdict, failed_count, uncertain_count, remediation_action, session_file, artifact_refs_json, error, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.taskId,
				record.agent,
				record.role,
				record.attempt,
				record.status,
				record.failureMode,
				record.lastVerdict,
				record.failedCount,
				record.uncertainCount,
				record.remediationAction,
				record.sessionFile,
				JSON.stringify(record.artifactRefs),
				record.error,
				record.createdAt,
				record.updatedAt,
			);
		return record;
	}

	listTaskAttemptCheckpoints(missionId: string): MissionTaskAttemptCheckpoint[] {
		const rows = this.#db
			.query("SELECT * FROM mission_task_attempt_checkpoints WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionTaskAttemptCheckpointRow[];
		return rows.map(rowToTaskAttemptCheckpoint);
	}

	getLatestTaskAttemptCheckpoint(missionId: string, taskId: string): MissionTaskAttemptCheckpoint | undefined {
		const row = this.#db
			.query(
				"SELECT * FROM mission_task_attempt_checkpoints WHERE mission_id = ? AND task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
			)
			.get(missionId, taskId) as MissionTaskAttemptCheckpointRow | null;
		return row ? rowToTaskAttemptCheckpoint(row) : undefined;
	}

	recordCriticDialogueTurn(input: NewMissionCriticDialogueTurn): MissionCriticDialogueTurn {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		assertCriticDialogueRole(input.role);
		const now = input.createdAt ?? Date.now();
		const record: MissionCriticDialogueTurn = {
			...input,
			id: input.id ?? generateId("critic-dialogue", now),
			checkIds: [...input.checkIds],
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_critic_dialogue
					(id, mission_id, role, summary, check_ids_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.role,
				record.summary,
				JSON.stringify(record.checkIds),
				record.createdAt,
			);
		return record;
	}

	recordCriticDialogueExchange(input: {
		missionId: string;
		orchestratorSummary: string;
		criticSummary: string;
		checkIds: string[];
		blockingCheckIds?: string[];
		createdAt?: number;
	}): MissionCriticDialogueTurn[] {
		const now = input.createdAt ?? Date.now();
		const orchestrator = this.recordCriticDialogueTurn({
			missionId: input.missionId,
			role: "orchestrator",
			summary: input.orchestratorSummary,
			checkIds: input.checkIds,
			createdAt: now,
		});
		const critic = this.recordCriticDialogueTurn({
			missionId: input.missionId,
			role: "inner-critic",
			summary: input.criticSummary,
			checkIds: input.checkIds,
			createdAt: now + 1,
		});
		this.#eventBus?.emit({
			type: "runtime_critic.dialogue.completed",
			missionId: input.missionId,
			turnIds: [orchestrator.id, critic.id],
			blockingCheckIds: [...(input.blockingCheckIds ?? [])],
			ts: critic.createdAt,
		});
		return [orchestrator, critic];
	}

	listCriticDialogue(missionId: string): MissionCriticDialogueTurn[] {
		const rows = this.#db
			.query("SELECT * FROM mission_critic_dialogue WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionCriticDialogueTurnRow[];
		return rows.map(rowToCriticDialogueTurn);
	}

	recordWorldModel(input: NewMissionWorldModelRecord): MissionWorldModelRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionWorldModelRecord = {
			...input,
			id: input.id ?? generateId("world-model", now),
			evidenceRefs: [...input.evidenceRefs],
			links: [...(input.links ?? [])],
			outcomeStatus: input.outcomeStatus ?? null,
			createdAt: now,
		};
		this.#db
			.query(
				`INSERT INTO mission_world_model
					(id, mission_id, kind, source, source_id, claim, evidence_refs_json, links_json, outcome_status, verified, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.missionId,
				record.kind,
				record.source,
				record.sourceId,
				record.claim,
				JSON.stringify(record.evidenceRefs),
				JSON.stringify(record.links),
				record.outcomeStatus,
				record.verified ? 1 : 0,
				record.createdAt,
			);
		return record;
	}

	listWorldModel(missionId: string): MissionWorldModelRecord[] {
		const rows = this.#db
			.query("SELECT * FROM mission_world_model WHERE mission_id = ? ORDER BY created_at ASC, id ASC")
			.all(missionId) as MissionWorldModelRow[];
		return rows.map(rowToWorldModel);
	}

	recordRollback(input: NewMissionRollbackRecord): MissionRollbackRecord {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const now = input.createdAt ?? Date.now();
		const record: MissionRollbackRecord = {
			...input,
			id: input.id ?? generateId("rollback", now),
			createdAt: now,
		};
		this.#tx(() => {
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
			this.#bumpRevision(input.missionId);
		});
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
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#runMigrations();
	}

	#runMigrations(): void {
		const row = this.#db.query("PRAGMA user_version").get() as { user_version?: number } | null;
		let current = row?.user_version ?? 0;
		for (const migration of MIGRATIONS) {
			if (migration.version <= current) continue;
			console.debug(`Applying mission store migration v${migration.version}: ${migration.description}`);
			this.#tx(() => migration.up(this.#db));
			this.#db.exec(`PRAGMA user_version = ${migration.version}`);
			current = migration.version;
		}
	}

	#tx<T>(work: () => T): T {
		return this.#db.transaction(work)();
	}

	#bumpRevision(missionId: string): number {
		const row = this.#db
			.query("UPDATE missions SET revision = revision + 1, updated_at = ? WHERE id = ? RETURNING revision")
			.get(Date.now(), missionId) as { revision: number } | null;
		if (!row) throw new Error(`Mission not found: ${missionId}`);
		return row.revision;
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Mission durable aggregate (P2): tasks, plans, acceptance criteria,
	// budgets, scope guards, proposals. Variable shapes (edges, scope lists,
	// tool policies) live in JSON columns; flat scalars live as columns to keep
	// indexing/queries straightforward.
	// ──────────────────────────────────────────────────────────────────────────

	saveTask(input: MissionTask & { missionId: string }): MissionTask {
		if (!this.getMission(input.missionId)) {
			throw new Error(`Mission not found: ${input.missionId}`);
		}
		const now = Date.now();
		const task: MissionTask = {
			...input,
			createdAt: input.createdAt ?? now,
			updatedAt: now,
		};
		const dataJson = JSON.stringify({
			scope: task.scope ?? null,
			successCriteria: task.successCriteria ?? null,
			escalationCriteria: task.escalationCriteria ?? null,
			allowedTools: task.allowedTools ?? null,
			deniedTools: task.deniedTools ?? null,
			evidenceRefs: task.evidenceRefs ?? null,
			output: task.output ?? null,
		});
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_tasks
					(id, mission_id, title, objective, status, assigned_agent, plan_step_id, data_json, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					title = excluded.title,
					objective = excluded.objective,
					status = excluded.status,
					assigned_agent = excluded.assigned_agent,
					plan_step_id = excluded.plan_step_id,
					data_json = excluded.data_json,
					updated_at = excluded.updated_at`,
				)
				.run(
					task.id,
					input.missionId,
					task.title,
					task.objective ?? null,
					task.status,
					task.assignedAgent ?? null,
					task.planStepId ?? null,
					dataJson,
					task.createdAt ?? now,
					task.updatedAt ?? now,
				);
			this.#bumpRevision(input.missionId);
		});
		return task;
	}

	listTasks(missionId: string): MissionTask[] {
		const rows = this.#db
			.query(
				`SELECT id, mission_id, title, objective, status, assigned_agent, plan_step_id, data_json, created_at, updated_at
				 FROM mission_tasks WHERE mission_id = ? ORDER BY created_at ASC, rowid ASC`,
			)
			.all(missionId) as MissionTaskRow[];
		return rows.map(rowToMissionTask);
	}

	deleteTask(taskId: string): void {
		this.#db.query("DELETE FROM mission_tasks WHERE id = ?").run(taskId);
	}

	savePlan(missionId: string, plan: MissionPlan): void {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		const now = Date.now();
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_plans (mission_id, rationale, revision, updated_at)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(mission_id) DO UPDATE SET
						rationale = excluded.rationale,
						revision = excluded.revision,
						updated_at = excluded.updated_at`,
				)
				.run(missionId, plan.rationale ?? null, plan.revision ?? null, now);
			// Plan steps: full replace — simplest and matches MissionPlan semantics.
			this.#db.query("DELETE FROM mission_plan_steps WHERE mission_id = ?").run(missionId);
			const insert = this.#db.query(
				`INSERT INTO mission_plan_steps (id, mission_id, ordinal, description, edges_json)
				 VALUES (?, ?, ?, ?, ?)`,
			);
			plan.steps.forEach((step, idx) => {
				insert.run(step.id, missionId, idx, step.description, JSON.stringify(step.edges ?? []));
			});
			this.#bumpRevision(missionId);
		});
	}

	getPlan(missionId: string): MissionPlan | undefined {
		const head = this.#db
			.query("SELECT rationale, revision FROM mission_plans WHERE mission_id = ?")
			.get(missionId) as { rationale: string | null; revision: number | null } | null;
		const stepRows = this.#db
			.query(
				`SELECT id, description, edges_json FROM mission_plan_steps WHERE mission_id = ? ORDER BY ordinal ASC, rowid ASC`,
			)
			.all(missionId) as Array<{ id: string; description: string; edges_json: string }>;
		if (!head && stepRows.length === 0) return undefined;
		const steps: MissionPlanStep[] = stepRows.map(r => ({
			id: r.id,
			description: r.description,
			edges: JSON.parse(r.edges_json) as MissionPlanStepEdge[],
		}));
		const plan: MissionPlan = { steps };
		if (head?.rationale != null) plan.rationale = head.rationale;
		if (head?.revision != null) plan.revision = head.revision;
		return plan;
	}

	saveAcceptanceCriteria(missionId: string, criteria: AcceptanceCriterion[]): void {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		this.#tx(() => {
			this.#db.query("DELETE FROM mission_acceptance_criteria WHERE mission_id = ?").run(missionId);
			const insert = this.#db.query(
				`INSERT INTO mission_acceptance_criteria
					(id, mission_id, ordinal, description, satisfied, verification_method, evidence_refs_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			);
			criteria.forEach((c, idx) => {
				insert.run(
					c.id,
					missionId,
					idx,
					c.description,
					c.satisfied ? 1 : 0,
					c.verificationMethod ?? null,
					JSON.stringify(c.evidenceRefs ?? []),
				);
			});
			this.#bumpRevision(missionId);
		});
	}

	listAcceptanceCriteria(missionId: string): AcceptanceCriterion[] {
		const rows = this.#db
			.query(
				`SELECT id, description, satisfied, verification_method, evidence_refs_json
				 FROM mission_acceptance_criteria WHERE mission_id = ? ORDER BY ordinal ASC, rowid ASC`,
			)
			.all(missionId) as Array<{
			id: string;
			description: string;
			satisfied: number;
			verification_method: string | null;
			evidence_refs_json: string;
		}>;
		return rows.map(r => {
			const out: AcceptanceCriterion = {
				id: r.id,
				description: r.description,
				satisfied: r.satisfied !== 0,
			};
			if (r.verification_method) out.verificationMethod = r.verification_method;
			const refs = JSON.parse(r.evidence_refs_json) as string[];
			if (refs.length > 0) out.evidenceRefs = refs;
			return out;
		});
	}

	saveBudget(missionId: string, budget: MissionBudget, contextBudget: MissionContextBudget): void {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_budgets
					(mission_id, token_budget, tokens_used, time_budget_ms, time_used_ms,
					 task_budget, tasks_used, max_context_tokens, context_tokens_used,
					 compaction_threshold, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(mission_id) DO UPDATE SET
					token_budget = excluded.token_budget,
					tokens_used = excluded.tokens_used,
					time_budget_ms = excluded.time_budget_ms,
					time_used_ms = excluded.time_used_ms,
					task_budget = excluded.task_budget,
					tasks_used = excluded.tasks_used,
					max_context_tokens = excluded.max_context_tokens,
					context_tokens_used = excluded.context_tokens_used,
					compaction_threshold = excluded.compaction_threshold,
					updated_at = excluded.updated_at`,
				)
				.run(
					missionId,
					budget.tokenBudget,
					budget.tokensUsed,
					budget.timeBudgetMs ?? null,
					budget.timeUsedMs ?? null,
					budget.taskBudget ?? null,
					budget.tasksUsed ?? null,
					contextBudget.maxContextTokens,
					contextBudget.contextTokensUsed,
					contextBudget.compactionThreshold ?? null,
					Date.now(),
				);
			this.#bumpRevision(missionId);
		});
	}

	getBudget(missionId: string): { budget: MissionBudget; contextBudget: MissionContextBudget } | undefined {
		const row = this.#db
			.query(
				`SELECT token_budget, tokens_used, time_budget_ms, time_used_ms,
						task_budget, tasks_used, max_context_tokens, context_tokens_used,
						compaction_threshold
				 FROM mission_budgets WHERE mission_id = ?`,
			)
			.get(missionId) as {
			token_budget: number;
			tokens_used: number;
			time_budget_ms: number | null;
			time_used_ms: number | null;
			task_budget: number | null;
			tasks_used: number | null;
			max_context_tokens: number;
			context_tokens_used: number;
			compaction_threshold: number | null;
		} | null;
		if (!row) return undefined;
		const budget: MissionBudget = { tokenBudget: row.token_budget, tokensUsed: row.tokens_used };
		if (row.time_budget_ms != null) budget.timeBudgetMs = row.time_budget_ms;
		if (row.time_used_ms != null) budget.timeUsedMs = row.time_used_ms;
		if (row.task_budget != null) budget.taskBudget = row.task_budget;
		if (row.tasks_used != null) budget.tasksUsed = row.tasks_used;
		const contextBudget: MissionContextBudget = {
			maxContextTokens: row.max_context_tokens,
			contextTokensUsed: row.context_tokens_used,
		};
		if (row.compaction_threshold != null) contextBudget.compactionThreshold = row.compaction_threshold;
		return { budget, contextBudget };
	}

	saveScopeGuard(missionId: string, guard: MissionScopeGuard): void {
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_scope_guards
					(mission_id, allowed_paths_json, denied_paths_json, allowed_tools_json,
					 allow_sub_missions, notes, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(mission_id) DO UPDATE SET
					allowed_paths_json = excluded.allowed_paths_json,
					denied_paths_json = excluded.denied_paths_json,
					allowed_tools_json = excluded.allowed_tools_json,
					allow_sub_missions = excluded.allow_sub_missions,
					notes = excluded.notes,
					updated_at = excluded.updated_at`,
				)
				.run(
					missionId,
					JSON.stringify(guard.allowedPaths ?? []),
					JSON.stringify(guard.deniedPaths ?? []),
					JSON.stringify(guard.allowedTools ?? []),
					guard.allowSubMissions ? 1 : 0,
					guard.notes ?? null,
					Date.now(),
				);
			this.#bumpRevision(missionId);
		});
	}

	getScopeGuard(missionId: string): MissionScopeGuard | undefined {
		const row = this.#db
			.query(
				`SELECT allowed_paths_json, denied_paths_json, allowed_tools_json,
						allow_sub_missions, notes
				 FROM mission_scope_guards WHERE mission_id = ?`,
			)
			.get(missionId) as {
			allowed_paths_json: string;
			denied_paths_json: string;
			allowed_tools_json: string;
			allow_sub_missions: number;
			notes: string | null;
		} | null;
		if (!row) return undefined;
		const guard: MissionScopeGuard = {
			allowedPaths: JSON.parse(row.allowed_paths_json) as string[],
			deniedPaths: JSON.parse(row.denied_paths_json) as string[],
		};
		const tools = JSON.parse(row.allowed_tools_json) as string[];
		if (tools.length > 0) guard.allowedTools = tools;
		if (row.allow_sub_missions !== 0) guard.allowSubMissions = true;
		if (row.notes != null) guard.notes = row.notes;
		return guard;
	}

	saveProposal(input: NewMissionProposal): MissionProposal {
		if (!this.getMission(input.missionId)) throw new Error(`Mission not found: ${input.missionId}`);
		const status: MissionProposalStatus = input.status ?? "draft";
		assertProposalStatus(status);
		const now = Date.now();
		const proposal: MissionProposal = {
			id: input.id ?? generateId("proposal", now),
			missionId: input.missionId,
			artifactUri: input.artifactUri,
			contentHash: input.contentHash,
			status,
			approvedBy: input.approvedBy ?? null,
			approvedAt: input.approvedAt ?? null,
			summary: input.summary ?? null,
			createdAt: now,
			updatedAt: now,
		};
		this.#tx(() => {
			this.#db
				.query(
					`INSERT INTO mission_proposals
					(id, mission_id, artifact_uri, content_hash, status, approved_by,
					 approved_at, summary, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					proposal.id,
					proposal.missionId,
					proposal.artifactUri,
					proposal.contentHash,
					proposal.status,
					proposal.approvedBy,
					proposal.approvedAt,
					proposal.summary,
					proposal.createdAt,
					proposal.updatedAt,
				);
			this.#bumpRevision(input.missionId);
		});
		return proposal;
	}

	getProposal(id: string): MissionProposal | undefined {
		const row = this.#db.query("SELECT * FROM mission_proposals WHERE id = ?").get(id) as MissionProposalRow | null;
		return row ? rowToProposal(row) : undefined;
	}

	listProposals(missionId: string): MissionProposal[] {
		const rows = this.#db
			.query("SELECT * FROM mission_proposals WHERE mission_id = ? ORDER BY created_at DESC")
			.all(missionId) as MissionProposalRow[];
		return rows.map(rowToProposal);
	}

	getLatestApprovedProposal(missionId: string): MissionProposal | undefined {
		const row = this.#db
			.query(
				`SELECT * FROM mission_proposals
				 WHERE mission_id = ? AND status = 'approved'
				 ORDER BY approved_at DESC, created_at DESC LIMIT 1`,
			)
			.get(missionId) as MissionProposalRow | null;
		return row ? rowToProposal(row) : undefined;
	}

	updateProposalStatus(
		id: string,
		status: MissionProposalStatus,
		approvedBy?: string | null,
		approvedAt?: number | null,
	): MissionProposal {
		assertProposalStatus(status);
		const existing = this.getProposal(id);
		if (!existing) throw new Error(`Proposal not found: ${id}`);
		const now = Date.now();
		const nextApprovedBy = status === "approved" ? (approvedBy ?? existing.approvedBy) : existing.approvedBy;
		const nextApprovedAt = status === "approved" ? (approvedAt ?? existing.approvedAt ?? now) : existing.approvedAt;
		this.#tx(() => {
			this.#db
				.query(
					`UPDATE mission_proposals
					 SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(status, nextApprovedBy, nextApprovedAt, now, id);
			this.#bumpRevision(existing.missionId);
		});
		return {
			...existing,
			status,
			approvedBy: nextApprovedBy,
			approvedAt: nextApprovedAt,
			updatedAt: now,
		};
	}
	// ──────────────────────────────────────────────────────────────────────────
	// Continuation ledger (Codex thread-goal port). Keyed by missionId; CAS
	// transitions guarantee at most one scheduled|running generation per mission.
	// ──────────────────────────────────────────────────────────────────────────

	getContinuation(missionId: string): MissionContinuationRecord | undefined {
		const row = this.#db
			.query("SELECT * FROM mission_continuation WHERE mission_id = ?")
			.get(missionId) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/** Idempotently create an `idle` ledger row for a mission. Returns the row. */
	ensureContinuation(
		missionId: string,
		owner: { sessionId?: string | null; ownerBranch?: string | null; ownerTreeId?: string | null } = {},
	): MissionContinuationRecord {
		const existing = this.getContinuation(missionId);
		if (existing) return existing;
		if (!this.getMission(missionId)) throw new Error(`Mission not found: ${missionId}`);
		const now = Date.now();
		this.#db
			.query(
				`INSERT INTO mission_continuation
				 (mission_id, session_id, owner_branch, owner_tree_id, status, generation,
				  auto_turn_count, tokens_used, time_used_seconds, progress_fingerprint,
				  no_progress_count, last_reason, last_scheduled_at, last_started_at,
				  last_ended_at, last_turn_id, updated_at)
				 VALUES (?, ?, ?, ?, 'idle', 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, ?)`,
			)
			.run(missionId, owner.sessionId ?? null, owner.ownerBranch ?? null, owner.ownerTreeId ?? null, now);
		const created = this.getContinuation(missionId);
		if (!created) throw new Error(`Failed to create continuation ledger for ${missionId}`);
		return created;
	}

	/**
	 * CAS: `idle`@expectedGeneration → `scheduled`@expectedGeneration+1.
	 * Returns the new record on success, or undefined when the row is not idle at
	 * the expected generation (duplicate-suppression).
	 */
	scheduleNextContinuation(
		missionId: string,
		expectedGeneration: number,
		reason?: string,
	): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET status = 'scheduled', generation = generation + 1,
				     last_scheduled_at = ?, last_reason = ?, updated_at = ?
				 WHERE mission_id = ? AND status = 'idle' AND generation = ?
				 RETURNING *`,
			)
			.get(now, reason ?? null, now, missionId, expectedGeneration) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/**
	 * CAS: `scheduled`@generation → `running`@generation, incrementing
	 * autoTurnCount exactly once. Returns the record on success.
	 */
	markContinuationRunning(
		missionId: string,
		generation: number,
		turnId?: string,
	): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET status = 'running', auto_turn_count = auto_turn_count + 1,
				     last_started_at = ?, last_turn_id = ?, updated_at = ?
				 WHERE mission_id = ? AND status = 'scheduled' AND generation = ?
				 RETURNING *`,
			)
			.get(now, turnId ?? null, now, missionId, generation) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/**
	 * CAS: `running`@generation → `idle`. Used after an agent turn finishes
	 * cleanly and the runtime re-evaluates whether to schedule again.
	 */
	markContinuationIdleAfterEnd(missionId: string, generation: number): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET status = 'idle', last_ended_at = ?, updated_at = ?
				 WHERE mission_id = ? AND status = 'running' AND generation = ?
				 RETURNING *`,
			)
			.get(now, now, missionId, generation) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/**
	 * Clear a stale `running`/`scheduled` row back to `idle` after a process
	 * restart or a user-authored turn interrupting an in-flight continuation.
	 * Unconditional (no generation match) — recovery, not CAS.
	 */
	reconcileContinuationRunningToIdle(missionId: string, reason?: string): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET status = 'idle', last_reason = ?, updated_at = ?
				 WHERE mission_id = ? AND status IN ('scheduled', 'running')
				 RETURNING *`,
			)
			.get(reason ?? "reconciled_stale_running", now, missionId) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/** Set the continuation status directly (pause/resume/terminal observation). */
	setContinuationStatus(
		missionId: string,
		status: ContinuationStatus,
		reason?: string,
	): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET status = ?, last_reason = ?, updated_at = ?
				 WHERE mission_id = ?
				 RETURNING *`,
			)
			.get(status, reason ?? null, now, missionId) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/**
	 * Record the observable-state fingerprint for the just-finished generation and
	 * advance the consecutive no-progress counter. Resets the counter to 0 when
	 * the fingerprint changed.
	 */
	recordContinuationProgress(missionId: string, fingerprint: string): MissionContinuationRecord | undefined {
		const existing = this.getContinuation(missionId);
		if (!existing) return undefined;
		const now = Date.now();
		const noProgress = existing.progressFingerprint === fingerprint ? existing.noProgressCount + 1 : 0;
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET progress_fingerprint = ?, no_progress_count = ?, updated_at = ?
				 WHERE mission_id = ?
				 RETURNING *`,
			)
			.get(fingerprint, noProgress, now, missionId) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/** Add positive token/time deltas to the continuation accounting counters. */
	accountContinuationUsage(
		missionId: string,
		tokenDelta: number,
		timeDeltaSeconds: number,
	): MissionContinuationRecord | undefined {
		const tokens = Math.max(0, Math.trunc(tokenDelta));
		const seconds = Math.max(0, Math.trunc(timeDeltaSeconds));
		if (tokens === 0 && seconds === 0) return this.getContinuation(missionId);
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET tokens_used = tokens_used + ?, time_used_seconds = time_used_seconds + ?, updated_at = ?
				 WHERE mission_id = ?
				 RETURNING *`,
			)
			.get(tokens, seconds, now, missionId) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}

	/** Transfer continuation ownership to the current session/branch/tree. */
	transferContinuationOwnership(
		missionId: string,
		owner: { sessionId?: string | null; ownerBranch?: string | null; ownerTreeId?: string | null },
	): MissionContinuationRecord | undefined {
		const now = Date.now();
		const row = this.#db
			.query(
				`UPDATE mission_continuation
				 SET session_id = ?, owner_branch = ?, owner_tree_id = ?, updated_at = ?
				 WHERE mission_id = ?
				 RETURNING *`,
			)
			.get(
				owner.sessionId ?? null,
				owner.ownerBranch ?? null,
				owner.ownerTreeId ?? null,
				now,
				missionId,
			) as MissionContinuationRow | null;
		return row ? rowToContinuation(row) : undefined;
	}
}

export function resolveMission(
	store: MissionStore,
	lookup: { missionId?: string | null; title?: string | null; objective?: string | null; objectiveId?: string | null },
): ResearchCampaign | undefined {
	if (lookup.missionId) {
		const exact = store.getMission(lookup.missionId);
		if (exact) return exact;
	}
	if (lookup.objectiveId) {
		const exact = store.findLatestMissionByObjectiveId(lookup.objectiveId);
		if (exact) return exact;
	}
	const title = lookup.title ?? lookup.objective;
	return title ? store.findLatestMissionByTitle(title) : undefined;
}

function generateId(prefix: string, now: number): string {
	return `${prefix}-${now}-${randomBytes(4).toString("hex")}`;
}

function assertMissionState(state: MissionState): void {
	if (!VALID_MISSION_STATES.has(state)) {
		throw new Error(`Invalid mission state: ${state}`);
	}
}

function rowToPhase(row: MissionPhaseRow): MissionPhaseRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		ordinal: row.ordinal,
		name: row.name,
		description: row.description,
		status: row.status,
		planStepIds: parseStringArray(row.plan_step_ids_json, "plan_step_ids_json"),
		acceptanceCriteriaJson: row.acceptance_criteria_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at,
	};
}

function rowToPhaseVerification(row: MissionPhaseVerificationRow): MissionPhaseVerificationRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		phaseId: row.phase_id,
		status: row.status,
		failedCount: row.failed_count,
		uncertainCount: row.uncertain_count,
		summary: row.summary,
		createdAt: row.created_at,
	};
}

function assertEpistemicRole(role: EpistemicRole): void {
	if (!VALID_EPISTEMIC_ROLES.has(role)) {
		throw new Error(`Invalid epistemic role: ${role}`);
	}
}

function assertRuntimeEventType(type: RuntimeEventType): void {
	if (type.trim().length === 0) {
		throw new Error("Runtime event type is required");
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

function assertCriticDialogueRole(role: CriticDialogueRole): void {
	if (role !== "orchestrator" && role !== "inner-critic") {
		throw new Error(`Invalid critic dialogue role: ${role}`);
	}
}

function isTerminalLaneStatus(status: MissionLaneStatus): boolean {
	return status === "completed" || status === "empty" || status === "failed" || status === "aborted";
}

function rowToMission(row: MissionRow): ResearchCampaign {
	return {
		id: row.id,
		title: row.title,
		objective: row.objective ?? row.title,
		objectiveId: row.objective_id,
		briefId: row.brief_id,
		decisionId: row.decision_id,
		riskLevel: row.risk_level,
		state: row.state,
		confidence: row.confidence,
		snapshotRef: row.snapshot_ref,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		revision: row.revision ?? 0,
		intent: row.intent ?? null,
		lifecycle: row.lifecycle ?? null,
		proposalId: row.proposal_id ?? null,
		mode: normalizeMissionMode(row.mode),
		regressionContractId: row.regression_contract_id ?? null,
	};
}
function rowToRuntimeEvent(row: RuntimeEventRow): RuntimeEvent {
	const payload = parseJsonObject(row.payload_json, "payload_json");
	const evidenceRefs = parseStringArray(row.evidence_refs_json, "evidence_refs_json");
	return {
		id: row.id,
		missionId: row.mission_id,
		streamId: row.stream_id,
		sequence: row.sequence,
		type: row.type,
		occurredAt: row.occurred_at,
		correlationId: row.correlation_id,
		causationId: row.causation_id,
		actor: row.actor,
		idempotencyKey: row.idempotency_key,
		payload,
		evidenceRefs,
		schemaVersion: row.schema_version,
		hash: row.hash,
		createdAt: row.created_at,
	};
}

function normalizeMissionMode(value: string | null | undefined): ResearchCampaign["mode"] {
	if (value === "autonomous" || value === "interactive" || value === "dry-run" || value === "auto") return value;
	if (value !== null && value !== undefined && value !== "") {
		console.debug(`Unknown mission mode "${value}" in durable store; falling back to interactive`);
	}
	return "interactive";
}

function rowToObjectiveContractRecord(row: ObjectiveContractRow): ObjectiveContractRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		contractHash: row.contract_hash,
		contract: parseJsonObject(row.contract_json, "contract_json") as unknown as ObjectiveContract,
		status: row.status,
		createdAt: row.created_at,
		approvedAt: row.approved_at ?? undefined,
		approvedBy: row.approved_by ?? undefined,
		supersedesContractId: row.supersedes_contract_id ?? undefined,
	};
}

function rowToRuntimeActionRecord(row: RuntimeActionRow): RuntimeActionRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		objectiveContractId: row.objective_contract_id,
		planId: row.plan_id,
		planStepId: row.plan_step_id || row.step_id,
		action: parseJsonObject(row.action_json, "action_json") as unknown as RuntimeAction,
		lease: row.lease_json ? (parseJsonObject(row.lease_json, "lease_json") as unknown as CapabilityLease) : undefined,
		status: row.status,
		attemptCount: row.attempt_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		lastError: row.last_error ?? undefined,
	};
}

function rowToCapabilityLeaseRecord(row: CapabilityLeaseRow): CapabilityLeaseRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		runtimeActionId: row.runtime_action_id,
		lease: parseJsonObject(row.lease_json, "lease_json") as unknown as CapabilityLease,
		status: row.status,
		issuedAt: row.issued_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at ?? undefined,
		revokedReason: row.revoked_reason ?? undefined,
	};
}

function rowToAgiApprovalRequestRecord(row: AgiApprovalRequestRow): AgiApprovalRequestRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		actionId: row.action_id,
		risk: row.risk,
		status: row.status,
		createdAt: row.created_at,
		decidedAt: row.decided_at ?? undefined,
		decidedBy: row.decided_by ?? undefined,
		reason: row.reason ?? undefined,
	};
}

function rowToAgiEmergencyStopRecord(row: AgiEmergencyStopRow): AgiEmergencyStopRecord {
	return {
		missionId: row.mission_id,
		stoppedAt: row.stopped_at,
		reason: row.reason ?? undefined,
	};
}

function assertRuntimeActionTransition(from: RuntimeAction["status"], to: RuntimeAction["status"]): void {
	const allowed: Record<RuntimeAction["status"], RuntimeAction["status"][]> = {
		queued: ["running", "blocked", "failed"],
		running: ["succeeded", "failed", "blocked"],
		blocked: ["queued", "failed"],
		succeeded: ["verified", "failed"],
		failed: [],
		verified: [],
	};
	if (from === to) return;
	if (!allowed[from].includes(to)) {
		throw new Error(`Invalid runtime action status transition: ${from} -> ${to}`);
	}
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
		parentMissionRev: row.parent_contract_revision,
		include: parseStringArray(row.include_json, "include_json"),
		exclude: parseStringArray(row.exclude_json, "exclude_json"),
		successCriteria: parseStringArray(row.success_criteria_json, "success_criteria_json"),
		escalation: parseEscalation(row.escalation_json),
		inputArtifact: row.input_artifact,
		mustProduce: parseStringArray(row.must_produce_json, "must_produce_json"),
		taskId: row.task_id,
		sessionFile: row.session_file,
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

function rowToReview(row: MissionReviewRow): MissionReviewRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		status: row.status,
		verdict: row.verdict,
		failedCount: row.failed_count,
		uncertainCount: row.uncertain_count,
		summary: row.summary,
		sourceFiles: parseStringArray(row.source_files_json, "source_files_json"),
		excludedMarkdownFiles: parseStringArray(row.excluded_markdown_files_json, "excluded_markdown_files_json"),
		createdAt: row.created_at,
		reviewedAt: row.reviewed_at,
	};
}

function rowToTaskAttemptCheckpoint(row: MissionTaskAttemptCheckpointRow): MissionTaskAttemptCheckpoint {
	return {
		id: row.id,
		missionId: row.mission_id,
		taskId: row.task_id,
		agent: row.agent,
		role: row.role,
		attempt: row.attempt,
		status: row.status,
		failureMode: row.failure_mode,
		lastVerdict: row.last_verdict,
		failedCount: row.failed_count,
		uncertainCount: row.uncertain_count,
		remediationAction: row.remediation_action,
		sessionFile: row.session_file,
		artifactRefs: parseStringArray(row.artifact_refs_json, "artifact_refs_json"),
		error: row.error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
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

function rowToCriticDialogueTurn(row: MissionCriticDialogueTurnRow): MissionCriticDialogueTurn {
	return {
		id: row.id,
		missionId: row.mission_id,
		role: row.role,
		summary: row.summary,
		checkIds: parseStringArray(row.check_ids_json, "check_ids_json"),
		createdAt: row.created_at,
	};
}

function rowToWorldModel(row: MissionWorldModelRow): MissionWorldModelRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		kind: row.kind,
		source: row.source,
		sourceId: row.source_id,
		claim: row.claim,
		evidenceRefs: parseStringArray(row.evidence_refs_json, "evidence_refs_json"),
		links: parseWorldModelLinks(row.links_json ?? "[]"),
		outcomeStatus: row.outcome_status ?? null,
		verified: row.verified === 1,
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

function parseJsonObject(value: string, column: string): Record<string, unknown> {
	const parsed = JSON.parse(value) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Invalid runtime event JSON column: ${column}`);
	}
	return parsed as Record<string, unknown>;
}

function parseWorldModelLinks(value: string): MissionWorldModelLink[] {
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("Invalid JSON array in links_json");
	}
	return parsed.map((link, index) => {
		if (
			typeof link !== "object" ||
			link === null ||
			typeof (link as { targetId?: unknown }).targetId !== "string" ||
			typeof (link as { type?: unknown }).type !== "string"
		) {
			throw new Error(`Invalid world-model link at index ${index}`);
		}
		const typed = link as MissionWorldModelLink;
		return { targetId: typed.targetId, type: typed.type };
	});
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

type MissionTaskRow = {
	id: string;
	mission_id: string;
	title: string;
	objective: string | null;
	status: string;
	assigned_agent: string | null;
	plan_step_id: string | null;
	data_json: string;
	created_at: number;
	updated_at: number;
};

function rowToMissionTask(row: MissionTaskRow): MissionTask {
	const data = JSON.parse(row.data_json) as {
		scope?: MissionTask["scope"] | null;
		successCriteria?: string[] | null;
		escalationCriteria?: string[] | null;
		allowedTools?: string[] | null;
		deniedTools?: string[] | null;
		evidenceRefs?: string[] | null;
		output?: string | null;
	};
	const task: MissionTask = {
		id: row.id,
		missionId: row.mission_id,
		title: row.title,
		status: row.status as MissionTaskStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.objective != null) task.objective = row.objective;
	if (row.assigned_agent != null) task.assignedAgent = row.assigned_agent;
	if (row.plan_step_id != null) task.planStepId = row.plan_step_id;
	if (data.scope) task.scope = data.scope;
	if (data.successCriteria && data.successCriteria.length > 0) task.successCriteria = data.successCriteria;
	if (data.escalationCriteria && data.escalationCriteria.length > 0) task.escalationCriteria = data.escalationCriteria;
	if (data.allowedTools && data.allowedTools.length > 0) task.allowedTools = data.allowedTools;
	if (data.deniedTools && data.deniedTools.length > 0) task.deniedTools = data.deniedTools;
	if (data.evidenceRefs && data.evidenceRefs.length > 0) task.evidenceRefs = data.evidenceRefs;
	if (data.output != null) task.output = data.output;
	return task;
}

type MissionProposalRow = {
	id: string;
	mission_id: string;
	artifact_uri: string;
	content_hash: string;
	status: string;
	approved_by: string | null;
	approved_at: number | null;
	summary: string | null;
	created_at: number;
	updated_at: number;
};

function rowToProposal(row: MissionProposalRow): MissionProposal {
	const status = row.status as MissionProposalStatus;
	assertProposalStatus(status);
	return {
		id: row.id,
		missionId: row.mission_id,
		artifactUri: row.artifact_uri,
		contentHash: row.content_hash,
		status,
		approvedBy: row.approved_by,
		approvedAt: row.approved_at,
		summary: row.summary,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function assertProposalStatus(status: MissionProposalStatus): void {
	if (!MISSION_PROPOSAL_STATUSES.includes(status)) {
		throw new Error(`Invalid mission proposal status: ${status}`);
	}
}
function canonicalRuntimeEventHash(event: RuntimeEvent): string {
	return createHash("sha256").update(canonicalRuntimeEventBody(event)).digest("hex");
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalRuntimeEventBody(event: RuntimeEvent): string {
	return stringifyCanonicalJson({
		actor: event.actor,
		causationId: event.causationId,
		correlationId: event.correlationId,
		evidenceRefs: event.evidenceRefs,
		idempotencyKey: event.idempotencyKey,
		missionId: event.missionId,
		occurredAt: event.occurredAt,
		payload: event.payload,
		schemaVersion: event.schemaVersion,
		sequence: event.sequence,
		type: event.type,
	});
}

function stringifyCanonicalJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (typeof value !== "object" || value === null) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const child = (value as Record<string, unknown>)[key];
		if (child !== undefined) sorted[key] = sortJson(child);
	}
	return sorted;
}
