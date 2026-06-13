---
doc_id: mission-control-rag-10-agency-kernel-architecture
domain: mission-control.agency-kernel-architecture
retrieval_tags:
  - agency-kernel
  - agi-runtime-v1
  - closed-loop-runtime
  - objective-contract
  - mission-plan-dag
  - runtime-event-sourcing
  - mission-store-source-of-truth
  - agi-gateway-execution-projection
  - replanner
  - completion-verifier
source_evidence:
  - packages/coding-agent/src/agi/supervisor.ts:71-135
  - packages/coding-agent/src/agi/store.ts:53-70
  - packages/coding-agent/src/agi/store.ts:163-195
  - packages/coding-agent/src/mission/core/mission-control-runtime.ts:58-110
  - packages/coding-agent/src/mission/store.ts:258-365
  - packages/coding-agent/src/mission/core/mission-runtime.ts:921-1001
  - packages/coding-agent/src/cognition/index.ts:58-82
  - packages/coding-agent/src/cognition/index.ts:152-171
  - packages/coding-agent/src/autonomy/store.ts:32-150
  - packages/coding-agent/src/tools/gateway/session-gateway.ts:95-166
  - packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:23-98
  - .amaze/config.yml:1-10
planner_uses:
  - Retrieve when planning the stateful agency kernel, AGI Runtime v1, supervisor-to-mission cutover, event sourcing, or runtime module boundaries.
  - Use MissionStore as the durable source of truth and AgiGatewayStore only as a gateway execution projection.
  - Require target/current separation: source evidence describes today's seams; target TypeScript samples describe the desired architecture.
---

# Agency kernel architecture

Cross-references: start from [README](./README.md) for the Mission Control retrieval protocol; use [07 AGI Gateway Supervisor](./07-agi-gateway-supervisor.md) for current gateway loop behavior; use [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md) for session-to-mission binding and evidence refs; use [09 Governance Runtime Profile](./09-governance-runtime-profile.md) for runtime policy and oversight; use [13 Runtime Event Ledger](./13-runtime-event-ledger.md) when available for the dedicated event-ledger schema and replay rules.

This document is a target design. It does not claim the current repository already implements `AgiKernel`, runtime event sourcing, mission-bound AGI sessions, or verifier-authoritative AGI completion end to end. Current-state claims are limited to the source evidence table below.

## Spec

### AGI Runtime v1 definition

AGI Runtime v1 is a stateful agency kernel that turns a user goal into a durable, verified mission lifecycle:

```text
User Goal
  -> Objective Contract
  -> Mission
  -> Plan DAG
  -> Tool Actions
  -> Evidence
  -> Verification
  -> Replan / Learn / Continue
  -> Completion
```

The runtime is not a prompt, a self-report marker, or a detached supervisor. It is a closed loop with durable identity, policy-gated actions, evidence capture, verifier authority, and learning from terminal mission outcomes.

AGI Runtime v1 MUST:

1. Convert each durable user goal into an Objective Contract with explicit objective text, acceptance criteria, constraints, budget, guardrails, and source provenance.
2. Bind the Objective Contract to exactly one active MissionStore mission for that durable objective.
3. Persist the MissionPlan DAG and all executable task/action records against the mission.
4. Execute tools only through policy-aware runtime gates.
5. Append evidence for observations, tool requests, tool results, verifier decisions, replans, and learning events.
6. Treat completion as a verifier decision over objective criteria and evidence, not an agent self-report.
7. Replan when evidence invalidates the plan, gates fail, dependencies change, or acceptance criteria remain unsatisfied.
8. Learn only from terminal, evidence-backed mission outcomes.

### Closed loop

The target loop is one kernel tick over durable state:

1. `ObjectiveScheduler` selects eligible Objective Contracts and continuation candidates.
2. `MissionBinder` creates or loads the authoritative MissionStore mission and binds any gateway sessions/actions to it.
3. `ActionPlanner` calls cognition planning to create or revise a Plan DAG from objective text, constraints, world-model evidence, and prior plan state.
4. `RuntimePolicyEngine` evaluates mission lifecycle, role, proposal, continuation, budget, scope, and tool permission gates.
5. `ActionExecutor` dispatches tool actions or subagent tasks through the gateway seam.
6. `EvidenceCollector` records observations, tool outcomes, task results, world-model claims, verifier evidence refs, and event-log entries.
7. `CompletionVerifier` evaluates mission acceptance criteria and lifecycle gates.
8. `Replanner` decides whether to continue the plan, revise the DAG, learn from a terminal outcome, pause, block, or complete.

The loop MUST be idempotent. Re-running a tick after crash/restart must derive the same next action from MissionStore state plus the runtime event ledger, not from transient process memory.

### AgiKernel modules

| Module | Target responsibility | Durable read model | Durable write model |
| --- | --- | --- | --- |
| `ObjectiveScheduler` | Select active objectives and explicit continuation candidates; enforce disabled/paused/terminal states before runtime work. | ObjectiveStore objectives/events; MissionStore lifecycle and continuation state. | Runtime events for scheduling decisions; mission continuation decisions when applicable. |
| `MissionBinder` | Ensure every autonomous unit of work has a mission identity and objective contract; bridge AGI sessions to missions. | Objective Contract, active mission, AgiGatewayStore projection. | MissionStore mission rows, acceptance criteria, mission/session binding events. |
| `ActionPlanner` | Produce or revise the Plan DAG from objective, constraints, world model, prior plan, and verifier gaps. | MissionStore mission, plan, world model, task attempts, prior verifier output. | MissionStore plan/steps/tasks plus `plan.created` or `plan.revised` runtime events. |
| `ActionExecutor` | Execute tool actions and subagent tasks through policy-aware gateway seams. | Mission task/action queue, policy decision, gateway projection. | Tool action records, task attempts, evidence refs, action events. |
| `EvidenceCollector` | Normalize observations and action outputs into evidence refs and mission world-model claims. | Tool outputs, session observations, task results, verifier traces. | `mission_world_model`, acceptance evidence refs, runtime event payloads. |
| `CompletionVerifier` | Decide pass/fail/pending against objective criteria and lifecycle gates. | Mission criteria, evidence refs, lifecycle, policy state, task statuses. | Verification events, criterion satisfaction, terminal lifecycle transitions. |
| `Replanner` | Decide continue/replan/block/learn/complete from verifier result and new evidence. | Plan DAG, unresolved criteria, failed actions, learned heuristics, budgets. | Plan revisions, block reasons, continuation records, learning inputs, terminal events. |
| `RuntimePolicyEngine` | Enforce governance profile, role authority, proposal gates, mutation scope, budget, and continuation policy. | Config, MissionStore lifecycle/proposals/scope, role context, tool descriptor. | Policy decision events and blocked/approved action decisions. |

### MissionStore source of truth

MissionStore is the source of truth for durable agency state:

- Objective Contract binding and mission identity.
- Full objective text and acceptance criteria.
- Plan DAG revisions and task decomposition.
- Mission tasks, tool-action evidence refs, and world-model claims.
- Scope guards, budgets, proposals, lifecycle, verifier output, and terminal outcomes.
- Learning inputs from verified terminal missions.

The AGI kernel MUST NOT make AgiGatewayStore the authority for objective, plan, criteria, evidence, or completion. If a value must survive restart, be used by a verifier, or drive continuation/replan decisions, it belongs in MissionStore or a MissionStore-owned event ledger.

### AgiGatewayStore execution projection

AgiGatewayStore is the execution projection for gateway-specific telemetry:

- monitored session path, observed byte offset, preferred model, title, driver state;
- pending/running/completed gateway actions;
- gateway observation events and retry/block state;
- denormalized mission id and criterion summaries for operator views.

The projection may cache mission-derived facts, but cache misses or stale projection state must be repaired from MissionStore. A gateway action that changes mission state must append MissionStore evidence/event records, then update the gateway projection.

### Runtime event sourcing

The target runtime event ledger records every state transition that matters for replay, audit, and planning context. Event sourcing is not a separate truth that competes with normalized MissionStore tables; it is the append-only history from which projections can be rebuilt and decisions can be audited.

Runtime events MUST:

- include `eventId`, `missionId`, optional `objectiveId`, optional `sessionId`, `type`, `occurredAt`, `actor`, `payload`, and `evidenceRefs`;
- be append-only and idempotent by stable idempotency keys for external observations and tool results;
- link policy decisions to the tool/action they allowed or denied;
- link verifier decisions to the evidence and criteria evaluated;
- link replan decisions to the previous plan revision and the new revision;
- never treat agent-authored completion text as terminal without verifier event authority.

## Current source evidence

| Current seam | Repository evidence | What exists now | Gap to target architecture |
| --- | --- | --- | --- |
| AGI supervisor tick | `packages/coding-agent/src/agi/supervisor.ts:71-135` | `AgiSupervisor.tick()` observes sessions, plans actions, runs pending actions, and returns score/action counts. | The loop is gateway-session oriented; it is not an `AgiKernel.tick()` over Objective Contract, MissionStore plan, event ledger, policy, evidence, verifier, replan, and learning modules. |
| AGI session record | `packages/coding-agent/src/agi/store.ts:53-70` | `AgiMonitoredSession` stores session path, cwd, title/model, state, score, observed bytes, goal spec, completion/control state, summaries/errors, timestamps. | The record lacks authoritative `missionId`, objective contract, mission acceptance criteria, plan revision, durable evidence refs, and event-log replay identity. |
| Default AGI goal | `packages/coding-agent/src/agi/store.ts:163-195` | `createDefaultAgiGoalSpec()` hard-codes criteria for gateway monitoring and the initial AGI build goal. | Runtime goals are not derived from user Objective Contracts or MissionStore criteria. |
| Mission creation/promotion | `packages/coding-agent/src/mission/core/mission-control-runtime.ts:58-110` | `ensureActiveMission()` can create an auto mission from turn content and drive initial lifecycle/proposal behavior. | Target `MissionBinder` must create/load missions from explicit Objective Contracts and avoid hidden goal inference as the authority for autonomous runtime work. |
| Mission durable artifacts | `packages/coding-agent/src/mission/store.ts:258-365` | MissionStore persists world-model claims, tasks, plans, plan steps, acceptance criteria, budgets, scope guards, and proposals. | These tables are close to the required source of truth, but runtime event sourcing and AGI session/action projections still need explicit mission-bound integration. |
| Mission completion gate | `packages/coding-agent/src/mission/core/mission-runtime.ts:921-1001` | Mission runtime has completion gate logic over task and acceptance state. | AGI Gateway completion must call this verifier/gate path by default instead of relying on gateway score or self-report markers. |
| Cognition planning | `packages/coding-agent/src/cognition/index.ts:58-82` | `planMission()` builds planning context from objective, constraints, heuristics, world model, and prior plan, then saves the plan. | Target `ActionPlanner` should make this the normal kernel planning path for mission-bound runtime ticks. |
| Learning seam | `packages/coding-agent/src/cognition/index.ts:152-171` | `learnFromTerminalMission()` converts terminal mission outcome snapshots into learning inputs. | Target `Replanner` should call learning only after verifier-backed terminal outcomes. |
| Objective store | `packages/coding-agent/src/autonomy/store.ts:32-150` | ObjectiveStore persists objectives with title, metric targets, budget, guardrails, status, and objective events. | Target Objective Contracts need explicit acceptance criteria/provenance and a binding to MissionStore missions. |
| Tool gateway | `packages/coding-agent/src/tools/gateway/session-gateway.ts:95-166` | `SessionToolGateway` routes mutation tools through policy gates, optional permission enforcement, and mission promotion retry. | Target `ActionExecutor`/`RuntimePolicyEngine` should route all kernel tool actions through this seam with mission-bound evidence events. |
| Mission policy gate | `packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:23-98` | Mutation tools require mission/proposal policy for non-orchestrator roles; read-only bash is specially allowed. | Target policy must additionally event-source allow/deny decisions and bind them to action/evidence records. |
| Role model routing | `.amaze/config.yml:1-10` | Local config declares role-to-model routing for planner, builder, reviewer, researcher, and arbiter roles. | Target runtime policy should preserve role boundaries as policy inputs; role routing is not itself completion authority. |

## Target TypeScript Sample: `AgiKernelOptions`

This is target/source sample code, not an existing implementation.

```ts
export interface AgiKernelOptions {
	clock?: () => number;
	objectiveStore: ObjectiveStore;
	missionStore: MissionStore;
	agiGatewayStore: AgiGatewayStore;
	planner: ActionPlanner;
	executor: ActionExecutor;
	evidence: EvidenceCollector;
	verifier: CompletionVerifier;
	replanner: Replanner;
	policy: RuntimePolicyEngine;
	learner?: MissionOutcomeLearner;
	idempotency: RuntimeIdempotencyStore;
	limits: {
		maxActionsPerTick: number;
		maxReplansPerMission: number;
		maxContinuationDepth: number;
	};
}

export interface ObjectiveContract {
	objectiveId: string;
	missionId?: string;
	text: string;
	criteria: Array<{
		id: string;
		description: string;
		verificationMethod: "deterministic" | "semantic" | "manual";
	}>;
	constraints: string[];
	guardrails: Record<string, unknown>;
	budget: Record<string, unknown>;
	provenance: Array<{ source: string; evidenceRef?: string }>;
}
```

## Target TypeScript Sample: `AgiKernel.tick`

This is target/source sample code, not an existing implementation.

```ts
export class AgiKernel {
	constructor(private readonly options: AgiKernelOptions) {}

	async tick(input: { objectiveId?: string; missionId?: string; once?: boolean } = {}): Promise<AgiKernelTickResult> {
		const scheduled = await this.options.policy.withRuntimeLease("agi-kernel.tick", async () => {
			return new ObjectiveScheduler(this.options.objectiveStore, this.options.missionStore).select(input);
		});

		let actionsExecuted = 0;
		const outcomes: RuntimeEvent[] = [];

		for (const objective of scheduled.objectives) {
			const binding = await new MissionBinder(this.options.missionStore, this.options.agiGatewayStore).bind(objective);
			outcomes.push(binding.event);

			const plan = await this.options.planner.ensurePlan({
				missionId: binding.missionId,
				objective: binding.contract.text,
				criteria: binding.contract.criteria,
			});
			outcomes.push(plan.event);

			const nextActions = await this.options.replanner.selectExecutableActions({
				missionId: binding.missionId,
				planRevision: plan.revision,
				limit: this.options.limits.maxActionsPerTick - actionsExecuted,
			});

			for (const action of nextActions) {
				const decision = await this.options.policy.decideAction({ missionId: binding.missionId, action });
				outcomes.push(decision.event);
				if (!decision.allowed) continue;

				const result = await this.options.executor.execute(action);
				actionsExecuted += 1;

				const evidence = await this.options.evidence.collect({
					missionId: binding.missionId,
					action,
					result,
				});
				outcomes.push(result.event, evidence.event);
			}

			const verification = await this.options.verifier.verify({ missionId: binding.missionId });
			outcomes.push(verification.event);

			const next = await this.options.replanner.afterVerification({
				missionId: binding.missionId,
				verification,
			});
			outcomes.push(next.event);
		}

		return { scheduled: scheduled.objectives.length, actionsExecuted, events: outcomes };
	}
}
```

## Target TypeScript Sample: `RuntimeEvent`

This is target/source sample code, not an existing implementation. The canonical event schema lives in [13 Runtime Event Ledger](./13-runtime-event-ledger.md); keep this local sample byte-for-byte compatible with that schema when changing event fields.

```ts
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

## Milestones tied to this architecture

| Milestone | Architecture slice | Required result | Evidence of completion |
| --- | --- | --- | --- |
| M1: Objective Contract and mission binding | `ObjectiveScheduler` + `MissionBinder` | New autonomous AGI work starts from explicit Objective Contract data and binds to one MissionStore mission. | Objective, criteria, mission id, and binding event survive restart; gateway projection can be rebuilt from MissionStore. |
| M2: MissionStore authority cutover | MissionStore source of truth | Objective text, criteria, plans, tasks, budgets, scope, proposals, evidence, verifier state, and completion live in MissionStore-owned records. | AgiGatewayStore no longer contains authoritative goal/completion data; it stores only execution projection fields and mission ids. |
| M3: Event ledger | Runtime event sourcing | Kernel appends typed runtime events for scheduling, binding, plan, policy, action, evidence, verification, replan, learning, and completion. | Replay reconstructs gateway projections and explains every allow/deny/complete decision. |
| M4: Planner path | `ActionPlanner` | Mission-bound kernel ticks use cognition `planMission` semantics and persist Plan DAG revisions before dispatch. | Plan steps and edges are stored before tool/subagent execution; replans produce new revisions linked to prior revisions. |
| M5: Policy-gated execution | `RuntimePolicyEngine` + `ActionExecutor` | Every mutation/tool action passes role, mission, proposal, scope, budget, permission, and continuation gates. | Policy events link decisions to action ids; denied actions do not execute. |
| M6: Evidence and verifier authority | `EvidenceCollector` + `CompletionVerifier` | Completion decisions are verifier events over mission criteria and evidence refs. | Agent self-report can be evidence, but only verifier pass can transition mission to completed. |
| M7: Replan/learn/continue | `Replanner` + learner seam | Failed/pending verification produces replan/block/continue decisions; learning runs only after terminal verified outcomes. | Terminal mission snapshots include objective, outcome, verifier verdict, and checkpoints. |

## AGI runtime acceptance criteria

- A user goal can be represented as an Objective Contract with explicit objective text, criteria, constraints, guardrails, budget, and provenance.
- Starting or resuming autonomous runtime work creates or loads exactly one MissionStore mission for the durable objective.
- MissionStore, not AgiGatewayStore, is the source of truth for objective text, acceptance criteria, Plan DAG, task/action state, evidence refs, verification, lifecycle, and completion.
- AgiGatewayStore remains an execution projection for session observation, driver state, pending actions, retry/block status, and operator display.
- `AgiKernel.tick()` is idempotent across restart and derives next work from MissionStore plus runtime event history.
- Every runtime decision that affects work scheduling, policy, tool execution, evidence, verification, replan, learning, or completion appends a typed `RuntimeEvent`.
- All tool actions pass through `RuntimePolicyEngine` before execution and write allow/deny evidence tied to mission/action ids.
- Evidence from sessions, tool outputs, subagent results, and verifier traces is recorded as mission-addressable evidence refs.
- Completion requires `CompletionVerifier` pass over mission acceptance criteria and evidence; self-report markers alone cannot complete a mission.
- Failed or pending verification produces a `Replanner` decision: revise plan, continue allowed work, block with reason, or terminate failed.
- Learning is triggered only for terminal mission outcomes with verifier and evidence context.
- Cross-doc retrieval for implementation planning includes README plus docs 07, 08, 09, and 13 before modifying runtime kernel, gateway, persistence, policy, or event-ledger seams.
