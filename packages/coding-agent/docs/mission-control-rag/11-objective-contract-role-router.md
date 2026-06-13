---
doc_id: mission-control-rag-11-objective-contract-role-router
domain: mission-control.objective-contract-role-router
retrieval_tags:
  - objective-contract
  - role-router
  - multi-agent-runtime
  - agi-cli
  - mission-derived-goal
  - runtime-action
  - acceptance-evidence
  - budget-scope-autonomy
source_evidence:
  - .amaze/config.yml:1-10
  - packages/coding-agent/src/commands/agi.ts:3-19
  - packages/coding-agent/src/cli/agi.ts:46-62
  - packages/coding-agent/src/agi/store.ts:163-195
  - packages/coding-agent/src/cognition/index.ts:58-82
planner_uses:
  - Retrieve when compiling a natural-language goal into a durable ObjectiveContract before mission creation.
  - Use to route plan steps to typed runtime roles with explicit mutation capabilities and evidence requirements.
  - Use when adding AGI and mission CLI surfaces for objective files, mission-derived goals, runtime doctor checks, or role-router diagnostics.
---

# Objective Contract and Role Router

Cross-references: [README](./README.md) defines the retrieval entrypoint; [02 Planner Contracting](./02-planner-contracting.md) covers MissionPlan DAG and SubagentContract synthesis; [06 Researcher Recency Provenance](./06-researcher-recency-provenance.md) defines external-fact provenance; [07 AGI Gateway Supervisor](./07-agi-gateway-supervisor.md) covers AGI runtime control; [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md) covers mission-bound AGI sessions and evidence refs; [10 Agency Kernel Architecture](./10-agency-kernel-architecture.md) defines the stateful agency kernel this document feeds.

## Spec

The target runtime must compile every operator goal into an `ObjectiveContract` before autonomous mission execution. The contract is the durable boundary between natural language intent and executable agency work:

```text
natural language goal -> ObjectiveContract -> Mission -> Plan DAG -> RuntimeAction -> Evidence -> Verification -> Replan/Learn/Continue -> Completion
```

The ObjectiveContract compiler must extract and normalize:

1. objective text and non-goals;
2. acceptance criteria and required evidence kinds;
3. scope guard, allowed mutation surfaces, and forbidden paths/actions;
4. budget guard for tool calls, model spend, wall-clock/run limits, and retry caps;
5. autonomy mode: `manual`, `supervised`, `autonomous`, or `continuous`;
6. risk profile and required human approvals;
7. freshness policy for current/external facts;
8. role routing hints for Planner, Researcher, Builder, Reviewer, Verifier, Critic, MemoryCurator, SRE, and Security;
9. completion authority and replan/learn/continue policy.

The Mission runtime must use the ObjectiveContract, not a title or a hard-coded AGI default, as the source of goal semantics. Mission creation must persist the contract or a content-addressed reference to it. Plan steps must become typed `RuntimeAction` records before execution so the gateway can enforce role, tool, scope, evidence, and verification policy uniformly.

## Current source evidence

- `.amaze/config.yml:1-10`: local model routing maps `Planner`, `Builder`, `Researcher`, `Reviewer`, `SRE`, `Explore`, `Designer`, and other roles to model profiles. This is current role configuration evidence, but it is not yet a runtime role router with mutation capabilities.
- `packages/coding-agent/src/commands/agi.ts:3-19`: AGI command actions are `tui`, `status`, `events`, `actions`, `add`, `run`, `pause`, `resume`, `unblock`, and `remove`; flags are limited to `db`, `session`, `cwd`, `tick-ms`, and `once`. There is no `--objective`, `--mission`, objective file, role-router, verifier, or doctor surface in this command definition.
- `packages/coding-agent/src/cli/agi.ts:46-62`: `agi add` attaches a resolved session using session metadata only, and `agi run` constructs `new AgiSupervisor({ store, tickMs })`. The current path does not compile an ObjectiveContract, attach a mission-derived goal spec, or pass a role-router policy into the supervisor.
- `packages/coding-agent/src/agi/store.ts:163-195`: `createDefaultAgiGoalSpec()` returns fixed criteria for gateway monitoring, completed assistant turn detection, follow-up execution, bounded context confirmation, and `initial_build_goal_complete`. This hard-coded default must be replaced for new mission-bound AGI runs by a goal spec derived from the ObjectiveContract and Mission.
- `packages/coding-agent/src/cognition/index.ts:58-82`: `planMission` builds `PlanningContext` from objective, constraints, heuristics, world model, and prior plan, calls `decomposeGoal`, saves the plan, and records plan metadata. This is the current planner seam where ObjectiveContract fields should enter planning context and where role-router hints can be preserved for plan-step conversion.

## ObjectiveContract model

The contract should be a typed, persisted value. It must be generated before mission creation for natural-language goals, and it must be loadable from an explicit file for deterministic CLI use.

Required contract fields:

| Field | Purpose | Verification use |
| --- | --- | --- |
| `id` | Stable contract identity. | Bind Mission, Plan DAG, RuntimeAction, Evidence, and Verification rows to one goal source. |
| `objective` | Full natural-language goal. | Prevent title-only or default-goal execution. |
| `nonGoals` | Explicit exclusions. | Fail steps that expand scope silently. |
| `acceptanceCriteria` | Measurable success conditions. | Completion verifier checks every required criterion. |
| `requiredEvidence` | Required proof per criterion. | Verifier rejects self-report-only completion. |
| `scopeGuard` | Include/exclude paths, systems, commands, and data boundaries. | Role router and tool gateway enforce mutation bounds. |
| `budgetGuard` | Tool/model/retry/runtime ceilings. | Supervisor blocks or escalates before runaway execution. |
| `autonomyMode` | Degree of allowed continuation. | Runtime decides whether to ask, continue, or pause. |
| `risk` | Safety/security/operational risk level. | Adds Reviewer, Security, SRE, or human approval gates. |
| `freshnessPolicy` | External fact recency expectations. | Forces Researcher when repository evidence is insufficient. |
| `rolePolicy` | Role capabilities and routing preferences. | Converts plan steps to allowed RuntimeActions. |

The natural-language compiler may use an LLM, but its output must be validated as data. Invalid or ambiguous contracts must fail closed before mission creation unless the operator explicitly supplies the missing field.

## Acceptance criteria and required evidence

Acceptance criteria must be atomic and evidence-addressable. Each criterion should declare:

- `id`: stable key used by plans, RuntimeActions, and verifier records;
- `description`: human-readable condition;
- `evidenceKinds`: allowed proof types such as `source_diff`, `test_output`, `review_finding`, `browser_trace`, `runtime_metric`, `citation`, `deployment_health`, or `security_scan`;
- `required`: whether completion is blocked without it;
- `ownerRole`: default role responsible for producing or validating evidence;
- `verification`: deterministic command, semantic verifier, human approval, or hybrid.

Self-reported agent summaries are evidence candidates only. Completion requires evidence refs that satisfy the contract and the mission verifier policy described in [07 AGI Gateway Supervisor](./07-agi-gateway-supervisor.md) and [08 AGI Mission Persistence Bridge](./08-agi-mission-persistence-bridge.md).

## Scope guard, budget guard, and autonomy mode

The Role Router must enforce contract guards before creating a RuntimeAction:

- `scopeGuard.include` and `scopeGuard.exclude` constrain file paths, services, SaaS APIs, deployment targets, secrets, and data classes.
- `scopeGuard.mutation` declares whether a role may read, write docs, edit code, run tests, operate infrastructure, or approve completion.
- `budgetGuard` caps model classes, tool call classes, retries, parallelism, run duration, and external spend.
- `autonomyMode: manual` requires operator approval before execution; `supervised` allows bounded execution with approval gates; `autonomous` allows contract-scoped execution; `continuous` allows replan/learn/continue only under explicit continuation policy.

A RuntimeAction that exceeds scope or budget must not be queued. It should become a blocked action with diagnostic evidence for `agi doctor objective` or `agi doctor role-router`.

## Mission-derived AGI goal spec

New AGI runs must derive their `AgiGoalSpec` from a Mission or ObjectiveContract. The hard-coded default from `createDefaultAgiGoalSpec()` remains only a legacy/test fallback. For mission-bound sessions, the goal spec must include:

- objective text from `ObjectiveContract.objective` or the bound Mission objective;
- criteria mapped from contract acceptance criteria;
- required evidence refs and verifier policy;
- autonomy mode and continuation policy;
- role router policy for follow-up RuntimeActions.

This makes `agi run --objective` and `agi run --mission` arbitrary goal runners instead of controllers for one initial AGI build goal.

## Plan step to RuntimeAction

A plan step should not directly become a free-form prompt. The runtime should transform each validated plan step into a `RuntimeAction`:

1. preserve `missionId`, `objectiveContractId`, `planId`, `stepId`, and dependency edges;
2. select a role through the Role Router;
3. attach mutation capability, allowed tools, scope guard, and budget guard;
4. attach acceptance criteria and required evidence refs;
5. run only when dependencies and approvals are satisfied;
6. write evidence and status transitions back to MissionStore/AGI store;
7. trigger verification, replan, learning, or continuation after action completion.

## Role Router and mutation capabilities

The current `.amaze/config.yml` proves named model-role routing exists. The target Role Router must add executable policy around those names.

| Role | Default purpose | Mutation capability |
| --- | --- | --- |
| `Planner` | Compile ObjectiveContract into MissionPlan DAG and replan from critic/verifier feedback. | May write plan/contract records; must not mutate source files or infrastructure. |
| `Researcher` | Produce dated external facts and citations before planning or verification. | Read-only; may create research evidence artifacts; no repository or infrastructure mutation. |
| `Builder` | Implement contract-scoped repository changes. | May mutate allowed files and run scoped checks; no approval authority for its own completion. |
| `Reviewer` | Review diffs for correctness, maintainability, and regression risk. | Read-only over code; may write review findings/evidence; cannot edit implementation. |
| `Verifier` | Evaluate acceptance criteria and evidence sufficiency. | May run declared verification commands and write verifier records; cannot change product code to make checks pass. |
| `Critic` | Identify plan gaps, contradictions, missing evidence, and replan triggers. | Read-only over mission state/evidence; may write critic findings. |
| `MemoryCurator` | Promote verified evidence into memory/world-model claims and retire stale claims. | May mutate memory/knowledge records only after verifier acceptance. |
| `SRE` | Validate runtime/deployment/operations state when the contract touches infrastructure. | May run approved operational read/write actions only under explicit scope and approval policy. |
| `Security` | Assess secrets, permissions, data exposure, supply-chain, and unsafe tool use. | Read-only by default; may block or require approval; security fixes route to Builder unless explicitly authorized. |

Role policy must be checked at action creation and again at tool-gateway execution. A role mismatch is a policy failure, not a prompt instruction for the agent to self-police.

## Command surface

Target CLI surface:

```text
amaze agi run --objective "<goal>" [--criteria <text>] [--mode supervised|autonomous] [--budget <profile>]
amaze agi run --objective-file objective.yml [--once]
amaze agi run --mission <mission-id> [--once]
amaze mission create --objective-file objective.yml [--autonomy supervised|autonomous]
amaze agi doctor objective --objective-file objective.yml
amaze agi doctor role-router [--mission <mission-id>]
amaze agi doctor mission --mission <mission-id>
```

Command behavior:

- `agi run --objective` compiles a natural-language goal into an ObjectiveContract, creates or attaches a Mission, derives `AgiGoalSpec`, starts the supervisor, and records evidence.
- `agi run --mission` loads the Mission's ObjectiveContract, derives the goal spec, and resumes mission-scoped runtime control.
- `mission create --objective-file` validates and persists the contract without starting AGI execution unless explicitly requested.
- Doctor commands validate objective shape, missing evidence requirements, role capability conflicts, unavailable model-role mappings, policy-gateway mismatches, and mission/session binding gaps.

## Target TypeScript Sample: ObjectiveContract compiler

This is target/source sample code, not an existing implementation.

```ts
type AutonomyMode = "manual" | "supervised" | "autonomous" | "continuous";
type EvidenceKind =
	| "source_diff"
	| "test_output"
	| "review_finding"
	| "browser_trace"
	| "runtime_metric"
	| "citation"
	| "deployment_health"
	| "security_scan";

type RuntimeRole =
	| "Planner"
	| "Researcher"
	| "Builder"
	| "Reviewer"
	| "Verifier"
	| "Critic"
	| "MemoryCurator"
	| "SRE"
	| "Security";

interface ObjectiveCriterion {
	id: string;
	description: string;
	required: boolean;
	evidenceKinds: EvidenceKind[];
	ownerRole: RuntimeRole;
	verification: "deterministic" | "semantic" | "human" | "hybrid";
}

interface ObjectiveContract {
	id: string;
	objective: string;
	nonGoals: string[];
	acceptanceCriteria: ObjectiveCriterion[];
	requiredEvidence: Record<string, EvidenceKind[]>;
	scopeGuard: {
		include: string[];
		exclude: string[];
		allowedCommands: string[];
		forbiddenActions: string[];
	};
	budgetGuard: {
		maxRuntimeActions: number;
		maxRetriesPerAction: number;
		maxParallelActions: number;
		modelProfile?: string;
	};
	autonomyMode: AutonomyMode;
	risk: "low" | "medium" | "high" | "critical";
	freshnessPolicy?: {
		researchRequired: boolean;
		maxSourceAgeDays?: number;
	};
	rolePolicy: RolePolicy;
}

async function compileObjectiveContract(input: {
	goal: string;
	operatorCriteria?: string[];
	constraints?: string[];
	llm: ObjectiveCompilerModel;
}): Promise<ObjectiveContract> {
	const draft = await input.llm.compile({
		goal: input.goal,
		criteria: input.operatorCriteria ?? [],
		constraints: input.constraints ?? [],
	});
	return assertValidObjectiveContract(draft);
}
```

## Target TypeScript Sample: role router and RuntimeAction

This is target/source sample code, not an existing implementation.

```ts
interface RoleCapability {
	role: RuntimeRole;
	modelRole: string;
	canRead: boolean;
	canWriteRepository: boolean;
	canRunCommands: boolean;
	canOperateInfrastructure: boolean;
	canApproveCompletion: boolean;
	allowedTools: string[];
}

interface RolePolicy {
	capabilities: RoleCapability[];
	defaultRoleByStepKind: Record<string, RuntimeRole>;
	requireReviewerForRisk: Array<"high" | "critical">;
	requireSecurityFor: string[];
	requireSreFor: string[];
}

interface RuntimeAction {
	id: string;
	missionId: string;
	objectiveContractId: string;
	planId: string;
	stepId: string;
	role: RuntimeRole;
	instruction: string;
	dependencies: string[];
	scopeGuard: ObjectiveContract["scopeGuard"];
	budgetGuard: ObjectiveContract["budgetGuard"];
	acceptanceCriteria: ObjectiveCriterion[];
	requiredEvidence: EvidenceKind[];
	status: "queued" | "running" | "blocked" | "succeeded" | "failed" | "verified";
}

function routePlanStepToAction(args: {
	contract: ObjectiveContract;
	missionId: string;
	planId: string;
	step: ContractiblePlanStep;
	modelRoles: Record<string, string>;
}): RuntimeAction {
	const role = selectRuntimeRole(args.step, args.contract.rolePolicy);
	const capability = capabilityForRole(args.contract.rolePolicy, role);
	assertModelRoleConfigured(args.modelRoles, capability.modelRole);
	assertStepWithinScope(args.step, args.contract.scopeGuard);
	assertCapabilityAllowsStep(capability, args.step);

	return {
		id: `${args.missionId}:${args.step.id}`,
		missionId: args.missionId,
		objectiveContractId: args.contract.id,
		planId: args.planId,
		stepId: args.step.id,
		role,
		instruction: args.step.description,
		dependencies: args.step.dependsOn ?? [],
		scopeGuard: args.contract.scopeGuard,
		budgetGuard: args.contract.budgetGuard,
		acceptanceCriteria: criteriaForStep(args.contract, args.step),
		requiredEvidence: evidenceForStep(args.contract, args.step),
		status: "queued",
	};
}
```

## Target TypeScript Sample: mission-derived AGI goal spec

This is target/source sample code, not an existing implementation.

```ts
function createAgiGoalSpecFromObjective(contract: ObjectiveContract): AgiGoalSpec {
	return {
		version: 2,
		markerPrefix: "AGI_OBJECTIVE_RESULT",
		criteria: contract.acceptanceCriteria.map(criterion => ({
			id: criterion.id,
			description: criterion.description,
			source: criterion.ownerRole === "Verifier" ? "supervisor" : "agent",
			requiredEvidence: criterion.evidenceKinds,
		})),
		objectiveContractId: contract.id,
		objective: contract.objective,
		autonomyMode: contract.autonomyMode,
		completionAuthority: "mission-verifier",
	};
}

async function runAgiFromObjective(args: {
	goal: string;
	objectiveFile?: string;
	missionId?: string;
	mode?: AutonomyMode;
	store: AgiGatewayStore;
	missions: MissionStore;
	compiler: ObjectiveContractCompiler;
}) {
	const contract = args.objectiveFile
		? loadObjectiveContract(args.objectiveFile)
		: await args.compiler.compile({ goal: args.goal, mode: args.mode });
	const mission = args.missionId
		? args.missions.getMission(args.missionId)
		: args.missions.createMissionFromObjective(contract);

	return args.store.addSession({
		missionId: mission.id,
		objectiveContractId: contract.id,
		goalSpec: createAgiGoalSpecFromObjective(contract),
	});
}
```

## AGI runtime acceptance criteria

- `agi run --objective` compiles a natural-language goal into a validated ObjectiveContract and refuses execution when acceptance criteria, required evidence, scope guard, or autonomy mode are missing.
- `agi run --mission` loads mission-bound objective semantics and never falls back to the hard-coded `initial_build_goal_complete` default for new mission-bound runs.
- `mission create --objective-file` persists the ObjectiveContract or a stable reference and records the mission's objective separately from display title.
- `planMission` receives ObjectiveContract-derived constraints, evidence requirements, freshness policy, and role-routing hints before calling `decomposeGoal`.
- Every executable plan step is converted to a RuntimeAction with mission id, contract id, role, dependencies, scope guard, budget guard, acceptance criteria, and required evidence.
- Role Router refuses actions when the selected role lacks mutation capability, the model role is unconfigured, scope guard is violated, or required approval is absent.
- Researcher is required before planning when the contract freshness policy or acceptance criteria depend on current external facts.
- Reviewer, Security, SRE, and Verifier roles cannot be bypassed for high-risk, security-sensitive, infrastructure, or completion-authority criteria declared by the contract.
- Completion requires verifier-approved evidence refs for every required acceptance criterion; agent self-report markers alone are insufficient.
- Doctor commands identify malformed contracts, missing model-role mappings, unavailable evidence kinds, policy/tool mismatches, mission/session binding gaps, and legacy default-goal use.
