---
doc_id: mission-control-rag-02-planner-contracting
domain: mission-control-rag/planner-contracting
retrieval_tags:
  - planner
  - mission-plan
  - dag
  - contract-synthesis
  - subagent-contract
  - mission-task
source_evidence:
  - packages/coding-agent/src/cognition/planner.ts
  - packages/coding-agent/src/cognition/index.ts
  - packages/coding-agent/src/mission/core/mission-runtime.ts
  - packages/coding-agent/src/mission/core/mission-task.ts
  - packages/coding-agent/src/subagent/contract.ts
  - packages/coding-agent/src/mission/store.ts
planner_uses:
  - Use the default planner path before creating executable task contracts.
  - Extend MissionPlan steps with enough metadata to synthesize scoped contracts.
  - Keep mission tasks, subagent contracts, store persistence, and verifier criteria aligned.
---

# Planner Contracting

Related index: [README.md](./README.md). Objective scheduling input: [01-autonomy-objective-loop.md](./01-autonomy-objective-loop.md). Research freshness layer: [06-researcher-recency-provenance.md](./06-researcher-recency-provenance.md).

## Spec

Mission Control planning should follow this default path:

```text
mission objective -> PlanningContext -> decomposeGoal -> persisted MissionPlan DAG -> MissionRuntime.plan -> MissionTask -> SubagentContract -> verification
```

The planner must produce a DAG that can be persisted and converted to contracts without relying on free-form prompt convention. Each executable step needs enough structure for delegation: scope, agent role, success criteria, escalation behavior, expected outputs, and evidence requirements.

### Default planner path

1. Build `PlanningContext` from the mission objective, hard constraints, learned heuristics, world model claims, prior plan, and critic feedback.
2. Call `decomposeGoal` through the configured planner LLM seam.
3. Parse and validate planner output into `MissionPlan`.
4. Persist the plan with `MissionStore.savePlan`.
5. Let `MissionRuntimeImpl.plan` seed mission tasks from stored steps when no tasks exist.
6. Convert rich plan-step metadata into `MissionTask` fields and delegated `SubagentContract` records.
7. Verify subagent completion and mission acceptance before continuation.

### Plan-to-contract synthesis

A contract is not a copy of a plan description. It is the executable envelope for one worker:

- `missionId` and `taskId` bind the subagent to the mission/task.
- `role` selects the execution persona.
- `parentMissionRev` prevents stale work after parent mission mutation.
- `scope` and `parentMissionScope` bound file mutations.
- `successCriteria` make the worker output verifiable.
- `escalation` defines when the worker must stop instead of guessing.
- `inputArtifact` carries large shared context without inflating the prompt.
- `outputContract.mustProduce` declares required files or artifacts.

## Current source evidence

- `packages/coding-agent/src/cognition/planner.ts:26-39` defines `PlanningContext` with objective, constraints, heuristics, world model, critic feedback, and prior plan.
- `packages/coding-agent/src/cognition/planner.ts:41-51` defines the planner system prompt and JSON-only output shape.
- `packages/coding-agent/src/cognition/planner.ts:80-162` validates planner output, step count, typed edge kinds, dangling references, and cycles.
- `packages/coding-agent/src/cognition/planner.ts:202-229` decomposes a goal and retries once with validation errors.
- `packages/coding-agent/src/cognition/index.ts:33-82` builds planning context, injects heuristics/world-model state, persists the plan, and records plan action.
- `packages/coding-agent/src/mission/core/mission-runtime.ts:481-505` reads an existing mission plan, seeds `MissionTask` records from plan steps when tasks are empty, advances lifecycle to planning, and emits `mission.planned`.
- `packages/coding-agent/src/mission/core/mission-task.ts:40-76` defines task fields for mission binding, objective, assigned agent, scope, success criteria, escalation criteria, tools, status, plan step id, evidence refs, and output.
- `packages/coding-agent/src/subagent/contract.ts:30-111` defines mission-bound `SubagentContract` fields for role, revision freshness, scope, success criteria, escalation, input artifact, and output contract.
- `packages/coding-agent/src/subagent/contract.ts:274-281` stamps the parent mission revision onto contracts.
- `packages/coding-agent/src/subagent/contract.ts:318-349` binds contracts to mission context and enforces mission binding.
- `packages/coding-agent/src/subagent/contract.ts:386-399` verifies subagent completion against contract success criteria.
- `packages/coding-agent/src/mission/store.ts:1652-1698` persists and retrieves mission plans, replacing plan steps and storing typed edges JSON.

## Target TypeScript Sample: MissionPlan DAG extension

This is target/source sample code, not an existing implementation.

```ts
import type { AcceptanceCriterion } from "../mission/core/verifier";
import type { MissionPlan, MissionPlanStepEdge } from "../mission/core/mission";

type MissionAgentRole = "Builder" | "Researcher" | "Reviewer" | "SRE" | "Explore";

interface ContractiblePlanStep {
	id: string;
	description: string;
	edges?: MissionPlanStepEdge[];
	assignedAgent: MissionAgentRole;
	scope: {
		include: string[];
		exclude: string[];
	};
	successCriteria: AcceptanceCriterion[];
	escalationCriteria: string[];
	outputContract?: {
		mustProduce: string[];
	};
	inputArtifact?: string;
}

interface ContractibleMissionPlan extends MissionPlan {
	steps: ContractiblePlanStep[];
	revision: number;
}

function assertContractibleDag(plan: ContractibleMissionPlan): void {
	const ids = new Set(plan.steps.map(step => step.id));
	for (const step of plan.steps) {
		if (step.successCriteria.length === 0) {
			throw new Error(`Plan step ${step.id} has no success criteria`);
		}
		for (const edge of step.edges ?? []) {
			if (!ids.has(edge.target)) throw new Error(`Plan step ${step.id} references missing ${edge.target}`);
		}
	}
}
```

## Target TypeScript Sample: SubagentContract synthesis

This is target/source sample code, not an existing implementation.

```ts
import type { Mission } from "../mission/core/mission";
import type { MissionTask } from "../mission/core/mission-task";
import type { SubagentContract } from "../subagent/contract";
import { bindContractToMission, stampContractRevision } from "../subagent/contract";

function taskFromPlanStep(mission: Mission, step: ContractiblePlanStep): MissionTask {
	return {
		id: `${mission.id}-${step.id}`,
		missionId: mission.id,
		title: step.description,
		objective: step.description,
		assignedAgent: step.assignedAgent,
		scope: step.scope,
		successCriteria: step.successCriteria.map(criterion => criterion.description),
		escalationCriteria: step.escalationCriteria,
		status: "pending",
		planStepId: step.id,
		evidenceRefs: [],
	};
}

function contractFromTask(
	mission: Mission,
	task: MissionTask,
	step: ContractiblePlanStep,
): SubagentContract {
	const base: SubagentContract = {
		role: step.assignedAgent.toLowerCase(),
		scope: step.scope,
		parentMissionScope: mission.scopeGuard
			? { include: mission.scopeGuard.allowedPaths, exclude: mission.scopeGuard.deniedPaths }
			: undefined,
		successCriteria: step.successCriteria,
		escalation: {
			onUncertainty: "ask-parent",
			budgetCap: mission.budget.tokenBudget,
		},
		inputArtifact: step.inputArtifact,
		outputContract: step.outputContract,
	};

	const stamped = stampContractRevision(base, mission.revision);
	return bindContractToMission(stamped, { missionId: mission.id, taskId: task.id });
}
```

## Mission Control acceptance criteria

- Planner output is parsed and validated before persistence; invalid DAGs fail instead of silently degrading.
- Stored plans preserve typed step edges and revision/rationale metadata.
- `MissionRuntime.plan` seeds tasks from persisted plan steps only when tasks are empty.
- Contract synthesis maps every delegated step to mission-bound `MissionTask` and `SubagentContract` records.
- Contracts include narrowed scope, success criteria, escalation policy, and stale-revision stamping.
- Contract scope never exceeds mission scope.
- Builder tasks receive enough context to verify behavior without reading unrelated files.
- Verification checks subagent completion against contract criteria before mission continuation.
