---
doc_id: mission-control-rag-13-runtime-event-ledger
domain: mission-control.runtime-event-ledger
retrieval_tags:
  - runtime-event-sourcing
  - event-ledger
  - mission-store-source-of-truth
  - agi-events
  - replay-projections
  - idempotency
  - evidence-ledger
  - verification-events
source_evidence:
  - packages/coding-agent/src/agi/store.ts:562-591
  - packages/coding-agent/src/mission/store.ts:258-365
  - packages/coding-agent/src/mission/store.ts:390-416
  - packages/coding-agent/src/mission/continuation/runtime.ts:1-220
  - packages/coding-agent/src/mission/continuation/policy.ts:1-230
planner_uses:
  - Retrieve when planning append-only runtime events, mission/AGI replay, action/evidence projections, crash recovery, continuation scheduling, or verifier-authoritative completion.
  - Use MissionStore normalized records as the durable read model and runtime events as the audit/replay history, not as competing sources of truth.
  - Require event idempotency keys for external observations, tool decisions/results, continuation scheduling, verification, replanning, and learning inputs.
---

# Runtime event ledger

Cross-references: [README](./README.md) defines the Mission Control retrieval protocol; [09 Governance Runtime Profile](./09-governance-runtime-profile.md) defines governance and oversight events; [10 Agency Kernel Architecture](./10-agency-kernel-architecture.md) defines event sourcing as part of the agency kernel; [11 Objective Contract and Role Router](./11-objective-contract-role-router.md) defines runtime action identity and role routing; [12 Tool Capability Safety](./12-tool-capability-safety.md) defines capability lease decisions that must become ledger events.

This document is a target design. It does not claim the current repository already has a unified `runtime_events` table, projection rebuild API, or full mission/AGI replay system. Current-state claims are limited to the source evidence below.

## Spec

The target runtime must maintain an append-only event ledger for every state transition that matters to planning, execution, audit, replay, verification, continuation, and learning.

The event ledger records the closed loop:

```text
objective.created
  -> mission.bound
  -> plan.created / plan.revised
  -> action.queued
  -> tool.requested / tool.authorized / tool.denied / tool.completed
  -> evidence.recorded
  -> verification.completed
  -> replan.requested / learning.proposed / continuation.scheduled
  -> mission.completed / mission.blocked / mission.cancelled
```

The ledger is not a replacement for normalized MissionStore tables. MissionStore remains the durable source of truth for missions, plans, tasks, criteria, world-model claims, budgets, scope guards, proposals, and continuation state. Runtime events are the append-only history used to rebuild projections, explain decisions, suppress duplicates, and verify that completion came from evidence-backed verifier authority rather than agent self-report.

## Current source evidence

| Current seam | Repository evidence | What exists now | Gap to target event ledger |
| --- | --- | --- | --- |
| AGI events table | `packages/coding-agent/src/agi/store.ts:562-572` | `agi_events` has `id`, `session_id`, `type`, valid JSON payload, `created_at`, `processed_at`, session foreign key, and session/processed indexes. | It is session-scoped and does not include `missionId`, `objectiveId`, idempotency key, actor, evidence refs, policy decision details, or replay ordering across MissionStore. |
| AGI actions table | `packages/coding-agent/src/agi/store.ts:574-591` | `agi_actions` stores action id, session id, optional event id, action type, instruction, status, timestamps, result JSON, last error, and indexes. | Actions are gateway execution projection rows, not a unified event stream tied to MissionStore plan steps, criteria, capability leases, and verifier decisions. |
| Mission durable read models | `packages/coding-agent/src/mission/store.ts:258-365` | MissionStore persists world-model claims, tasks, plans, plan steps, acceptance criteria, budgets, scope guards, and proposal artifact/hash records. | These normalized tables need an append-only event ledger so their changes can be replayed, audited, and correlated with AGI/gateway events. |
| Continuation ledger | `packages/coding-agent/src/mission/store.ts:390-416` | `mission_continuation` stores per-mission continuation status, generation, owner, auto-turn counts, budget counters, progress fingerprint, no-progress count, timestamps, and last reason. | This is a state row/ledger for continuation scheduling, but not a general append-only runtime event stream. |
| Continuation runtime | `packages/coding-agent/src/mission/continuation/runtime.ts:1-220` | Runtime rehydrates stale scheduled/running state, classifies continuation after agent end, records progress fingerprint, uses CAS scheduling, re-checks pending user input before delivery, and rolls scheduled state back on send failure. | Target runtime should append events for classification, CAS schedule success/failure, send success/failure, rollback-to-idle, and terminal observation. |
| Continuation policy | `packages/coding-agent/src/mission/continuation/policy.ts:1-230` | Pure policy computes acceptance preflight, terminal lifecycle handling, auto-mission exclusion, user-pending holds, proposal holds, budget/no-progress holds, and continue decisions for missing requirements or completion recording. | Policy decisions should be represented as ledger events with input fingerprints and evidence refs so replay can explain why a continuation did or did not happen. |

## Relationship to AGI events and MissionStore records

### AGI events

`agi_events` is the current gateway-session event table. It is useful as a projection for AGI UI/supervisor telemetry, but target Mission Control needs a mission-scoped runtime ledger. New runtime events should either:

1. write to a unified `runtime_events` table and project gateway-specific rows into `agi_events`, or
2. keep `agi_events` as legacy projection while MissionStore owns the authoritative event ledger.

AGI event rows should never be the only record for mission completion, verifier decisions, proposal application, or autonomous continuation. Those decisions need mission id, evidence refs, criteria refs, policy input, and idempotency keys.

### MissionStore records

MissionStore normalized records are the queryable current state:

- `mission_world_model`: claims and evidence refs.
- `mission_tasks`: executable work state.
- `mission_plans` and `mission_plan_steps`: DAG revisions and step edges.
- `mission_acceptance_criteria`: verifier-addressable criteria and evidence refs.
- `mission_budgets`: token/time/task/context counters.
- `mission_scope_guards`: allowed/denied paths and tools.
- `mission_proposals`: artifact URI, content hash, approval, and status.
- `mission_continuation`: continuation scheduling state and progress fingerprint.

Runtime events are the causal history behind those records. A projection rebuild reads events in order and reconstructs the same normalized state. If normalized rows and events disagree, the runtime must stop and repair from a known checkpoint instead of silently choosing whichever state is convenient.

## Required event schema

A runtime event MUST include:

| Field | Required purpose |
| --- | --- |
| `eventId` | Unique immutable event identity. |
| `streamId` | Ordered stream identity, normally `mission:<missionId>`; may be `objective:<objectiveId>` before mission binding. |
| `sequence` | Monotonic per-stream sequence assigned transactionally. |
| `missionId` | Mission id for all mission-bound events. Nullable only before binding. |
| `objectiveId` | Objective/contract id when known. |
| `sessionId` | AGI/session id when the event came through gateway or supervisor. |
| `planId` / `planRevision` / `planStepId` | Plan DAG correlation for action/planning events. |
| `taskId` / `actionId` / `toolCallId` | Execution correlation. |
| `type` | Stable event type string. |
| `occurredAt` | Runtime occurrence timestamp. |
| `recordedAt` | Ledger insertion timestamp. |
| `actor` | Role, agent/session/user id, and authority source. |
| `idempotencyKey` | Stable duplicate-suppression key for retried observations/actions. |
| `payloadJson` | Canonical JSON payload for the event type. |
| `evidenceRefsJson` | Evidence refs produced or consumed by the event. |
| `causationEventId` | Event that directly caused this event. |
| `correlationId` | End-to-end objective/mission/action correlation id. |
| `schemaVersion` | Event payload schema version. |
| `hash` | Canonical event hash for audit and replay integrity. |

Events are append-only. Corrections are new events, such as `tool.rollback.completed`, `evidence.superseded`, `verification.revised`, or `mission.reopened`; existing rows are not mutated except for processing/projection metadata outside the event payload.

## Idempotency keys

The ledger MUST reject duplicate events for the same `streamId` and `idempotencyKey`. Keys must be deterministic for operations that can be retried after crash/resume.

Recommended idempotency key patterns:

| Event class | Key pattern |
| --- | --- |
| Objective creation | `objective:create:<objectiveContractHash>` |
| Mission binding | `mission:bind:<objectiveId>:<missionId>` |
| Plan creation | `plan:create:<missionId>:<planRevision>:<planHash>` |
| Plan revision | `plan:revise:<missionId>:<previousRevision>:<newPlanHash>` |
| Action queued | `action:queue:<missionId>:<planStepId>:<actionId>` |
| Tool requested | `tool:requested:<actionId>:<toolCallId>` |
| Tool authorized/denied | `tool:policy:<actionId>:<toolCallId>:<policyStage>` |
| Tool completed | `tool:completed:<actionId>:<toolCallId>:<resultHash>` |
| Evidence recorded | `evidence:<source>:<sourceId>:<contentHash>` |
| Verification completed | `verification:<missionId>:<criteriaHash>:<evidenceHash>:<verdict>` |
| Continuation classified | `continuation:classify:<missionId>:<generation>:<progressFingerprint>` |
| Continuation scheduled | `continuation:schedule:<missionId>:<expectedGeneration>:<newGeneration>` |
| Learning proposed | `learning:propose:<missionId>:<outcomeHash>:<proposalHash>` |
| Completion | `mission:complete:<missionId>:<verificationEventId>:<outcomeHash>` |

External observations should use provider/source ids when available. Tool result keys should include canonical result hashes, not raw nondeterministic log text.

## Event examples

Required core event types include:

- `objective.created`: ObjectiveContract accepted with objective, criteria, constraints, budget, guardrails, provenance hash.
- `mission.bound`: ObjectiveContract attached to MissionStore mission and optional AGI session.
- `plan.created`: Plan DAG revision created with step ids and dependency edges.
- `plan.revised`: Plan DAG revision changed because evidence, verifier result, or policy state required replan.
- `action.queued`: RuntimeAction created from a plan step and role-router decision.
- `lease.issued`: Capability lease minted for one action.
- `tool.requested`: Tool call submitted to gateway with lease/action/tool ids.
- `tool.authorized`: Policy/permission/scope gates allowed the call.
- `tool.denied`: Policy/permission/scope gates denied the call, with stage, code, and reason.
- `tool.completed`: Tool result recorded with status, output evidence refs, and result hash.
- `evidence.recorded`: Observation, test output, diff, citation, browser trace, deployment health, review finding, or verifier trace persisted.
- `verification.completed`: Verifier evaluated criteria/evidence and produced pass/fail/pending/force verdict.
- `continuation.classified`: Continuation policy classified next action from lifecycle, proposal, budget, no-progress, user-pending, and acceptance preflight state.
- `continuation.scheduled`: CAS scheduling advanced a generation and delivered or attempted a continuation turn.
- `continuation.blocked`: Policy or kill switch prevented continuation.
- `learning.proposed`: Terminal verified mission outcome generated a learning proposal.
- `proposal.approved`: Human or policy approval attached to proposal artifact/hash.
- `proposal.applied`: Proposal applied with rollback refs and evidence refs.
- `mission.completed`: Mission reached terminal completion after verifier authority and outcome record.
- `mission.blocked`: Mission moved to blocked with evidence-backed reason.
- `mission.cancelled`: Operator or policy cancelled mission.

## Replay and projection rules

Replay must be deterministic and fail closed.

1. Select a stream, usually `mission:<missionId>`.
2. Read events ordered by `(sequence, eventId)`.
3. Validate event hash, schema version, JSON payload, and idempotency uniqueness.
4. Apply only known event types for the projection version.
5. Rebuild projections into a temporary state: mission binding, plan DAG, action queue, tool status, evidence index, criteria state, budgets, proposals, continuation state, learning inputs.
6. Compare temporary projection to normalized MissionStore rows at checkpoint boundaries.
7. If equal, swap or mark projection current.
8. If not equal, stop with a repair-required event/diagnostic; do not continue autonomous execution from inconsistent state.

Projection rebuild MUST NOT execute tools, send continuation messages, apply proposals, mutate source files, call external APIs, or re-run verifiers. Replay is pure state reconstruction. Side effects happen only from new runtime actions after policy validation.

## Completion authority in the event ledger

A mission may become completed only when the ledger contains:

1. Objective/mission binding events proving the goal source.
2. Plan/action/evidence events covering required criteria.
3. A `verification.completed` event with a passing verdict or explicit force verdict under the mission policy.
4. Any required review/proposal/rollback events for the mission intent and risk profile.
5. A `mission.completed` event causally linked to the verification event and outcome record.

Agent-authored completion text, AGI score, assistant self-report, or `tool.completed` success is not terminal authority. Those may become evidence refs consumed by `verification.completed`.

## Target TypeScript Sample: runtime event table/interface

This is target/source sample code, not an existing implementation.

```ts
export const RUNTIME_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_events (
	event_id TEXT PRIMARY KEY,
	stream_id TEXT NOT NULL,
	sequence INTEGER NOT NULL,
	mission_id TEXT,
	objective_id TEXT,
	session_id TEXT,
	plan_id TEXT,
	plan_revision INTEGER,
	plan_step_id TEXT,
	task_id TEXT,
	action_id TEXT,
	tool_call_id TEXT,
	type TEXT NOT NULL,
	occurred_at INTEGER NOT NULL,
	recorded_at INTEGER NOT NULL,
	actor_json TEXT NOT NULL CHECK (json_valid(actor_json)),
	idempotency_key TEXT NOT NULL,
	payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
	evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
	causation_event_id TEXT,
	correlation_id TEXT NOT NULL,
	schema_version INTEGER NOT NULL,
	hash TEXT NOT NULL,
	UNIQUE(stream_id, sequence),
	UNIQUE(stream_id, idempotency_key),
	FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS runtime_events_mission_idx ON runtime_events(mission_id, sequence);
CREATE INDEX IF NOT EXISTS runtime_events_type_idx ON runtime_events(type, occurred_at);
CREATE INDEX IF NOT EXISTS runtime_events_action_idx ON runtime_events(action_id, tool_call_id);
`;

export type RuntimeEventType =
	| "objective.created"
	| "mission.bound"
	| "plan.created"
	| "plan.revised"
	| "action.queued"
	| "lease.issued"
	| "tool.requested"
	| "tool.authorized"
	| "tool.denied"
	| "tool.completed"
	| "evidence.recorded"
	| "verification.completed"
	| "continuation.classified"
	| "continuation.scheduled"
	| "continuation.blocked"
	| "learning.proposed"
	| "proposal.approved"
	| "proposal.applied"
	| "mission.completed"
	| "mission.blocked"
	| "mission.cancelled";

export interface RuntimeEvent<TPayload = Record<string, unknown>> {
	eventId: string;
	streamId: string;
	sequence: number;
	missionId?: string;
	objectiveId?: string;
	sessionId?: string;
	planId?: string;
	planRevision?: number;
	planStepId?: string;
	taskId?: string;
	actionId?: string;
	toolCallId?: string;
	type: RuntimeEventType;
	occurredAt: number;
	recordedAt: number;
	actor: { role: string; id?: string; authority: "user" | "policy" | "agent" | "system" };
	idempotencyKey: string;
	payload: TPayload;
	evidenceRefs: string[];
	causationEventId?: string;
	correlationId: string;
	schemaVersion: number;
	hash: string;
}
```

## Target TypeScript Sample: append API

This is target/source sample code, not an existing implementation.

```ts
export interface RuntimeEventDraft<TPayload = Record<string, unknown>> {
	streamId?: string;
	missionId?: string;
	objectiveId?: string;
	sessionId?: string;
	planId?: string;
	planRevision?: number;
	planStepId?: string;
	taskId?: string;
	actionId?: string;
	toolCallId?: string;
	type: RuntimeEventType;
	occurredAt?: number;
	actor: RuntimeEvent["actor"];
	idempotencyKey: string;
	payload: TPayload;
	evidenceRefs?: string[];
	causationEventId?: string;
	correlationId?: string;
	schemaVersion?: number;
}

export class RuntimeEventLedger {
	constructor(private readonly db: Database, private readonly clock: () => number) {}

	append<TPayload>(draft: RuntimeEventDraft<TPayload>): RuntimeEvent<TPayload> {
		const streamId = draft.streamId ?? (draft.missionId ? `mission:${draft.missionId}` : `objective:${draft.objectiveId}`);
		if (!streamId) throw new Error("runtime event requires streamId, missionId, or objectiveId");

		return this.db.transaction(() => {
			const existing = this.getByIdempotencyKey(streamId, draft.idempotencyKey);
			if (existing) return existing as RuntimeEvent<TPayload>;

			const sequence = this.nextSequence(streamId);
			const recordedAt = this.clock();
			const eventWithoutHash = {
				eventId: newEventId(),
				streamId,
				sequence,
				missionId: draft.missionId,
				objectiveId: draft.objectiveId,
				sessionId: draft.sessionId,
				planId: draft.planId,
				planRevision: draft.planRevision,
				planStepId: draft.planStepId,
				taskId: draft.taskId,
				actionId: draft.actionId,
				toolCallId: draft.toolCallId,
				type: draft.type,
				occurredAt: draft.occurredAt ?? recordedAt,
				recordedAt,
				actor: draft.actor,
				idempotencyKey: draft.idempotencyKey,
				payload: draft.payload,
				evidenceRefs: draft.evidenceRefs ?? [],
				causationEventId: draft.causationEventId,
				correlationId: draft.correlationId ?? streamId,
				schemaVersion: draft.schemaVersion ?? 1,
			};
			const event = { ...eventWithoutHash, hash: hashCanonicalJson(eventWithoutHash) };
			this.insert(event);
			return event;
		})();
	}
}
```

## Target TypeScript Sample: projection rebuild

This is target/source sample code, not an existing implementation.

```ts
export interface RuntimeProjection {
	mission?: Mission;
	objective?: ObjectiveContract;
	plan?: MissionPlan;
	actions: Map<string, RuntimeActionProjection>;
	evidence: Map<string, EvidenceRecord>;
	criteria: Map<string, AcceptanceCriterionProjection>;
	continuation?: MissionContinuationProjection;
	terminal?: { lifecycle: "completed" | "blocked" | "cancelled"; eventId: string };
}

export function rebuildMissionProjection(events: RuntimeEvent[]): RuntimeProjection {
	const seen = new Set<string>();
	const projection: RuntimeProjection = {
		actions: new Map(),
		evidence: new Map(),
		criteria: new Map(),
	};

	for (const event of events.sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId))) {
		const duplicateKey = `${event.streamId}:${event.idempotencyKey}`;
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		assertEventHash(event);

		switch (event.type) {
			case "mission.bound":
				projection.mission = projectMissionBound(event);
				break;
			case "plan.created":
			case "plan.revised":
				projection.plan = projectPlan(event);
				break;
			case "action.queued":
				projection.actions.set(event.actionId!, projectQueuedAction(event));
				break;
			case "tool.denied":
			case "tool.completed":
				projection.actions.set(event.actionId!, projectToolOutcome(projection.actions.get(event.actionId!), event));
				break;
			case "evidence.recorded":
				projection.evidence.set(event.payload["evidenceId"] as string, projectEvidence(event));
				break;
			case "verification.completed":
				applyVerificationProjection(projection.criteria, event);
				break;
			case "continuation.classified":
			case "continuation.scheduled":
			case "continuation.blocked":
				projection.continuation = projectContinuation(projection.continuation, event);
				break;
			case "mission.completed":
			case "mission.blocked":
			case "mission.cancelled":
				projection.terminal = projectTerminal(event);
				break;
			default:
				assertNeverEventType(event.type);
		}
	}

	if (projection.terminal?.lifecycle === "completed") {
		assertVerifierBackedCompletion(events, projection.terminal.eventId);
	}
	return projection;
}
```

## AGI runtime acceptance criteria

- A unified mission-scoped runtime event ledger exists for objective, mission, plan, action, lease, tool, evidence, verification, continuation, proposal, learning, and terminal lifecycle events.
- Events are append-only; corrections and rollbacks are represented as new events, not payload rewrites.
- Each event has stream id, per-stream sequence, mission/objective/session/action correlation fields, actor, idempotency key, payload JSON, evidence refs, schema version, and canonical hash.
- Duplicate external observations, retried tool calls, and replayed continuation scheduling are suppressed by stable idempotency keys.
- AGI `agi_events` and `agi_actions` are treated as gateway projections or legacy telemetry; MissionStore plus runtime events remain authoritative for objective, evidence, verification, and completion.
- Projection rebuild is pure and deterministic; it never executes tools, calls external systems, sends continuation messages, or mutates source files.
- Replay can rebuild mission plans, action states, evidence index, criteria verification state, continuation state, and terminal lifecycle from events.
- Mission completion requires a `verification.completed` event with evidence-backed authority and a causally linked terminal event; agent self-report or successful tool completion alone cannot complete a mission.
