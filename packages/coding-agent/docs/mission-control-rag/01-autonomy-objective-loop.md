---
doc_id: mission-control-rag-01-autonomy-objective-loop
domain: mission-control-rag/autonomy-objective-loop
retrieval_tags:
  - autonomy
  - objective-store
  - objective-scheduler
  - mission-runtime
  - continuation-policy
  - runaway-loop-prevention
source_evidence:
  - packages/coding-agent/src/autonomy/feature-flag.ts
  - packages/coding-agent/src/autonomy/store.ts
  - packages/coding-agent/src/autonomy/types.ts
  - .amaze/config.yml
  - packages/coding-agent/src/mission/continuation/policy.ts
planner_uses:
  - Plan ObjectiveStore to ObjectiveScheduler to MissionRuntime scheduling work.
  - Preserve explicit autonomy and continuation gates before adding recurring execution.
  - Require acceptance criteria that prove active objectives schedule and terminal/blocked objectives do not.
---

# Autonomy Objective Loop

Related index: [README.md](./README.md). Contracting handoff: [02-planner-contracting.md](./02-planner-contracting.md). Fresh external policy input: [06-researcher-recency-provenance.md](./06-researcher-recency-provenance.md).

## Spec

Mission Control autonomy should be a durable objective loop:

```text
ObjectiveStore -> ObjectiveScheduler -> MissionRuntime -> continuation policy -> next tick
```

The loop MUST schedule only explicit active objectives. It MUST respect the `autonomy.enabled` feature flag and the configured mission continuation defaults. It MUST treat continuation classification as a gate, not as an unconditional timer callback.

### ObjectiveStore

`ObjectiveStore` is the durable input queue. It owns objective identity, status, metric targets, budgets, guardrails, and objective event history. Scheduler code should query it, record scheduler decisions as events, and update status only through store methods.

### ObjectiveScheduler

`ObjectiveScheduler` should be a policy layer between the store and mission runtime. It should:

- list durable objectives;
- select objectives with `status === "active"`;
- skip objectives whose guardrails or budgets block automated scheduling;
- decide whether to create a mission, resume an existing mission, hold for human input, or do nothing;
- record every scheduling decision to `ObjectiveStore.recordEvent`.

The scheduler MUST NOT be hidden inside `setInterval` with no policy. Timer ticks are a transport; scheduling decisions are domain behavior.

### MissionRuntime

MissionRuntime should receive a concrete mission input derived from the objective title, metric targets, budgets, guardrails, and acceptance criteria. Mission execution should proceed through plan, contract, execute, verify, and continuation classification rather than writing directly to source from an objective tick.

### Continuation

Continuation must use the shared policy in `src/mission/continuation/policy.ts`. Terminal mission lifecycles are never auto-resumed. Pending user input holds. Missing requirements may continue only through an explicit continuation action.

## Current source evidence

- `packages/coding-agent/src/autonomy/feature-flag.ts:3-5` defines `AutonomySettings.get("autonomy.enabled")`.
- `packages/coding-agent/src/autonomy/feature-flag.ts:18-20` enables autonomy only when the setting is exactly `true`.
- `packages/coding-agent/src/autonomy/feature-flag.ts:22-46` currently starts a timer loop, increments `tickCount`, and only references the store; it does not schedule missions yet.
- `packages/coding-agent/src/autonomy/store.ts:32-150` implements `ObjectiveStore` with SQLite persistence, create/get/list/updateStatus/recordEvent/listEvents, and objective/objective_events tables.
- `packages/coding-agent/src/autonomy/types.ts:1-38` defines objective status, metric targets, budgets, guardrails, durable objective shape, objective events, and new objective input.
- `.amaze/config.yml:39-47` disables mission auto-approval and continuation by default and documents a prior runaway continuation loop caused by ambient mission promotion.
- `packages/coding-agent/src/mission/continuation/policy.ts:15-24` defines autonomy profiles and terminal lifecycles.
- `packages/coding-agent/src/mission/continuation/policy.ts:67-114` builds acceptance preflight from mission state.
- `packages/coding-agent/src/mission/continuation/policy.ts:116-127` defines continuation actions: none, observe-terminal, hold, continue, and block.
- `packages/coding-agent/src/mission/continuation/policy.ts:145-212` classifies continuation from pure data.

## Target TypeScript Sample: ObjectiveScheduler tick decision

This is target/source sample code, not an existing implementation.

```ts
import type { Objective, ObjectiveEvent } from "./types";
import type { ObjectiveStore } from "./store";
import type { MissionRuntime } from "../mission/core/mission-runtime.iface";
import type { ContinuationAction } from "../mission/continuation/policy";

interface ObjectiveSchedulerDeps {
	store: ObjectiveStore;
	missionRuntime: MissionRuntime;
	classifyContinuation(input: {
		missionId?: string;
		objectiveId: string;
	}): ContinuationAction;
	now(): number;
}

interface ObjectiveTickDecision {
	objectiveId: string;
	kind: "schedule-mission" | "resume-mission" | "hold" | "skip" | "block";
	reason: string;
	missionId?: string;
}

class ObjectiveScheduler {
	constructor(private readonly deps: ObjectiveSchedulerDeps) {}

	async tick(): Promise<ObjectiveTickDecision[]> {
		const objectives = this.deps.store.list();
		const decisions: ObjectiveTickDecision[] = [];

		for (const objective of objectives) {
			const decision = await this.decide(objective);
			this.recordDecision(decision);
			decisions.push(decision);
		}

		return decisions;
	}

	private async decide(objective: Objective): Promise<ObjectiveTickDecision> {
		if (objective.status !== "active") {
			return { objectiveId: objective.id, kind: "skip", reason: `objective is ${objective.status}` };
		}

		if (objective.guardrails.requireHumanForApply) {
			return { objectiveId: objective.id, kind: "hold", reason: "guardrail requires human approval before apply" };
		}

		const action = this.deps.classifyContinuation({ objectiveId: objective.id });
		if (action.kind === "block") {
			return { objectiveId: objective.id, kind: "block", reason: action.reason };
		}
		if (action.kind === "hold") {
			return { objectiveId: objective.id, kind: "hold", reason: action.reason };
		}
		if (action.kind === "continue") {
			return { objectiveId: objective.id, kind: "resume-mission", reason: action.reason };
		}

		const mission = await this.deps.missionRuntime.create({
			title: objective.title,
			objective: objective.title,
			mode: "auto",
			constraints: [
				`Objective budget: ${JSON.stringify(objective.budget)}`,
				`Objective guardrails: ${JSON.stringify(objective.guardrails)}`,
			],
			acceptanceCriteria: objective.metricTargets.map(target => ({
				id: `${objective.id}-${target.metric}`,
				description: `${target.metric} moves ${target.direction} to ${target.target}`,
				satisfied: false,
			})),
		});

		return {
			objectiveId: objective.id,
			missionId: mission.id,
			kind: "schedule-mission",
			reason: "active objective has no resumable mission",
		};
	}

	private recordDecision(decision: ObjectiveTickDecision): ObjectiveEvent {
		return this.deps.store.recordEvent(decision.objectiveId, "scheduler.decision", {
			kind: decision.kind,
			reason: decision.reason,
			missionId: decision.missionId,
			ts: this.deps.now(),
		});
	}
}
```

## Mission Control acceptance criteria

- Autonomy loop returns a no-op handle when `autonomy.enabled` is not exactly `true`.
- Scheduler lists durable objectives through `ObjectiveStore.list()` and never schedules paused, completed, or cancelled objectives.
- Scheduler records a durable event for every tick decision.
- Scheduler converts active objectives into explicit mission creation or continuation decisions; it does not mutate source code directly.
- Scheduler respects objective guardrails and budgets in mission constraints or holds.
- Continuation decisions are derived from `classifyContinuation`, including terminal, hold, continue, and block paths.
- Tests or QA scenarios cover disabled autonomy, active scheduling, non-active skip, guardrail hold, and blocked continuation.
