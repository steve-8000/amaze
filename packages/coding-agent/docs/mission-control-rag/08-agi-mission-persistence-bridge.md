---
doc_id: mission-control-rag-08-agi-mission-persistence-bridge
domain: mission-control.agi-mission-persistence-bridge
retrieval_tags:
  - agi-gateway-store
  - mission-store
  - mission-persistence
  - agi-session-mission-bridge
  - evidence-refs
  - completion-authority
source_evidence:
  - packages/coding-agent/src/agi/store.ts:53-70
  - packages/coding-agent/src/agi/store.ts:163-195
  - packages/coding-agent/src/agi/store.ts:541-591
  - packages/coding-agent/src/mission/store.ts:85-97
  - packages/coding-agent/src/mission/core/mission-runtime.ts:300-303
  - packages/coding-agent/src/mission/core/verifier.ts
  - packages/coding-agent/src/cognition/world-model.ts
planner_uses:
  - Retrieve when an AGI Gateway session must become a Mission Control mission instead of a detached supervisor loop.
  - Plan schema, CLI, and runtime changes that bind AGI sessions to durable mission objectives, evidence refs, and world-model claims.
  - Require Mission Control acceptance preflight and verifier state as completion authority for AGI sessions.
---

# AGI mission persistence bridge

Cross-references: [README](./README.md) defines the RAG retrieval flow; [01 Autonomy Objective Loop](./01-autonomy-objective-loop.md) covers durable objective scheduling; [04 Verification Gates](./04-verification-gates.md) defines completion authority; [05 Memory, Learning, Continuation](./05-memory-learning-continuation.md) defines world-model evidence; [06 Researcher Recency Provenance](./06-researcher-recency-provenance.md) covers current external facts; [07 AGI Gateway Supervisor](./07-agi-gateway-supervisor.md) covers the gateway surface that this bridge persists.

## Spec

Amaze's target is an AGI runtime. AGI Gateway sessions must not remain a parallel persistence island beside Mission Control. Every AGI session that is intended to pursue a durable goal must either attach to an existing mission or create one before autonomous work starts.

The bridge must provide these behaviors:

1. AGI session rows store `missionId`, durable `objective`, goal `criteria`, and `evidenceRefs`.
2. `agi add` accepts `--mission <id>` to bind an AGI session to an existing MissionStore mission.
3. `agi add` accepts `--create-mission` plus explicit objective/criteria input to create a MissionStore mission and bind the AGI session to it.
4. `agi add` accepts goal criteria input instead of relying on a hard-coded default AGI build goal.
5. MissionStore persists objective text as first-class mission data; hydrate must restore objective from persisted objective text, not from title alone.
6. AGI actions and supervisor observations append evidence refs into MissionStore world-model records, using the same evidence semantics as Mission Control task/verification records.
7. Mission acceptance preflight and verifier state are the completion authority. AGI self-report markers are evidence candidates, not completion decisions.

The clean cutover is one mission identity per durable AGI objective. The AGI store may keep gateway-specific session/action telemetry, but mission objective, acceptance criteria, world-model claims, verifier records, and completion decisions belong to MissionStore.

## Source Evidence

- `src/agi/store.ts:53-70`: `AgiMonitoredSession` records session id/path, cwd, title, preferred model, state, score, observed bytes, goal spec, completion/control state, summaries, errors, and timestamps, but lacks `missionId`, durable objective text, criteria, and `evidenceRefs`.
- `src/agi/store.ts:163-195`: default goal spec is hard-coded as the initial AGI build goal, so AGI sessions can start without operator-supplied mission criteria.
- `src/agi/store.ts:541-591`: AGI persistence initializes `agi_sessions`, `agi_events`, and `agi_actions`; there is no mission bridge table or mission/world-model evidence projection.
- `src/mission/store.ts:85-97` plus additive migrations for `intent`, `lifecycle`, proposal pointers, regression contract pointers, and revision: MissionStore persists mission identity, display title, objective id, brief id, decision id, risk, state, confidence, snapshot, lifecycle metadata, and timestamps, but does not persist full objective text as a separate field.
- `src/mission/core/mission-runtime.ts:300-303`: mission hydrate restores `objective: record.title`, losing the distinction between display title and full operator objective.
- `src/mission/core/verifier.ts`: AcceptanceVerifier is the target authority for deterministic and semantic acceptance criteria.
- `src/cognition/world-model.ts`: world-model records already support evidence-linked mission claims for planning context.

## Persistence Bridge Model

### AGI session fields

AGI sessions should carry mission binding fields even when the mission is created later by a migration:

- `missionId`: nullable for legacy/imported sessions only; required for new autonomous AGI sessions.
- `objective`: full operator objective used for planning and continuation prompts.
- `criteria`: explicit acceptance criteria supplied through CLI/TUI/config.
- `evidenceRefs`: dereferenceable refs produced by AGI actions, driver resumes, verifier rows, and mission world-model records.

### Mission objective persistence

MissionStore must add an objective text column or equivalent normalized field. Title remains a display label. Hydration must prefer stored objective and only fall back to title for legacy rows.

### Evidence projection

AGI action completion should produce both AGI telemetry and MissionStore world-model claims. Evidence refs should use concrete sources such as `agi-session://<sessionId>`, `agi-action://<actionId>`, `verification://<missionId>:<revision>`, or `mission-world-model://<rowId>`.

### Completion authority

AGI supervisor completion must call the same acceptance preflight described in [04 Verification Gates](./04-verification-gates.md). A structured AGI result can request completion, but Mission Control decides by checking mission criteria, verifier state, lifecycle gates, and unresolved failure/uncertainty.

## Target TypeScript Sample: schema and types

This is target/source sample code, not an existing implementation.

```ts
export interface AgiMonitoredSession {
	id: string;
	sessionPath: string;
	title: string;
	status: "running" | "idle" | "blocked" | "completed";
	missionId: string;
	objective: string;
	criteria: AcceptanceCriterion[];
	evidenceRefs: string[];
	lastStructuredResult?: AgiStructuredResult;
}

export interface MissionRecord {
	id: string;
	title: string;
	objective: string;
	status: MissionStatus;
	intent: MissionIntent;
	riskLevel: RiskLevel;
	mode: "interactive" | "autonomous";
	metadata: Record<string, unknown>;
}

export const AGI_SESSION_MISSION_MIGRATION = `
	ALTER TABLE agi_sessions ADD COLUMN mission_id TEXT NULL;
	ALTER TABLE agi_sessions ADD COLUMN objective TEXT NULL;
	ALTER TABLE agi_sessions ADD COLUMN criteria_json TEXT NOT NULL DEFAULT '[]';
	ALTER TABLE agi_sessions ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]';
	CREATE INDEX IF NOT EXISTS agi_sessions_mission_id_idx ON agi_sessions(mission_id);

	ALTER TABLE missions ADD COLUMN objective TEXT NULL;
`;
```

## Target TypeScript Sample: mission-derived goal spec

This is target/source sample code, not an existing implementation.

```ts
export async function createAgiSessionFromMission(args: {
	agiStore: AgiGatewayStore;
	missionStore: MissionStore;
	missionId?: string;
	createMission?: boolean;
	objective: string;
	criteria: AcceptanceCriterion[];
}) {
	if (!args.objective.trim()) throw new Error("AGI mission objective is required");
	if (args.criteria.length === 0) throw new Error("AGI mission criteria are required");

	const mission = args.missionId
		? args.missionStore.getMission(args.missionId)
		: args.createMission
			? args.missionStore.createMission({
					title: summarizeObjectiveTitle(args.objective),
					objective: args.objective,
					intent: "runtime_refactor",
					riskLevel: "high",
					mode: "autonomous",
					acceptanceCriteria: args.criteria,
				})
			: undefined;

	if (!mission) throw new Error("AGI session requires --mission or --create-mission");

	return args.agiStore.addSession({
		missionId: mission.id,
		objective: mission.objective,
		criteria: args.criteria,
		goalSpec: {
			goal: mission.objective,
			acceptance: args.criteria.map(criterion => criterion.description),
			completionAuthority: "mission-acceptance-preflight",
		},
	});
}

export function recordAgiActionEvidence(args: {
	missionStore: MissionStore;
	missionId: string;
	actionId: string;
	description: string;
	refs: string[];
}) {
	return args.missionStore.recordWorldModel({
		missionId: args.missionId,
		kind: "observation",
		source: "agi-action",
		sourceId: args.actionId,
		claim: args.description,
		evidenceRefs: [`agi-action://${args.actionId}`, ...args.refs],
		verified: false,
	});
}
```

## AGI runtime acceptance criteria

- New autonomous AGI sessions cannot start without a MissionStore mission id, objective text, and acceptance criteria.
- `agi add --mission <id>` binds to an existing mission and preserves that mission's objective and criteria.
- `agi add --create-mission` creates a MissionStore mission with objective text, criteria, risk, intent, and mode before creating the AGI session.
- Mission hydrate restores full objective text; title-only fallback is limited to legacy rows.
- AGI actions record dereferenceable evidence refs and project useful claims into MissionStore world model.
- AGI completion only succeeds after Mission Control acceptance preflight and verifier state pass; AGI self-report alone never marks a mission complete.
