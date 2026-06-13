---
doc_id: mission-control-rag-14-memory-world-model-self-improvement
domain: mission-control.memory-world-model-self-improvement
retrieval_tags:
  - memory-hierarchy
  - world-model
  - world-claim-graph
  - agi-memory
  - gbrain-provider
  - procedural-memory
  - self-improvement-loop
  - proposal-eval-review-rollback
source_evidence:
  - packages/coding-agent/src/mission/store.ts:258-365
  - packages/coding-agent/src/cognition/world-model.ts:1-73
  - packages/coding-agent/src/cognition/learner.ts:1-152
  - packages/coding-agent/src/cognition/index.ts:152-171
  - packages/coding-agent/src/learning/loop.ts:1-134
  - packages/coding-agent/src/learning/eval/pipeline.ts:1-135
  - packages/coding-agent/src/learning/apply/index.ts:1-223
  - packages/coding-agent/src/tools/agency-brain.ts:90-139
  - packages/coding-agent/src/tools/agency-brain.ts:219-263
  - packages/coding-agent/src/mission/continuation/policy.ts:179-211
  - packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:58-95
planner_uses:
  - Retrieve when planning memory, world-model, learned-heuristic, procedural-memory, or self-improvement work.
  - Use to separate authoritative MissionStore memory from optional external providers such as GBrain.
  - Require proposal, eval, review, rollback, and human-approval gates before any self-modification changes runtime behavior.
---

# Memory, World Model, and Self-Improvement

Cross-references: start from [README](./README.md); use [04 Verification Gates](./04-verification-gates.md) for completion authority; use [06 Researcher Recency Provenance](./06-researcher-recency-provenance.md) for external/current facts; use [10 Agency Kernel Architecture](./10-agency-kernel-architecture.md) for the closed runtime loop; use [11 Objective Contract Role Router](./11-objective-contract-role-router.md) for contract-scoped roles and capabilities; use [12 Tool Capability Safety](./12-tool-capability-safety.md) for policy/action event capture; use [13 Runtime Event Ledger](./13-runtime-event-ledger.md) for replayable runtime history; use [15 AGI Eval Suite](./15-agi-eval-suite.md) for substrate-level acceptance.

This document is a target design. It does not claim the repository already implements an `AgiMemory` abstraction, L0-L6 memory hierarchy, `WorldClaim` graph, GBrain-backed memory provider, procedural memory promotion, or self-modifying runtime end to end. Current-state claims are limited to the source evidence table below.

## Spec

Mission Control memory must support the target loop:

```text
User Goal -> Objective Contract -> Mission -> Plan DAG -> Tool Actions -> Evidence -> Verification -> Replan / Learn / Continue -> Completion
```

Memory is not completion authority. Memory supplies context, hypotheses, learned heuristics, and procedural candidates; verification and evidence gates decide completion. A retrieved memory item may influence planning only when its provenance, scope, freshness, and confidence are explicit.

### Memory hierarchy L0-L6

| Level | Name | Target contents | Authority | Retention and write rule |
| --- | --- | --- | --- | --- |
| L0 | Turn context | Current prompt, tool outputs, transient observations, active IRC/subagent replies. | Never authoritative after the turn. | Ephemeral; may be summarized into evidence only when source refs are attached. |
| L1 | Mission working memory | Active Objective Contract, mission state, plan revision, pending tasks, local observations, current verifier gaps. | Mission-scoped authority when persisted in MissionStore. | Stored against mission/task/action/event ids; expired or superseded when mission plan revises. |
| L2 | Evidence memory | Tool results, command outputs, citations, browser traces, file diffs, task evidence refs, verifier traces. | Verification input, not verdict by itself. | Immutable or content-addressed; every claim derived from it cites evidence refs. |
| L3 | World-model claim graph | `WorldClaim` nodes about repo state, external facts, task outcomes, hazards, and causal links. | Planning context only unless a verifier has confirmed the claim. | Append-only revisions with supersedes/contradicts links; stale claims are filtered, not silently trusted. |
| L4 | Procedural memory | Reusable plan patterns, role-routing heuristics, task templates, tool recipes, known failure mitigations. | Proposal input; never directly self-applied. | Promoted only after replay/eval/review and rollback snapshot. |
| L5 | Global learned heuristics | Cross-mission lessons from verified terminal outcomes. | Planning hints with confidence, not rules of law. | Recorded only from terminal evidence-backed outcomes; duplicate/superseded heuristics are controlled. |
| L6 | External/provider memory | GBrain, client pod memory, docs, web, vendor knowledge bases, or other MCP-backed stores. | Optional context provider, not source of truth. | Imported through scoped adapters with source id, timestamp, citation, and provider diagnostics. |

MissionStore should own authoritative mission memory: active objective, plan, tasks, acceptance criteria, evidence refs, world-model claims, budgets, scope guards, and proposals. Provider memory such as GBrain can enrich context but must not override MissionStore state or verifier decisions.

### WorldClaim graph

A `WorldClaim` is a typed, provenance-rich assertion. It must be graph-addressable so planning can reason about evidence, contradiction, supersession, and causal influence.

Required graph links:

- `supports`: evidence or prior claim supports this claim.
- `contradicts`: current claim conflicts with another claim and should force revalidation.
- `supersedes`: newer claim replaces an older one without deleting history.
- `derived_from`: learner/planner transformed an evidence source into this claim.
- `caused`: action/outcome causality used by replanning and self-improvement.
- `blocks`: claim identifies a prerequisite or hazard that blocks continuation.

The planner should rank claims by verified outcome, failure/blocking outcome, recency, confidence, and scope match. It must mark external/provider claims as unverified until corroborated by source evidence or verifier output.

### AgiMemory adapters

`AgiMemory` should be a narrow adapter interface over memory providers. It should normalize reads/writes into `MemoryItem` and `WorldClaim` records without leaking provider semantics into Mission Control.

Adapter requirements:

1. Every item has a stable id, level, scope, source refs, confidence, freshness metadata, and optional expiry.
2. Writes that affect mission authority go to MissionStore first; external providers may receive projections only after MissionStore write success.
3. Provider reads are scoped by mission/objective/client source id and bounded by retrieval tags.
4. Provider failures degrade to missing context, not hidden authority transfer.
5. Imported external claims enter L6 until promoted by evidence-backed verification.

GBrain is one optional L6 provider. The existing `agency_brain_registry` and `agency_brain_query` tools are scoped wrappers around configured GBrain MCP tools. They must remain provider adapters: useful for agency/client context, never the authority for mission completion, plan truth, acceptance criteria, or self-modification approval.

### Procedural memory

Procedural memory stores how to work, not whether a mission is complete. Examples:

- plan decomposition shapes that repeatedly passed verification;
- role-router patterns for Researcher/Builder/Reviewer split;
- tool-policy recipes that avoid denied actions;
- prerequisite checks that prevent blocked missions;
- rollback-safe self-improvement procedures.

Procedural memory must be created from evidence-backed outcomes and evaluated before promotion. A clean success may reinforce a pattern; a failure or blocked outcome may create a warning pattern. Procedural items should carry applicability predicates so the planner does not overgeneralize one mission into unrelated objectives.

### Self-improvement loop

Self-improvement is a gated runtime capability, not an agent preference. The target loop is:

1. Observe terminal mission outcomes, verifier decisions, task checkpoints, event windows, and tool-policy outcomes.
2. Analyze for repeated failures, uncertainty, blocked prerequisites, successful decompositions, or safety improvements.
3. Draft a proposal with type, artifact URI, content hash, scope, expected impact, regression commands, rollback plan, and human approval requirement.
4. Evaluate the proposal through provenance, contradiction, replay, sandbox/regression, and safety gates.
5. Review the proposal using the role/router policy; high-risk or behavior-changing changes require human approval.
6. Apply only approved proposals with snapshot/rollback metadata.
7. Monitor post-apply outcomes and roll back if evals regress, policy denies required actions, or verifier confidence falls.
8. Learn from the result only after terminal evidence and verifier output exist.

Self-modification policy must fail closed. No memory, rule, setting, skill, code, planner prompt, role capability, or runtime policy may be promoted solely because an agent says it helped.

## Current source evidence

| Current seam | Repository evidence | What exists now | Gap to target design |
| --- | --- | --- | --- |
| Mission world-model table | `packages/coding-agent/src/mission/store.ts:258-271` | `mission_world_model` stores `kind`, `source`, `source_id`, `claim`, `evidence_refs_json`, `links_json`, `outcome_status`, `verified`, and timestamps per mission. | The schema is a strong L3 seed, but it is not yet a typed `WorldClaim` graph with link kinds, contradiction/supersession semantics, expiry, freshness, or provider levels. |
| Mission plans/tasks/criteria/proposals | `packages/coding-agent/src/mission/store.ts:274-365` | MissionStore persists tasks, plan revisions, plan steps with edges, acceptance criteria with evidence refs, budgets, scope guards, and proposals with artifact URI/content hash/status/approval fields. | Memory should bind all learned/procedural claims to these authoritative records and reject provider memory as a competing source of truth. |
| World-model planning context | `packages/coding-agent/src/cognition/world-model.ts:14-35` | `worldModelForPlanning` ranks verified pass outcomes first, then failed/blocked outcomes, then verified/unverified claims, and formats bounded claims for prompt injection. | Ranking should become graph-aware and scope/freshness-aware; prompt injection should preserve source refs and verification state. |
| Planner/learner world-model writes | `packages/coding-agent/src/cognition/world-model.ts:38-73` | Planner decomposition and learned outcomes can be recorded back as mission world-model records with evidence refs. | Target should use typed claim nodes and explicit action/outcome/procedure categories. |
| Outcome learner | `packages/coding-agent/src/cognition/learner.ts:1-152` | Learner derives conservative heuristics from terminal snapshots, cites mission/checkpoint refs, stores global-scope knowledge, skips duplicate active claims, and exposes heuristics for planning. | This is an L5 heuristic path, not a full memory hierarchy or procedural memory promotion system. |
| Terminal learning seam | `packages/coding-agent/src/cognition/index.ts:152-171` | `learnFromTerminalMission` builds a snapshot from mission id/objective/outcome/verification/checkpoints and delegates to the learner only when an outcome exists. | Target must require verifier/evidence-gated terminal outcomes before learning or self-improvement. |
| Self-improvement proposal loop | `packages/coding-agent/src/learning/loop.ts:1-134` | `runObjectiveLoopOnce` evaluates rules over events, creates deduplicated proposals, optionally auto-evaluates auto-gated proposals, and keeps one bad rule/finding/eval from aborting the pass. | Current loop is proposal generation/eval orchestration; target needs mission-bound review, human approval, apply, rollback, and post-apply monitoring as one policy. |
| Proposal eval pipeline | `packages/coding-agent/src/learning/eval/pipeline.ts:19-45` | Evaluation computes a patch hash, gates provenance, contradiction, replay, and optional sandbox regression before reporting pass/fail. | Target AGI self-improvement should require named eval specs, datasets, metrics, human calibration where semantic, and governance oversight for risky changes. |
| Apply and rollback | `packages/coding-agent/src/learning/apply/index.ts:48-99` | Applying requires approved status, rejects missing/failing/stale sandbox when regression commands exist, writes snapshots, marks applied, and can restore snapshots during rollback. | Target should connect these mechanics to MissionStore proposals, runtime event ledger records, and human approval policy. |
| Proposal gate for mutation | `packages/coding-agent/src/tools/gateway/mission-policy-gate.ts:58-95` | Proposal-required mission intents block mutation until an approved proposal exists and artifact hash has not drifted. | Target self-modification policy should use this as the mandatory gate for behavior-changing memory/procedural/runtime updates. |
| Continuation proposal hold | `packages/coding-agent/src/mission/continuation/policy.ts:179-181` | Continuation holds when a mutation-gated mission needs proposal approval. | Target continuous self-improvement must preserve this user/human approval stop. |
| GBrain wrapper | `packages/coding-agent/src/tools/agency-brain.ts:90-139` and `packages/coding-agent/src/tools/agency-brain.ts:219-263` | Agency brain tools exist only when `agencyBrain.enabled`; registry/query wrap configured GBrain MCP tools and resolve scoped source ids from settings. | This is an optional L6 provider seam, not authoritative MissionStore memory. |

## Target TypeScript Sample: `MemoryItem` and `AgiMemory`

This is target/source sample code, not an existing implementation.

```ts
export type MemoryLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export interface MemorySourceRef {
	kind: "mission" | "task" | "tool" | "evidence" | "verifier" | "proposal" | "provider" | "human";
	uri: string;
	contentHash?: string;
	observedAt?: number;
}

export interface MemoryItem<T = unknown> {
	id: string;
	level: MemoryLevel;
	scope: { missionId?: string; objectiveId?: string; workspace?: string; providerSourceId?: string };
	kind: "observation" | "evidence" | "claim" | "heuristic" | "procedure" | "provider-context";
	content: T;
	sourceRefs: MemorySourceRef[];
	confidence: "low" | "medium" | "high";
	verified: boolean;
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
	supersedes?: string[];
}

export interface AgiMemory {
	query(input: {
		levels: MemoryLevel[];
		scope: MemoryItem["scope"];
		tags?: string[];
		claimLike?: string;
		limit: number;
	}): Promise<MemoryItem[]>;

	record(item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): Promise<MemoryItem>;

	linkClaims(input: {
		fromClaimId: string;
		toClaimId: string;
		relation: WorldClaimLink["relation"];
		evidenceRefs: MemorySourceRef[];
	}): Promise<void>;
}
```

## Target TypeScript Sample: `WorldClaim`

This is target/source sample code, not an existing implementation.

```ts
export interface WorldClaim {
	id: string;
	missionId?: string;
	objectiveId?: string;
	kind: "repo_state" | "external_fact" | "action" | "outcome" | "hazard" | "procedure";
	claim: string;
	status: "unverified" | "verified" | "contradicted" | "superseded" | "expired";
	outcomeStatus?: "pass" | "fail" | "blocked" | "uncertain";
	confidence: "low" | "medium" | "high";
	sourceRefs: MemorySourceRef[];
	provider?: { name: "mission-store" | "gbrain" | "web" | "manual"; sourceId?: string };
	createdAt: number;
	verifiedAt?: number;
	expiresAt?: number;
}

export interface WorldClaimLink {
	id: string;
	fromClaimId: string;
	toClaimId: string;
	relation: "supports" | "contradicts" | "supersedes" | "derived_from" | "caused" | "blocks";
	evidenceRefs: MemorySourceRef[];
	createdAt: number;
}

export function isPlanningEligible(claim: WorldClaim, now: number): boolean {
	if (claim.status === "superseded" || claim.status === "expired") return false;
	if (claim.expiresAt !== undefined && claim.expiresAt <= now) return false;
	return claim.sourceRefs.length > 0;
}
```

## Target TypeScript Sample: `SelfModificationPolicy`

This is target/source sample code, not an existing implementation.

```ts
export type SelfModificationKind = "memory" | "procedure" | "rule" | "skill" | "settings" | "planner" | "tool-policy";

export interface SelfModificationProposal {
	id: string;
	missionId: string;
	kind: SelfModificationKind;
	artifactUri: string;
	contentHash: string;
	expectedImpact: string;
	sourceEvidenceRefs: MemorySourceRef[];
	regressionCommands: string[];
	rollbackPlan: { snapshotRef?: string; instructions: string };
	risk: "low" | "medium" | "high" | "critical";
}

export interface SelfModificationPolicy {
	requiresHumanApproval(proposal: SelfModificationProposal): boolean;
	requiresSandbox(proposal: SelfModificationProposal): boolean;
	canApply(input: {
		proposal: SelfModificationProposal;
		approvedBy?: string;
		evalReport?: { passed: boolean; patchHash: string; stage: string };
		currentArtifactHash: string;
	}): { allowed: true } | { allowed: false; reason: string };
}

export const defaultSelfModificationPolicy: SelfModificationPolicy = {
	requiresHumanApproval: proposal => proposal.risk !== "low" || proposal.kind !== "memory",
	requiresSandbox: proposal => proposal.regressionCommands.length > 0 || proposal.kind !== "memory",
	canApply: ({ proposal, approvedBy, evalReport, currentArtifactHash }) => {
		if (currentArtifactHash !== proposal.contentHash) return { allowed: false, reason: "proposal-artifact-drift" };
		if (defaultSelfModificationPolicy.requiresHumanApproval(proposal) && !approvedBy) {
			return { allowed: false, reason: "human-approval-required" };
		}
		if (defaultSelfModificationPolicy.requiresSandbox(proposal) && !evalReport?.passed) {
			return { allowed: false, reason: "eval-or-sandbox-required" };
		}
		if (evalReport && evalReport.patchHash !== proposal.contentHash) {
			return { allowed: false, reason: "stale-eval" };
		}
		return { allowed: true };
	},
};
```

## AGI runtime acceptance criteria

- Memory retrieval distinguishes L0-L6 and never treats L6 provider output as MissionStore authority.
- MissionStore remains the authoritative store for mission objective, plan, tasks, acceptance criteria, evidence refs, world-model claims, proposals, and completion state.
- Every `WorldClaim` has source refs; claims without evidence refs are excluded from verifier input and marked low-confidence planning context at most.
- Claim graph links represent support, contradiction, supersession, derivation, causality, and blocking prerequisites.
- Planner context ranks verified outcomes and failures above unverified context, while preserving provenance and freshness.
- GBrain imports are scoped by configured source id and recorded as optional provider context; GBrain cannot approve completion, overwrite criteria, or bypass verification.
- Procedural memory promotion requires proposal artifacts, eval results, rollback plan, and review/human approval according to risk.
- Self-improvement apply rejects missing approval, missing/failing/stale evals, artifact drift, and missing rollback snapshots for behavior-changing changes.
- Rollback is tested or documented before promotion and can restore the previous settings/rule/skill/procedure state.
- Learning runs only from terminal, verifier/evidence-backed mission outcomes; self-report-only outcomes cannot create L4/L5 memory.
