---
doc_id: mission-control-rag-12-tool-capability-safety
domain: mission-control.tool-capability-safety
retrieval_tags:
  - tool-capability-lease
  - runtime-policy-engine
  - permission-gateway
  - mutation-scope
  - proposal-integrity
  - sandbox-rollback
  - kill-switch
  - runtime-action-safety
source_evidence:
  - packages/coding-agent/src/tools/gateway/session-gateway.ts:24-166
  - packages/coding-agent/src/tools/gateway/permission-gate.ts:1-60
  - packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:23-98
  - packages/coding-agent/src/tools/gateway/tool-gateway.ts:170-260
  - packages/coding-agent/src/tools/registry/tool-descriptor.ts:59-125
  - packages/coding-agent/src/subagent/mutation-scope.ts:1-120
  - packages/coding-agent/src/task/worktree.ts:12-188
  - packages/coding-agent/src/config/settings-schema.ts:1865-1878
  - .amaze/config.yml:39-47
planner_uses:
  - Retrieve when planning tool execution, capability leases, runtime action authorization, mutation policy, proposal-gated changes, sandboxing, rollback, or AGI autonomous safety.
  - Use capability leases as the typed bridge from ObjectiveContract and Role Router policy to ToolExecutionContext and gateway decisions.
  - Require source/current separation: current code has gateway seams and scope guards; target samples define the desired lease model.
---

# Tool capability safety

Cross-references: [README](./README.md) defines the Mission Control retrieval protocol; [09 Governance Runtime Profile](./09-governance-runtime-profile.md) defines oversight and runtime profile policy; [10 Agency Kernel Architecture](./10-agency-kernel-architecture.md) defines the closed-loop agency kernel; [11 Objective Contract and Role Router](./11-objective-contract-role-router.md) defines role capabilities and mutation guards; [13 Runtime Event Ledger](./13-runtime-event-ledger.md) defines the append-only event record that should capture tool allow/deny/complete decisions.

This document is a target design. It does not claim the current repository already implements `CapabilityLease`, lease-scoped `ToolExecutionContext`, autonomous kill switches, or fully event-sourced tool authorization. Current-state claims are limited to the source evidence below.

## Spec

The target runtime must treat every tool call as a capability-bearing `RuntimeAction`, not as a free-form model request. A tool action may execute only when a valid capability lease authorizes the role, mission, plan step, tool, risk band, mutation surface, proposal identity, sandbox, and evidence contract.

The safety loop is:

```text
ObjectiveContract
  -> Mission
  -> Plan DAG step
  -> RuntimeAction
  -> CapabilityLease
  -> Gateway policy decision
  -> Tool execution or denial
  -> Evidence/event append
  -> Verification/replan/rollback/continue
```

Tool execution MUST be governed by these rules:

1. The planner/role-router mints a lease before an executable runtime action is queued.
2. The lease is narrow: one mission, one actor role, one action/step, bounded tools, bounded mutation paths, bounded risk, expiration, and budget.
3. Gateway execution validates the lease again immediately before tool dispatch.
4. Mutation tools require scope authorization and, when the mission intent requires it, an approved proposal with immutable artifact URI and content hash.
5. Denials are first-class outcomes. They become runtime events and evidence for replanning instead of disappearing as local errors.
6. Completion is never inferred from a successful tool call. Tool output is evidence only; verifier/evidence gates decide completion.

## Current source evidence

| Current seam | Repository evidence | What exists now | Gap to target safety model |
| --- | --- | --- | --- |
| Gateway-routed mutation tools | `packages/coding-agent/src/tools/gateway/session-gateway.ts:24-67` | `write`, `edit`, `ast_edit`, `bash`, and `github` are classified as seam-routed mutation tools with coarse domain/risk/rollback metadata. | There is no per-action capability lease tying the tool to ObjectiveContract, plan step, role, evidence requirement, and lease expiration. |
| Session gateway policy pipeline | `packages/coding-agent/src/tools/gateway/session-gateway.ts:95-166` | `SessionToolGateway` registers descriptors, configures `MissionPolicyGate`, `DefaultPermissionGate` or `AllowAllPermissionGate`, optional mutation-scope guard, and exposes `decide`/`settle`. | The gateway does not yet require a lease identity, emit a dedicated allow/deny runtime event with policy details, or bind denials to a replayable event ledger. |
| Permission mode | `packages/coding-agent/src/config/settings-schema.ts:1865-1878` | `tools.gateway.permissionMode` has `allow-all` and `enforce`; default is `allow-all`. `enforce` requires approval for high-risk seam tool execution. | AGI/autonomous runtime profiles should fail closed unless the effective policy is enforce/lease-backed; permissive defaults are legacy/interactive only. |
| Permission gate | `packages/coding-agent/src/tools/gateway/permission-gate.ts:1-60` | `DefaultPermissionGate` denies `HIGH`/`CRITICAL` or `requiresApproval` tools unless `ctx.approvalGranted`; `AllowAllPermissionGate` permits everything. | Approval is boolean and not yet a typed capability lease with approver, reason, scope, proposal hash, evidence refs, and expiration. |
| Mission policy gate | `packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:23-98` | Mutation tools require an active mission for subagents, allow the orchestrator, allow statically read-only bash, block proposal-required missions without approved proposal, and detect proposal artifact drift when `artifactUri` and `contentHash` exist. | Proposal artifact/hash checks are present for active proposal records but are not represented as a required lease field for every proposal-gated mutation. |
| Tool telemetry | `packages/coding-agent/src/tools/gateway/tool-gateway.ts:170-260` and `packages/coding-agent/src/tools/registry/tool-descriptor.ts:82-125` | The gateway emits `mission.tool.requested` when a mission context is present and allowed; it emits `mission.tool.completed` with `denied`, `ok`, or `error` status. | The emitted record is minimal and not yet a full runtime event with policy stage, risk, lease id, idempotency key, evidence refs, and replay semantics. |
| ToolExecutionContext | `packages/coding-agent/src/tools/registry/tool-descriptor.ts:59-95` | Current context includes `cwd`, abort signal, `toolCallId`, opaque session, mutation scope, `approvalGranted`, raw input, optional mission context, and `agentRole` of `orchestrator` or `subagent`. | Target `ToolExecutionContext` should include a lease or lease reference, role identity beyond two values, action id, plan step id, proposal identity, and sandbox/rollback metadata. |
| Mutation scope guard | `packages/coding-agent/src/subagent/mutation-scope.ts:94-119` | Mutations resolve paths under cwd, block paths outside cwd, then enforce SubagentContract scope first; if no contract exists, active Mission scope is canonical. | Target leases should reuse this precedence but make the allowed mutation surface explicit and immutable for each action. |
| Isolated worktree baseline/delta | `packages/coding-agent/src/task/worktree.ts:12-188` | Worktree code captures root/nested repo baselines and delta patches, including staged, unstaged, and untracked state. | The target runtime should require sandbox execution for risky/autonomous mutations and persist rollback/delta artifacts as evidence refs. |
| Continuation kill switch | `.amaze/config.yml:39-47` | Mission auto-approval is false and continuation is disabled after an ambiently-promoted misclassified mission caused runaway continuation. | Target runtime needs a first-class kill-switch layer that can pause/stop leases, continuation, and queued tool actions across the kernel. |

## Capability lease model

A capability lease is the executable authority for one action. It is not a prompt instruction. It is data checked by the runtime and gateway.

A lease MUST contain:

| Field | Required purpose |
| --- | --- |
| `leaseId` | Stable lease identity for audit and idempotency. |
| `missionId` | MissionStore mission this action belongs to. |
| `objectiveContractId` | Source goal contract that authorized the mission/action. |
| `planId` / `planStepId` | Plan DAG location; prevents detached tool calls. |
| `actionId` | RuntimeAction identity; used for event correlation and duplicate suppression. |
| `actorRole` | Runtime role selected by the Role Router. |
| `allowedTools` | Exact tool names or tool classes authorized by the plan. |
| `allowedRisk` | Maximum risk level allowed without escalation. |
| `mutationScope` | Included/denied paths, systems, services, data classes, and remote resources. |
| `budget` | Tool calls, retries, timeout, spend, and token/work budgets. |
| `proposal` | Required artifact URI/hash/approval identity when mutation is proposal-gated. |
| `approval` | Human or policy approval identity for interactive/autonomous risk gates. |
| `sandbox` | Isolation mode, worktree/session identity, baseline refs, rollback refs. |
| `evidenceContract` | Evidence refs and event types that must be appended before verifier use. |
| `expiresAt` | Absolute expiration; stale leases fail closed. |
| `revokedAt` | Optional kill-switch revocation time/reason. |

Lease validation happens twice: when the runtime queues a `RuntimeAction`, and again inside the gateway immediately before dispatch. A lease that was valid at planning time may be invalid at execution time because the mission changed, proposal hash drifted, budget was exhausted, a user paused the mission, or a kill switch revoked autonomous authority.

## Policy matrix

| Action mode | Examples | Required authority | Mutations | Human oversight | Event/evidence requirement |
| --- | --- | --- | --- | --- | --- |
| `dry-run` | Plan preview, schema validation, read-only analysis, proposed diff generation without apply | Mission or ObjectiveContract binding; read-only capability lease | No workspace or remote mutation. May create non-authoritative evidence artifacts only. | Operator-visible output; no approval needed unless external data policy requires it. | Append `tool.requested`/`tool.completed` or `tool.denied`; mark evidence as dry-run/non-authoritative. |
| `interactive` | User-triggered edit, approved shell command, manual proposal application | Lease plus explicit approval for `HIGH`/`CRITICAL` risk or proposal-required mutation | Allowed only within lease mutation scope and active mission/proposal policy. | User can approve, reject, pause, stop, override. | Append policy decision, proposal identity, artifact hash, rollback refs, tool result refs. |
| `autonomous` | Kernel-selected next action after verifier gap, continuation turn action | Lease minted from ObjectiveContract, plan step, role router, governance profile, budget, and active mission state | Allowed only in sandboxed/rollback-capable scope unless explicitly approved; no ambient auto mission mutation. | Kill switch, pause/stop, policy override, and visible evidence are mandatory. | Append all allow/deny/complete events with idempotency key; verifier must consume evidence before completion. |

## Role-based mutation limits

The Role Router from [11 Objective Contract and Role Router](./11-objective-contract-role-router.md) should become lease input. Default mutation limits:

| Role | Default lease capability | Mutation limit |
| --- | --- | --- |
| `Planner` | Read mission state, write plans/contracts/runtime actions. | No source or infrastructure mutation. |
| `Researcher` | Read external sources, write cited research evidence. | No repository, memory, or infrastructure mutation except research artifact records. |
| `Builder` | Edit repository files and run scoped checks. | Only paths/tools declared by the lease, contract, and mission scope. |
| `Reviewer` | Read diffs, write findings. | Cannot edit implementation being reviewed. |
| `Verifier` | Run declared verification commands, write verifier records. | Cannot change product code or criteria to make checks pass. |
| `MemoryCurator` | Promote verified claims. | Memory/world-model records only, after verifier acceptance. |
| `SRE` | Runtime/ops validation and approved operations. | Infrastructure changes require explicit operator approval and environment-scoped lease. |
| `Security` | Assess and block unsafe action. | Read-only by default; remediation routes to Builder unless separately leased. |
| `orchestrator` | Coordinate policy and approvals. | May approve or mint leases, but still must preserve mission/proposal/kill-switch constraints. |
| `subagent` | Execute assigned contract. | Must not mutate without active mission plus contract/mission scope; current code already gates this through `MissionPolicyGate` and mutation scope. |

## Proposal artifact and hash requirement

Proposal-gated mutations MUST carry immutable proposal identity in the lease:

- `proposalId`
- `artifactUri`
- `contentHash`
- `approvedBy`
- `approvedAt`
- `rollbackRefs`
- `evidenceRefs`

A proposal-required action must be denied when the proposal is absent, not approved, has missing artifact identity, has a mismatched content hash, has stale approval relative to the artifact hash, or has no rollback evidence. The current mission policy gate already blocks missing/unapproved proposal records and checks artifact drift when `artifactUri` and `contentHash` exist; the target model makes those fields mandatory for lease authorization.

## Sandbox, rollback, and kill-switch layers

Safety is layered. A failure in one layer must fail closed rather than falling through to prompt-level self-policing.

1. **Objective/mission layer:** action must belong to an explicit ObjectiveContract and Mission; ambient auto-promoted missions must not receive autonomous mutation authority.
2. **Role layer:** actor role must match the plan step and allowed capability.
3. **Lease layer:** lease scope, tool, risk, budget, proposal, sandbox, and expiration must pass.
4. **Gateway layer:** `MissionPolicyGate`, `PermissionGate`, mutation guard, timeout policy, and tool descriptor risk classification must pass immediately before dispatch.
5. **Sandbox layer:** risky/autonomous mutation runs in isolated worktree/session when possible; baseline and delta artifacts are recorded.
6. **Rollback layer:** rollback refs are required for high-risk workspace changes and proposal applications; non-rollbackable tools require stricter approval or dry-run only.
7. **Kill-switch layer:** operator pause/stop, revoked lease, disabled continuation, budget cap, no-progress cap, or governance hold cancels queued autonomous actions and prevents new leases.
8. **Event/evidence layer:** every allow, deny, complete, rollback, and kill-switch transition becomes an append-only event for replay and verification.

## Target TypeScript Sample: CapabilityLease

This is target/source sample code, not an existing implementation.

```ts
type RuntimeActionMode = "dry-run" | "interactive" | "autonomous";
type RuntimeRole =
	| "Planner"
	| "Researcher"
	| "Builder"
	| "Reviewer"
	| "Verifier"
	| "Critic"
	| "MemoryCurator"
	| "SRE"
	| "Security"
	| "orchestrator"
	| "subagent";

type ToolRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ProposalLeaseIdentity {
	proposalId: string;
	artifactUri: string;
	contentHash: string;
	approvedBy: string;
	approvedAt: number;
	rollbackRefs: string[];
	evidenceRefs: string[];
}

export interface CapabilityLease {
	leaseId: string;
	missionId: string;
	objectiveContractId: string;
	planId: string;
	planStepId: string;
	actionId: string;
	mode: RuntimeActionMode;
	actorRole: RuntimeRole;
	allowedTools: string[];
	allowedRisk: ToolRiskLevel;
	mutationScope: {
		allowedPaths: string[];
		deniedPaths: string[];
		allowedServices: string[];
		allowedDataClasses: string[];
	};
	budget: {
		maxToolCalls: number;
		maxRetries: number;
		timeoutMs: number;
	};
	proposal?: ProposalLeaseIdentity;
	approval?: {
		approvalId: string;
		approvedBy: string;
		approvedAt: number;
		reason: string;
	};
	sandbox: {
		mode: "none" | "isolated-worktree" | "remote-sandbox";
		baselineRef?: string;
		rollbackRefs: string[];
	};
	evidenceContract: {
		requiredEventTypes: Array<"tool.requested" | "tool.denied" | "tool.completed" | "rollback.completed">;
		requiredEvidenceRefs: string[];
	};
	issuedAt: number;
	expiresAt: number;
	revokedAt?: number;
	revokedReason?: string;
}

export interface LeasedToolExecutionContext extends ToolExecutionContext {
	mission: ToolMissionContext;
	actionId: string;
	planStepId: string;
	lease: CapabilityLease;
}
```

## Target TypeScript Sample: lease authorization

This is target/source sample code, not an existing implementation.

```ts
const RISK_ORDER: Record<ToolRiskLevel, number> = {
	LOW: 0,
	MEDIUM: 1,
	HIGH: 2,
	CRITICAL: 3,
};

export function authorizeLease(args: {
	lease: CapabilityLease;
	tool: ToolDescriptor;
	input: unknown;
	mission: Mission;
	now: number;
	proposalRecord?: MissionProposal;
	computeArtifactHash(uri: string): string;
}): { allowed: true } | { allowed: false; code: string; reason: string } {
	const { lease, tool, mission, now } = args;
	if (lease.revokedAt) return { allowed: false, code: "LEASE_REVOKED", reason: lease.revokedReason ?? "lease revoked" };
	if (now > lease.expiresAt) return { allowed: false, code: "LEASE_EXPIRED", reason: "lease expired" };
	if (lease.missionId !== mission.id) return { allowed: false, code: "MISSION_MISMATCH", reason: "lease mission mismatch" };
	if (mission.mode === "auto" && lease.mode === "autonomous") {
		return { allowed: false, code: "AUTO_MISSION_NOT_AUTONOMOUS", reason: "ambient auto missions cannot mutate autonomously" };
	}
	if (!lease.allowedTools.includes(tool.name)) return { allowed: false, code: "TOOL_NOT_LEASED", reason: `tool ${tool.name} not authorized` };
	if (RISK_ORDER[tool.riskLevel] > RISK_ORDER[lease.allowedRisk]) {
		return { allowed: false, code: "RISK_EXCEEDS_LEASE", reason: `${tool.riskLevel} exceeds ${lease.allowedRisk}` };
	}
	if ((tool.riskLevel === "HIGH" || tool.riskLevel === "CRITICAL") && lease.mode !== "dry-run" && !lease.approval) {
		return { allowed: false, code: "APPROVAL_REQUIRED", reason: "high-risk tool requires approval identity" };
	}
	if (missionRequiresProposal(mission)) {
		const leased = lease.proposal;
		const stored = args.proposalRecord;
		if (!leased || !stored) return { allowed: false, code: "PROPOSAL_REQUIRED", reason: "proposal identity required" };
		if (stored.id !== leased.proposalId || stored.status !== "approved") {
			return { allowed: false, code: "PROPOSAL_NOT_APPROVED", reason: "proposal is not approved" };
		}
		if (args.computeArtifactHash(leased.artifactUri) !== leased.contentHash) {
			return { allowed: false, code: "PROPOSAL_ARTIFACT_DRIFT", reason: "proposal artifact hash mismatch" };
		}
		if (leased.rollbackRefs.length === 0) {
			return { allowed: false, code: "ROLLBACK_REQUIRED", reason: "proposal mutation lacks rollback refs" };
		}
	}
	return { allowed: true };
}
```

## Target TypeScript Sample: permission-gate decision

This is target/source sample code, not an existing implementation.

```ts
export class CapabilityLeasePermissionGate implements PermissionGate {
	constructor(private readonly deps: {
		missionStore: MissionStore;
		eventLedger: RuntimeEventLedger;
		now(): number;
		computeArtifactHash(uri: string): string;
	}) {}

	check(descriptor: ToolDescriptor, ctx: LeasedToolExecutionContext, riskLevel: ToolRiskLevel): PermissionDecision {
		const mission = this.deps.missionStore.getMission(ctx.lease.missionId);
		if (!mission) return { allowed: false, reason: "mission not found for capability lease" };

		const decision = authorizeLease({
			lease: ctx.lease,
			tool: { ...descriptor, riskLevel },
			input: ctx.input,
			mission,
			now: this.deps.now(),
			proposalRecord: ctx.lease.proposal
				? this.deps.missionStore.getProposal(ctx.lease.proposal.proposalId)
				: undefined,
			computeArtifactHash: this.deps.computeArtifactHash,
		});

		this.deps.eventLedger.append({
			missionId: ctx.lease.missionId,
			type: decision.allowed ? "tool.authorized" : "tool.denied",
			idempotencyKey: `policy:${ctx.lease.actionId}:${descriptor.name}:${ctx.toolCallId ?? ""}`,
			actor: { role: ctx.lease.actorRole },
			payload: {
				leaseId: ctx.lease.leaseId,
				actionId: ctx.lease.actionId,
				tool: descriptor.name,
				riskLevel,
				decision,
			},
			evidenceRefs: ctx.lease.evidenceContract.requiredEvidenceRefs,
		});

		return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
	}
}
```

## AGI runtime acceptance criteria

- AGI/autonomous runtime actions cannot execute a mutating tool without a valid capability lease bound to mission id, ObjectiveContract id, plan step id, action id, role, scope, risk, budget, and expiration.
- `dry-run`, `interactive`, and `autonomous` action modes have distinct policy behavior; autonomous mutation is denied for ambient auto-promoted missions.
- Role-based mutation limits are enforced at action creation and again at gateway execution; role mismatch is a policy denial.
- Proposal-required mutation is denied unless the lease carries approved proposal artifact URI, content hash, approval identity, rollback refs, and evidence refs, and the current artifact hash matches the leased hash.
- Tool allow, deny, complete, rollback, and kill-switch decisions append runtime events with lease id, action id, mission id, tool name, risk, and idempotency key.
- High-risk autonomous workspace mutation runs through sandbox/isolation where possible and records baseline, delta, and rollback refs before verifier use.
- Kill-switch or pause state revokes or blocks outstanding autonomous leases and prevents queued tool execution.
- Successful tool execution produces evidence only; mission completion still requires verifier/evidence-gated acceptance from Mission Control.
