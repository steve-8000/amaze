---
doc_id: mission-control-rag-index
domain: mission-control-rag/index
retrieval_tags:
  - mission-control
  - rag-index
  - planner-protocol
  - mission-plan-dag
  - subagent-contracts
  - verification-gates
  - memory-learning
  - researcher-provenance
  - agi-gateway
  - agency-kernel
  - objective-contract
  - runtime-event-ledger
  - capability-lease
  - eval-suite
  - tool-policy
  - cognition
source_evidence:
  - packages/coding-agent/src/cognition/planner.ts
  - packages/coding-agent/src/cognition/world-model.ts
  - packages/coding-agent/src/mission/core/mission-runtime.ts
  - packages/coding-agent/src/mission/core/mission-task-dispatcher.ts
  - packages/coding-agent/src/mission/core/verifier.ts
  - packages/coding-agent/src/subagent/contract.ts
  - packages/coding-agent/src/mission/continuation/policy.ts
  - packages/coding-agent/src/cli.ts
  - packages/coding-agent/src/commands/agi.ts
  - packages/coding-agent/src/cli/agi.ts
  - packages/coding-agent/src/agi/supervisor.ts
  - packages/coding-agent/src/agi/store.ts
  - packages/coding-agent/src/mission/store.ts
  - packages/coding-agent/src/config/settings-schema.ts
planner_uses:
  - Start every Mission Control planning pass by retrieving this index.
  - Select the domain docs whose retrieval tags match the objective, risk, and missing context.
  - Dispatch Researcher before planning when facts are current, external, or version-sensitive.
---

# Mission Control RAG Index

This directory is a retrieval index for Amaze Mission Control AGI-runtime development. It is not a product overview. It exists so a planner can retrieve the right domain context, synthesize a concrete `MissionPlan` DAG, mint scoped Builder/Researcher contracts, and require verification before continuation.

## Baseline and runtime target

Repository baseline checked on 2026-06-13: GitHub `main` was `20f0ce5f1f4c8efd2f3c88b901948b6ebac9edf2` (`20f0ce5`), commit message `Restore local gbrain integration`, committed 2026-06-13T03:27:16Z.

The runtime target is `AGI Gateway + Mission Control + Tool Policy + Cognition + Memory/Learning` as one closed loop. Mission Control docs are one layer of that runtime, not the whole target.

## Spec

Mission Control planning MUST use repository-grounded docs as the first context layer and Researcher output as the freshness layer. The planner MUST NOT rely on memory alone for source seams, runtime lifecycle behavior, or external API facts.

The default retrieval flow is:

1. Retrieve this index.
2. Retrieve all domain docs whose `retrieval_tags` match the mission objective.
3. Dispatch Researcher for latest/current/external facts before finalizing the plan.
4. Generate a MissionPlan DAG with typed dependency edges and verification intent.
5. Mint SubagentContract records from plan steps, narrowed by scope and success criteria.
6. Verify mission and subagent acceptance criteria before continuation or completion.

## Domain document map

| Domain doc | Retrieval tags | Source seams | Planner use | Builder acceptance focus | Researcher mandatory |
| --- | --- | --- | --- | --- | --- |
| [01-autonomy-objective-loop.md](./01-autonomy-objective-loop.md) | `autonomy`, `objective-store`, `objective-scheduler`, `mission-runtime`, `continuation-policy`, `runaway-loop-prevention` | `src/autonomy/feature-flag.ts`, `src/autonomy/store.ts`, `src/autonomy/types.ts`, `.amaze/config.yml`, `src/mission/continuation/policy.ts` | Convert durable objectives into schedulable mission ticks while respecting disabled continuation defaults. | Objective status filtering, guardrail enforcement, no ambient runaway loop, explicit continuation decision. | No, unless scheduling policy depends on external APIs or current model/runtime limits. |
| [02-planner-contracting.md](./02-planner-contracting.md) | `planner`, `mission-plan`, `dag`, `contract-synthesis`, `subagent-contract`, `mission-task` | `src/cognition/planner.ts`, `src/cognition/index.ts`, `src/mission/core/mission-runtime.ts`, `src/mission/core/mission-task.ts`, `src/subagent/contract.ts`, `src/mission/store.ts` | Decompose objectives into stored DAG plans and task contracts that Builders can execute independently. | Plan validation, persisted edges, scoped task fields, stale-contract protection, verifier-ready criteria. | No, unless the plan includes latest/current/external facts. |
| [03-execution-subagents-isolation.md](./03-execution-subagents-isolation.md) | `mission-task-dispatcher`, `mission-task-runner`, `subagent-contract`, `mutation-scope`, `isolated-worktree`, `evidence-refs` | `src/mission/core/mission-task-dispatcher.ts`, `src/task/mission-task-runner.ts`, `src/task/worktree.ts`, `src/subagent/mutation-scope.ts`, `src/tools/write.ts` | Wire executable Builder tasks from MissionPlan steps through bounded runners, isolation, mutation scope, and evidence. | Real runner factory injection, task evidence refs, scope enforcement before mutation, isolation patch/branch artifacts. | No, unless the execution tool/runtime behavior depends on external APIs or current host capabilities. |
| [04-verification-gates.md](./04-verification-gates.md) | `acceptance-verifier`, `verification-context`, `llm-judge`, `lifecycle-template`, `continuation-policy`, `risk-based-gates` | `src/mission/core/verifier.ts`, `src/mission/core/mission-runtime.ts`, `src/mission/continuation/policy.ts`, `src/mission/core/lifecycle-template.ts`, `src/mission/core/llm-judge.ts` | Select deterministic and semantic gates that become completion authority for missions and tasks. | Deterministic acceptance criteria, fail-closed uncertainty, shared completion/continuation preflight, review/regression gates. | Yes when verifier semantics depend on current model/provider/tool behavior; otherwise no. |
| [05-memory-learning-continuation.md](./05-memory-learning-continuation.md) | `world-model`, `knowledge-store`, `cognition-learner`, `learning-loop`, `proposal-eval`, `proposal-apply-rollback`, `mission-continuation` | `src/cognition/world-model.ts`, `src/cognition/learner.ts`, `src/memory/knowledge-store.ts`, `src/learning/loop.ts`, `src/learning/eval/pipeline.ts`, `src/learning/apply/index.ts`, `src/mission/continuation/runtime.ts`, `src/mission/store.ts` | Turn verified evidence into retrievable claims, evaluated learning proposals, rollback-safe promotion, and safe continuation decisions. | Sourced claims, provenance, stale/superseded filtering, proposal eval/apply/rollback, continuation caps and holds. | No for repo-local learning mechanics; yes for external eval methodology or current provider/tool claims. |
| [06-researcher-recency-provenance.md](./06-researcher-recency-provenance.md) | `researcher`, `recency`, `provenance`, `citations`, `external-facts`, `web-search`, `evaluations`, `governance`, `human-oversight`, `risk-management` | OpenAI web search docs, OpenAI Responses API, OpenAI eval best practices, LangGraph agent/workflow docs, EU AI Act Article 14, NIST AI RMF | Decide when Researcher is mandatory and attach citations/source inventory to planner context. | Source inventory preservation, citation annotations, dated facts, human-calibrated eval acceptance, legal/risk recency gates. | Yes for current, external, versioned, web, release, pricing, docs, governance, legal, standards, or API behavior claims. |
| [07-agi-gateway-supervisor.md](./07-agi-gateway-supervisor.md) | `agi-gateway`, `agi-supervisor`, `runtime-control`, `jsonl-observation`, `completion-verifier`, `launch-resume-print`, `retry-block-state` | `src/cli.ts:27-58`, `src/commands/agi.ts:3-19`, `src/cli/agi.ts:60-62`, `src/agi/tui.ts:24-28`, `src/agi/supervisor.ts:21-29`, `src/agi/supervisor.ts:130-135`, `src/agi/supervisor.ts:400-426`, `src/agi/store.ts:53-70` | Make AGI Gateway an explicit runtime control plane whose supervisor ticks are mission-bound, verifier-authoritative, and policy-gated. | Default completion verifier wiring, goal/criteria flags, mission/session binding, no self-report-only completion authority. | No for current repo wiring; yes for current external runtime, model, or governance facts. |
| [08-agi-mission-persistence-bridge.md](./08-agi-mission-persistence-bridge.md) | `agi-gateway-store`, `mission-store`, `mission-persistence`, `agi-session-mission-bridge`, `evidence-refs`, `completion-authority` | `src/agi/store.ts:53-70`, `src/agi/store.ts:163-195`, `src/agi/store.ts:541-591`, `src/mission/store.ts:85-97`, `src/mission/core/mission-runtime.ts:300-303` | Bridge AGI sessions, objectives, missions, criteria, and evidence so MissionStore is the durable source of runtime intent and verification. | Persist objective text, mission IDs, criteria, evidence refs, custom goals, migration-safe records, no title-as-objective fallback. | No for repo-local store shape; yes for external persistence, compliance, or migration guidance. |
| [09-governance-runtime-profile.md](./09-governance-runtime-profile.md) | `agi-governance`, `runtime-profile`, `human-oversight`, `permission-gateway`, `continuation-policy`, `proposal-integrity`, `gbrain-dependency`, `local-llm-evidence` | `src/config/settings-schema.ts:1865-1878`, `src/config/settings-schema.ts:2408-2416`, `.amaze/config.yml:39-47`, `.amaze/mcp.json:2`, EU AI Act Article 14, NIST AI RMF Core, NIST AI RMF Playbook | Convert legal/risk guidance and local policy defaults into enforceable runtime profiles for tools, continuation, oversight, and provenance. | Explicit-only continuation, enforceable tool profiles, override/stop path, dated Researcher facts for governance claims. | Yes for current legal, regulatory, standards, policy, or risk guidance. |
| [10-agency-kernel-architecture.md](./10-agency-kernel-architecture.md) | `agency-kernel`, `agi-runtime-v1`, `closed-loop-runtime`, `objective-contract`, `mission-plan-dag`, `runtime-event-sourcing`, `mission-store-source-of-truth`, `agi-gateway-execution-projection`, `replanner`, `completion-verifier` | `src/agi/supervisor.ts:71-135`, `src/mission/core/mission-control-runtime.ts:58-110`, `src/mission/store.ts:258-365`, `src/cognition/index.ts:58-82`, `src/autonomy/store.ts:32-150` | Plan the stateful agency kernel that owns ObjectiveScheduler, MissionBinder, ActionPlanner, ActionExecutor, EvidenceCollector, CompletionVerifier, Replanner, and RuntimePolicyEngine. | MissionStore source of truth, AgiGatewayStore execution projection, idempotent kernel tick, typed runtime events, verifier-authoritative completion. | No for repo-local architecture; yes when external governance/eval guidance is used. |
| [11-objective-contract-role-router.md](./11-objective-contract-role-router.md) | `objective-contract`, `role-router`, `multi-agent-runtime`, `agi-cli`, `mission-derived-goal`, `runtime-action`, `acceptance-evidence`, `budget-scope-autonomy` | `.amaze/config.yml:1-10`, `src/commands/agi.ts:3-19`, `src/cli/agi.ts:46-62`, `src/agi/store.ts:163-195`, `src/cognition/index.ts:58-82` | Compile natural-language goals into ObjectiveContracts and route plan steps to Planner/Researcher/Builder/Reviewer/Verifier/Critic/MemoryCurator/SRE/Security roles. | Mission-derived goal specs, role mutation limits, RuntimeAction conversion, objective/mission command surface, doctor checks. | Yes when role policy depends on current model/provider/tool behavior or external facts. |
| [12-tool-capability-safety.md](./12-tool-capability-safety.md) | `tool-capability-lease`, `runtime-policy-engine`, `permission-gateway`, `mutation-scope`, `proposal-integrity`, `sandbox-rollback`, `kill-switch`, `runtime-action-safety` | `src/tools/gateway/session-gateway.ts:24-166`, `src/tools/gateway/permission-gate.ts:1-60`, `src/tools/gateway/mission-policy-gate.ts:23-98`, `src/subagent/mutation-scope.ts`, `src/task/worktree.ts`, `src/config/settings-schema.ts:1865-1878` | Replace boolean approval with capability leases for mission/action/role/tool/scope/proposal/sandbox/budget authorization. | Lease validation, proposal artifact/hash enforcement, policy matrix, sandbox/rollback/kill-switch events, no autonomous mutation for ambient auto missions. | Yes for current governance/security standards or external tool-risk guidance. |
| [13-runtime-event-ledger.md](./13-runtime-event-ledger.md) | `runtime-event-sourcing`, `event-ledger`, `mission-store-source-of-truth`, `agi-events`, `replay-projections`, `idempotency`, `evidence-ledger`, `verification-events` | `src/agi/store.ts:562-591`, `src/mission/store.ts:258-365`, `src/mission/store.ts:390-416`, `src/mission/continuation/runtime.ts`, `src/mission/continuation/policy.ts` | Design append-only runtime events for scheduling, binding, planning, policy, tool execution, evidence, verification, continuation, learning, and completion. | Event schema, idempotency keys, replay/projection rules, completion causality, repair-required holds on inconsistency. | No for repo-local ledger design; yes for external audit/compliance guidance. |
| [14-memory-world-model-self-improvement.md](./14-memory-world-model-self-improvement.md) | `memory-hierarchy`, `world-model`, `world-claim-graph`, `agi-memory`, `gbrain-provider`, `procedural-memory`, `self-improvement-loop`, `proposal-eval-review-rollback` | `src/mission/store.ts:258-365`, `src/cognition/world-model.ts`, `src/cognition/learner.ts`, `src/learning/loop.ts`, `src/learning/eval/pipeline.ts`, `src/learning/apply/index.ts`, `src/tools/agency-brain.ts` | Separate L0-L6 memory layers and gate procedural/self-improvement promotion through proposal/eval/review/rollback. | MissionStore authority, GBrain as optional provider, sourced WorldClaims, stale/contradicted filtering, safe self-modification policy. | Yes for current external memory/provider behavior or eval/governance guidance. |
| [15-agi-eval-suite.md](./15-agi-eval-suite.md) | `agi-eval-suite`, `substrate-evaluation`, `self-report-rejection`, `restart-recovery`, `long-horizon-task`, `tool-policy-adversarial`, `memory-transfer`, `self-improvement-eval`, `ambiguous-objective`, `human-calibration` | `src/mission/core/verifier.ts`, `src/mission/continuation/policy.ts`, `src/mission/store.ts`, `src/tools/gateway/*`, OpenAI eval best practices, EU AI Act Article 14, NIST AI RMF | Define the eval suite required before claiming AGI-grade runtime substrate. | Seven substrate evals, objectives/datasets/metrics/human calibration, mandatory blockers, milestone-to-eval mapping. | Yes for eval methodology, governance, benchmark, or compliance claims. |

## AGI runtime priority map

Current implementation evidence shows a supervisor loop and Mission Control stores exist, but the closed-loop AGI runtime still needs explicit authority, persistence, policy, memory, and eval seams.

| Priority | Runtime seam | Target behavior | Current evidence |
| --- | --- | --- | --- |
| P0 | Mission objective persistence | MissionStore should persist objective text separately from display title and hydration should restore the real objective. | `src/mission/store.ts:85-97`, `src/mission/core/mission-runtime.ts:300-303` |
| P0 | AGI session ↔ mission binding | AGI sessions should bind to mission/objective records, criteria, and evidence refs so runtime actions are mission-addressable. | `src/agi/store.ts:53-70`, `src/agi/store.ts:541-591`, `src/mission/store.ts:258-365` |
| P0 | Mandatory completion verifier | AGI Gateway supervisor and TUI paths should use Mission Control verification as completion authority instead of optional self-report markers. | `src/cli/agi.ts:60-62`, `src/agi/tui.ts:24-28`, `src/agi/supervisor.ts:21-29` |
| P0 | Objective Contract/custom criteria | AGI CLI/runtime should accept ObjectiveContracts, mission-derived goals, and custom criteria instead of only defaulting to the initial AGI build goal. | `src/commands/agi.ts:3-19`, `src/agi/store.ts:163-195` |
| P1 | AgiKernel scheduler | `AgiSupervisor.tick()` should delegate to a mission-bound kernel loop over ObjectiveScheduler, MissionBinder, planner, executor, evidence, verifier, replanner, and policy. | `src/agi/supervisor.ts:130-135`, `src/autonomy/store.ts:32-150`, `src/mission/store.ts:258-365` |
| P1 | Cognition planner hot path | Mission-bound kernel ticks should call cognition planning by default when a mission/objective needs decomposition. | `src/cognition/index.ts:58-82`, `src/mission/core/mission-runtime.ts:481-505` |
| P1 | Runtime event ledger | Every scheduling, policy, tool, evidence, verification, replan, learning, and completion decision should append replayable events with idempotency keys. | `src/agi/store.ts:562-591`, `src/mission/store.ts:390-416` |
| P1 | Tool capability leases | Tool execution should use capability leases rather than boolean approval, and AGI profiles should enforce gateway policy. | `src/tools/gateway/session-gateway.ts:95-166`, `src/tools/gateway/permission-gate.ts:1-60`, `src/config/settings-schema.ts:1865-1878` |
| P1 | Explicit-only continuation | Continuation must remain explicit-only unless verification and policy produce an allowed continuation decision. | `.amaze/config.yml:39-47`, `src/mission/continuation/policy.ts` |
| P1 | Proposal artifact/hash enforcement | Learning/proposal promotion should require durable artifacts, hashes, approval identity, rollback refs, and evidence before runtime application. | `src/learning/eval/pipeline.ts`, `src/learning/apply/index.ts`, `src/tools/gateway/mission-policy-gate.ts:58-95` |
| P2 | Memory hierarchy/world-claim graph | MissionStore should remain authority while provider memory and GBrain become optional context with provenance, freshness, contradiction, and promotion rules. | `src/mission/store.ts:258-365`, `src/cognition/world-model.ts`, `src/tools/agency-brain.ts` |
| P2 | Self-improvement gated loop | Self-modification should pass proposal, eval, review, approval, rollback, and post-apply monitoring before promotion. | `src/learning/loop.ts`, `src/learning/eval/pipeline.ts`, `src/learning/apply/index.ts` |
| P2 | AGI eval suite | AGI-grade runtime claims should be blocked until self-report rejection, restart recovery, long-horizon task, tool-policy adversarial, memory-transfer, self-improvement, and ambiguous-external-objective evals pass. | `src/mission/core/verifier.ts`, `src/mission/store.ts`, `src/tools/gateway/*`, external eval/governance sources |
| P2 | GBrain doctor/fallback and metadata cleanup | Local GBrain integration should expose a doctor/fallback path; repo metadata/local LLM paths should not anchor plans to stale fork or provider assumptions. | `.amaze/mcp.json:2`, `.amaze/config.yml:1-19`, GitHub baseline checked 2026-06-13 |

## Planner retrieval protocol

### 1. Retrieve index

Retrieve `README.md` first to map the mission objective to domain docs. If the objective spans multiple domains, retrieve all matching docs before emitting a plan.

### 2. Retrieve domain docs

Use each domain doc metadata block as the retrieval key. The planner should prefer exact retrieval tags over broad keyword search. Source evidence paths inside the metadata block are required grounding targets for implementation plans.

### 3. Dispatch Researcher for freshness

Researcher dispatch is mandatory when the planner needs facts that may have changed outside the repository: external API behavior, release notes, current documentation, model/provider capabilities, web-search semantics, security advisories, pricing, social signals, governance/legal/risk guidance, or ecosystem examples.

### 4. Generate MissionPlan DAG

The planner should synthesize a stored `MissionPlan` whose steps are independently verifiable and whose edges express actual invariants, not just ordering. Existing core types support `depends-on`, `produces`, `must-precede`, `behavior-change`, and `needs-decision` edge kinds.

### 5. Mint task contracts

Each executable plan step should become a `MissionTask` and, when delegated, a `SubagentContract` with narrowed scope, success criteria, escalation policy, and mission binding. Contracts must not exceed the mission scope.

### 6. Verify before continuation

Mission Control must run acceptance verification and continuation classification before resuming or completing. Continuation is not a substitute for verification.

## Target TypeScript Sample

This is target/source sample code, not an existing implementation.

```ts
type DomainDocId =
	| "01-autonomy-objective-loop"
	| "02-planner-contracting"
	| "03-execution-subagents-isolation"
	| "04-verification-gates"
	| "05-memory-learning-continuation"
	| "06-researcher-recency-provenance"
	| "07-agi-gateway-supervisor"
	| "08-agi-mission-persistence-bridge"
	| "09-governance-runtime-profile"
	| "10-agency-kernel-architecture"
	| "11-objective-contract-role-router"
	| "12-tool-capability-safety"
	| "13-runtime-event-ledger"
	| "14-memory-world-model-self-improvement"
	| "15-agi-eval-suite";

interface RetrievedDomainDoc {
	docId: DomainDocId;
	retrievalTags: string[];
	sourceEvidence: string[];
	plannerUses: string[];
}

interface MissionPlanDraft {
	objective: string;
	docs: RetrievedDomainDoc[];
	requiresResearcher: boolean;
	steps: Array<{
		id: string;
		description: string;
		edges?: Array<{ target: string; kind: "depends-on" | "produces" | "must-precede" | "behavior-change" | "needs-decision" }>;
	}>;
}

function shouldDispatchResearcher(objective: string, tags: string[]): boolean {
	const text = `${objective} ${tags.join(" ")}`.toLowerCase();
	return /latest|current|external|release|docs|api|web|pricing|security|provider|model|governance|legal|risk|regulation|standard/.test(text);
}
```

## Mission Control acceptance criteria

- Planner retrieves this index before selecting domain docs.
- Planner retrieves every domain doc whose tags match the objective or missing context.
- Planner dispatches Researcher before final planning for current/external/version-sensitive facts, including governance/legal/risk guidance.
- Planner emits a MissionPlan DAG with explicit dependencies and no silent linear-only fallback.
- Planner mints scoped Builder/Researcher contracts from plan steps.
- Mission runtime verifies acceptance criteria before continuation or completion.
