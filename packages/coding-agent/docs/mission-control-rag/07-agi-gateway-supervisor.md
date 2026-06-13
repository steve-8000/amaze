---
doc_id: mission-control-rag-07-agi-gateway-supervisor
domain: mission-control.agi-gateway-supervisor
retrieval_tags:
  - agi-gateway
  - agi-supervisor
  - runtime-control
  - jsonl-observation
  - completion-verifier
  - launch-resume-print
  - retry-block-state
source_evidence:
  - packages/coding-agent/src/cli.ts:27-58
  - packages/coding-agent/src/commands/agi.ts:3-19
  - packages/coding-agent/src/cli/agi.ts:15-134
  - packages/coding-agent/src/agi/tui.ts:15-57
  - packages/coding-agent/src/agi/tui.ts:75-92
  - packages/coding-agent/src/agi/supervisor.ts:21-29
  - packages/coding-agent/src/agi/supervisor.ts:130-135
  - packages/coding-agent/src/agi/supervisor.ts:157-265
  - packages/coding-agent/src/agi/supervisor.ts:268-426
  - packages/coding-agent/src/agi/supervisor.ts:476-590
  - packages/coding-agent/src/agi/supervisor.ts:607-642
  - packages/coding-agent/src/agi/store.ts:53-70
  - packages/coding-agent/src/agi/store.ts:163-195
  - packages/coding-agent/src/agi/store.ts:536-614
  - packages/coding-agent/test/cli/agi.test.ts:65-281
planner_uses:
  - Retrieve when planning AGI Gateway CLI, TUI, supervisor, JSONL observation, or runtime-control changes.
  - Distinguish current AGI session-follow-up implementation from the target Amaze AGI runtime control plane.
  - Require external completion evidence and verifier wiring before any runtime claims goal completion.
---

# AGI Gateway supervisor and runtime control

Cross-references: start from [README](./README.md) for Mission Control retrieval flow; use [04 Verification Gates](./04-verification-gates.md) for completion authority; use [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md) for mission/session persistence; use [09 Governance Runtime Profile](./09-governance-runtime-profile.md) for human oversight, override, audit, and risk controls.

## Spec

Amaze's target is an AGI runtime control plane, not only Mission Control documentation. The AGI Gateway is the runtime-facing seam that observes active agent sessions, decides whether more work is needed, drives bounded follow-up turns, records evidence, and exposes operator controls through CLI and TUI surfaces.

### CLI and TUI surface

The CLI must make runtime control explicit:

- `amaze agi` opens the TUI in a TTY and falls back to status text outside a TTY.
- `amaze agi status`, `events`, and `actions` expose durable runtime state for inspection.
- `add`, `pause`, `resume`, `unblock`, and `remove` are operator control actions, not planner-only helpers.
- `run --once` is useful for deterministic supervisor ticks; long-running `run` must remain stoppable and observable.

The target CLI must not hide objective semantics inside a hard-coded default. Future `agi` commands should accept or resolve explicit mission/objective bindings and verifier policy rather than assuming a single initial build goal.

### JSONL observation

The supervisor observes session JSONL by byte offset. Observation must remain append-only and idempotent:

- persist `observedBytes` per monitored session;
- parse only new JSONL entries after the last observed byte;
- treat assistant `endTurn` messages as session progress;
- record `session.changed`, `session.turn_completed`, `session.error`, or `session.blocked` events with evidence payloads;
- preserve structured completion markers as claims, not proof.

Malformed JSONL lines may be ignored for parsing, but missing session files and repeated idle ticks are runtime state transitions. They should surface as `blockedReason` or `waitReason`, not disappear into logs.

### Action planning and driver

The supervisor tick is the runtime loop:

1. `observeSessions` reads JSONL deltas and updates completion/control state.
2. `planActions` consumes unprocessed events and queues follow-up actions when a session has ended a turn but is not complete.
3. `runPendingActions` executes queued actions and records results.

The current driver uses `launch --resume <sessionPath> --print <instruction>` to resume the same session with a follow-up instruction. That driver shape is acceptable as the boring default because it preserves the session transcript and uses the normal launch path. The target runtime must make the instruction source mission-aware: build it from the active objective, unsatisfied acceptance criteria, current verifier evidence, and operator policy. It must not bake in one global follow-up prompt or one global completion goal.

### Retry, wait, and block state

Runtime control must be represented durably:

- `waiting` means progress is expected, an action is queued/running, or a retry is scheduled;
- `blocked` means the gateway needs operator/runtime intervention, such as missing session JSONL, repeated idle ticks, or exhausted action retries;
- `paused` means the operator intentionally removed the session from automatic control;
- `completed` means the completion verifier and mission criteria agree, not that an agent self-reported success.

Action failures should increment retry/failure counters, schedule bounded exponential retries, and block after the retry cap. `unblock` may clear retry/block state but must not erase evidence or mark criteria satisfied.

### Structured marker and required default verifier

The structured marker is a self-report. It is useful for summarization and for listing agent-claimed criteria, but it is not completion authority.

Target behavior:

- every production `AgiSupervisor` must be constructed with a default `completionVerifier`;
- the default verifier must fail closed when no mission binding, criteria, changed files, command evidence, review evidence, or runtime telemetry can support the claim;
- verifier rejection must preserve `lastStructuredResult`, record rejection evidence, and keep the session incomplete;
- trusted completion must record the verifier id, criteria ids, evidence references, and checked time.

The current implementation keeps legacy claim-trusting behavior when no verifier is provided. That should remain only as an explicit test seam or compatibility mode, never as the default production path.

### Avoid hard-coded follow-up and goal semantics

The AGI Gateway must control arbitrary runtime objectives. Hard-coded strings like `initial AGI build goal`, global marker-only criteria, and fixed follow-up instructions are current implementation shortcuts. Target runtime semantics should resolve from a stored mission/objective record:

- objective text and acceptance criteria;
- mission/task/evidence references;
- allowed autonomy level and operator override policy;
- verifier policy and required evidence kinds;
- current unsatisfied criteria and next safe action.

## Current Evidence

- `packages/coding-agent/src/cli.ts:27-58`: the root CLI registers `agi` alongside `mission`, `objective`, `evolve`, and `proposals`, which makes AGI Gateway a first-class CLI command but not yet a unified runtime control plane.
- `packages/coding-agent/src/commands/agi.ts:3-19`: the command exposes `tui`, `status`, `events`, `actions`, `add`, `run`, `pause`, `resume`, `unblock`, and `remove` with `db`, `session`, `cwd`, `tick-ms`, and `once` flags. It has no goal, criteria, mission, verifier, or objective flag.
- `packages/coding-agent/src/cli/agi.ts:15-134`: non-TUI actions use `AgiGatewayStore` directly. `run` constructs `new AgiSupervisor({ store, tickMs })`, so no completion verifier is wired on this CLI path. `pause`, `resume`, and `unblock` update durable control state and print the resulting state.
- `packages/coding-agent/src/agi/tui.ts:15-57`: the TUI falls back to status text when stdio is not a TTY and renders session score/state/model/block/wait lines.
- `packages/coding-agent/src/agi/tui.ts:75-92`: the TUI creates an `AgiSupervisor` and starts it from `bindUi`; this path also omits `completionVerifier`.
- `packages/coding-agent/src/agi/supervisor.ts:21-29`: the code documents that structured markers are self-reports and that verifier-confirmed evidence should be required; the option remains optional and preserves legacy claim-trusting behavior when absent.
- `packages/coding-agent/src/agi/supervisor.ts:130-135`: one tick runs observation, planning, pending-action execution, then computes the overall score.
- `packages/coding-agent/src/agi/supervisor.ts:157-265`: observation stats the session file, blocks when missing, detects idle/wait/block states, parses JSONL deltas, demotes rejected completion claims when a verifier exists, updates completion state, and records events.
- `packages/coding-agent/src/agi/supervisor.ts:268-426`: planning consumes unprocessed `session.turn_completed` events, respects `nextRetryAt`, queues `follow_up_turn` actions, runs pending actions, and the CLI driver launches `launch --resume <sessionPath> --print <instruction>`.
- `packages/coding-agent/src/agi/supervisor.ts:476-590`: structured result extraction scans assistant text for the marker prefix and parses `score`, `complete`, `satisfiedCriteria`, and `summary`; completion scoring combines supervisor-owned and agent-owned criteria.
- `packages/coding-agent/src/agi/supervisor.ts:607-642`: action failure increments retry/failure counts, schedules exponential retry delay, and blocks after `MAX_ACTION_RETRIES`.
- `packages/coding-agent/src/agi/store.ts:53-70`: `AgiMonitoredSession` stores session path, cwd, state, score, observed bytes, goal spec, completion/control state, summary, error, and timestamps. It does not store `missionId`, objective text, or evidence refs.
- `packages/coding-agent/src/agi/store.ts:163-195`: the default goal spec is hard-coded around AGI Gateway monitoring and initial AGI build completion.
- `packages/coding-agent/src/agi/store.ts:536-614`: the SQLite schema has `agi_sessions`, `agi_events`, and `agi_actions`; it has no dedicated completion evidence table.
- `packages/coding-agent/test/cli/agi.test.ts:65-281`: tests cover non-TTY empty status, adding a session path, one supervisor tick reaching 100 with a structured marker, pause/resume/unblock/remove, event/action printing, and preferred model reporting. They do not cover verifier-required completion.

## Target TypeScript Sample: default verifier wiring

```ts
// Target TypeScript sample; not current implementation.
import { AgiGatewayStore } from "../agi/store";
import { AgiSupervisor, type AgiCompletionVerifier } from "../agi/supervisor";
import { AcceptanceVerifier, summarize } from "../mission/core/verifier";

export function createDefaultAgiCompletionVerifier(args: {
	missionStore: MissionStore;
	evidenceStore: MissionEvidenceStore;
	verifier?: AcceptanceVerifier;
}): AgiCompletionVerifier {
	const verifier = args.verifier ?? new AcceptanceVerifier();
	return async (session, claim) => {
		const missionId = session.missionId;
		if (!missionId) return false;

		const mission = await args.missionStore.getMission(missionId);
		if (!mission) return false;

		const evidence = await args.evidenceStore.listCompletionEvidence({
			missionId,
			sessionId: session.sessionId,
		});
		if (evidence.length === 0) return false;

		const verdict = await verifier.verify(mission.acceptanceCriteria, {
			cwd: session.cwd,
			changedFiles: evidence.flatMap(item => item.changedFiles ?? []),
			commandResults: evidence.flatMap(item => item.commandResults ?? []),
		});
		const summary = summarize(verdict, mission.acceptanceCriteria, "contract");

		return claim.complete === true && summary.verdict === "pass";
	};
}

export function createProductionAgiSupervisor(args: {
	store: AgiGatewayStore;
	missionStore: MissionStore;
	evidenceStore: MissionEvidenceStore;
	tickMs?: number;
}) {
	return new AgiSupervisor({
		store: args.store,
		tickMs: args.tickMs,
		completionVerifier: createDefaultAgiCompletionVerifier({
			missionStore: args.missionStore,
			evidenceStore: args.evidenceStore,
		}),
	});
}
```

## Target TypeScript Sample: completion evidence recording

```ts
// Target TypeScript sample; not current implementation.
interface AgiCompletionEvidenceInput {
	missionId: string;
	sessionId: string;
	claim: AgiStructuredResult;
	verifierId: string;
	verdict: "pass" | "fail" | "uncertain";
	criteriaIds: string[];
	evidenceRefs: string[];
	checkedAt: number;
	rejectionReason?: string;
}

export async function recordAgiCompletionEvidence(
	store: AgiGatewayStore,
	input: AgiCompletionEvidenceInput,
): Promise<void> {
	store.recordEvent(input.sessionId, "completion.verifier.checked", {
		missionId: input.missionId,
		verifierId: input.verifierId,
		verdict: input.verdict,
		criteriaIds: input.criteriaIds,
		evidenceRefs: input.evidenceRefs,
		checkedAt: input.checkedAt,
		claim: input.claim,
		...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
	});

	if (input.verdict !== "pass") return;

	store.recordEvent(input.sessionId, "completion.accepted", {
		missionId: input.missionId,
		criteriaIds: input.criteriaIds,
		evidenceRefs: input.evidenceRefs,
		checkedAt: input.checkedAt,
	});
}
```

## AGI runtime acceptance criteria

- Production CLI and TUI supervisor construction wires a default fail-closed `completionVerifier`; tests may inject a permissive verifier only explicitly.
- A structured `AGI_GATEWAY_RESULT` marker is recorded as self-report evidence and never completes a session without verifier acceptance.
- Completion evidence records include mission/objective binding, verifier id, criteria ids, evidence refs, verdict, checked time, and rejection reason when rejected.
- JSONL observation is byte-offset based, idempotent, and records durable events for changed, completed-turn, error, blocked, and verifier-checked states.
- Action planning queues follow-up work only from mission/objective-aware unsatisfied criteria and current evidence; no hard-coded global follow-up prompt or initial-build goal controls arbitrary sessions.
- The `launch --resume <sessionPath> --print <instruction>` driver remains the default execution mechanism unless a replacement preserves transcript continuity, cwd/model policy, output capture, and action result recording.
- Retry state is bounded and durable: failed actions schedule retry with `nextRetryAt`, block after the cap, and expose `blockedReason`; `unblock` clears control blockage but not historical evidence.
- CLI/TUI operator controls (`pause`, `resume`, `unblock`, `remove`) remain available and auditable for human runtime override.
- AGI Gateway docs and plans link to [04 Verification Gates](./04-verification-gates.md) for verifier semantics, [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md) for mission/session persistence, and [09 Governance Runtime Profile](./09-governance-runtime-profile.md) for oversight/stop/override policy.
