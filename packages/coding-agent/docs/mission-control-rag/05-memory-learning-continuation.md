---
doc_id: mission-control-rag-05-memory-learning-continuation
domain: mission-control.memory-learning-continuation
retrieval_tags:
  - world-model
  - knowledge-store
  - cognition-learner
  - learning-loop
  - proposal-eval
  - proposal-apply-rollback
  - mission-continuation
source_evidence:
  - packages/coding-agent/src/cognition/world-model.ts
  - packages/coding-agent/src/cognition/learner.ts
  - packages/coding-agent/src/memory/knowledge-store.ts
  - packages/coding-agent/src/learning/loop.ts
  - packages/coding-agent/src/learning/eval/pipeline.ts
  - packages/coding-agent/src/learning/apply/index.ts
  - packages/coding-agent/src/mission/continuation/runtime.ts
  - packages/coding-agent/src/mission/store.ts
planner_uses:
  - Retrieve the Evidence -> Claim -> WorldModel -> Retrieval -> LearningProposal chain.
  - Generate plans that record learnable mission outcomes without promoting unsourced claims.
  - Decide when continuation is safe, when learning proposals need eval, and how rollback is preserved.
---

# Memory, learning, and safe continuation

Cross-references: [03 Execution, Subagents, and Isolation](./03-execution-subagents-isolation.md) creates evidence refs and task attempt checkpoints; [04 Verification Gates](./04-verification-gates.md) determines which outcomes are trustworthy enough to learn from or continue.

## Spec

Mission Control memory should follow this chain:

1. Evidence: task runs, patches, branches, verification records, review records, rollback snapshots, and continuation ledger state.
2. Claim: a specific statement derived from evidence, never an unsourced model belief.
3. WorldModel: mission-scoped claims stored in `mission_world_model` and ranked for planning context.
4. Retrieval: active global heuristics from `KnowledgeStore` and mission-scoped world-model claims injected into future planning.
5. LearningProposal: rule findings become proposed settings/rules/skills/memory changes, deduped while pending.
6. Eval: provenance, contradiction, replay, and optional sandbox regression gates determine whether a proposal is safe.
7. Apply/Rollback: approved proposals are applied with snapshots; rejected proposals record rejection reasons; applied proposals can be rolled back from snapshots.
8. Safe Continuation: the continuation runtime schedules hidden turns only when mission policy, proposal gates, user intent, budget, and progress checks allow it.

The planner should separate mission-local working memory from durable global learning. Mission-local world-model entries can be unverified context. Global knowledge must have provenance and should be promoted only after verification/review or explicit learning eval.

## Source Evidence

- `src/cognition/world-model.ts`: `worldModelForPlanning` ranks verified pass outcomes first, then failed/blocked hazards, then other verified and unverified claims. It formats bounded prompt context and records plan actions or learned outcomes back to `mission_world_model` with evidence refs.
- `src/cognition/learner.ts`: `deriveHeuristics` emits conservative heuristics from mission outcome snapshots: repeated contract failures, uncertainty escalations, blocked prerequisites, and clean verified successes. `learnFromMission` persists global knowledge through `KnowledgeStore`, skipping duplicate active claims.
- `src/memory/knowledge-store.ts`: `KnowledgeStore` is SQLite-backed, requires `sourceRefs`, tracks explicit supersession, excludes superseded/stale items from active retrieval, and can invalidate repo-scoped items whose content hash drifted.
- `src/learning/loop.ts`: `runObjectiveLoopOnce` evaluates rules over session events, converts findings to proposals, dedupes equivalent pending proposals, optionally evaluates auto-gated proposals, and isolates bad rules/findings/evals so one failure does not break the objective flow.
- `src/learning/eval/pipeline.ts`: `evaluateProposal` runs provenance, contradiction, replay, and optional sandbox gates. Reports include stage, signals, duration, sandbox result, and canonical patch hash.
- `src/learning/apply/index.ts`: `applyProposal` requires approved status, rejects stale or missing/failed sandbox results when regression commands exist, snapshots targets before applying, marks applied proposals with a version, restores snapshots on apply bookkeeping failure, and supports manual rollback.
- `src/mission/continuation/runtime.ts`: continuation IO is delegated to the host, while decisions come from pure policy. It reconciles stale running/scheduled state, records progress fingerprints, respects user messages and proposal approval, CAS-schedules continuations, and marks terminal missions.
- `src/mission/store.ts`: the store persists task attempt checkpoints, verification/review rows, mission world-model records, rollback snapshots, proposals, and continuation ledger rows with CAS transitions and no-progress accounting.

## Memory Model

### Evidence

Evidence refs should be durable and dereferenceable by later agents. Examples include `task-run://...`, `task-patch://...`, `task-branch://...`, `verification://...`, `review://...`, `rollback://...`, `knowledge://...`, and `mission://...`. Evidence is not useful unless it points to a concrete artifact, row, or event.

### Claim

A claim is a compact assertion grounded in evidence. Claims should be narrow enough to falsify later, for example:

- "Task `api-migration` failed verifier twice because changed files exceeded contract scope."
- "Mission `release-hardening` completed with pass verification and no failed checkpoints."
- "A prerequisite was missing because sandbox replay could not run without approved proposal metadata."

### WorldModel

The mission world model is local context for current/future planning. It can include unverified claims, but retrieval ranking must prefer verified pass outcomes and failed/blocked hazards. World-model entries should link back to plan revisions, task attempts, verification rows, or knowledge items.

### KnowledgeStore

Global knowledge is stricter than world-model context. `KnowledgeStore.record` rejects items without provenance and active retrieval excludes superseded or stale records. Repo-scoped claims should carry file path and content hash so drift can invalidate them.

## Learning Promotion Model

Learning proposals must pass through eval before apply when they change settings, skills, rules, or durable memory policy. The pipeline should:

1. reject proposals without provenance;
2. reject contradictions with active memory/skills;
3. replay relevant sessions when available;
4. run sandbox regressions when proposal regression commands exist;
5. compute a canonical patch hash and reject apply if the evaluated patch no longer matches;
6. snapshot mutable targets before applying;
7. store rollback metadata and support rollback.

## Continuation Model

Safe continuation is not a loop-until-success primitive. It is a policy-controlled scheduler:

- terminal mission lifecycles stop continuation;
- automatic continuation is disabled for ambient auto missions;
- user-authored messages take priority;
- mutation-gated missions wait for approved proposals;
- auto-turn, token, and no-progress caps pause continuation;
- acceptance preflight success schedules completion recording, not fabricated outcomes;
- failing verification or missing gates schedule more work rather than hiding the problem.

## Target TypeScript Sample: claim consolidation

```ts
// Target TypeScript sample; not current implementation.
import { recordLearnedOutcome, recordPlanAction, worldModelForPlanning } from "../cognition/world-model";
import type { MissionStore } from "../mission/store";

export function consolidateMissionClaims(args: {
	store: MissionStore;
	missionId: string;
	planRevision: number;
	stepCount: number;
	verificationStatus: "pass" | "fail" | "uncertain" | "blocked";
	evidenceRefs: string[];
}) {
	recordPlanAction(args.store, args.missionId, {
		revision: args.planRevision,
		stepCount: args.stepCount,
		rationale: "planner decomposition used by Mission Control execution",
	});

	const outcome = args.store.recordWorldModel({
		missionId: args.missionId,
		kind: "outcome",
		source: "verification",
		sourceId: `verification:${args.missionId}:${args.planRevision}`,
		claim: `Mission plan revision ${args.planRevision} produced ${args.verificationStatus} verification.`,
		evidenceRefs: args.evidenceRefs,
		outcomeStatus: args.verificationStatus,
		verified: args.verificationStatus === "pass" || args.verificationStatus === "fail",
	});

	return {
		outcome,
		planningContext: worldModelForPlanning(args.store, args.missionId, 8),
	};
}
```

## Target TypeScript Sample: learning promotion

```ts
// Target TypeScript sample; not current implementation.
import { learnFromMission, heuristicsForPlanning } from "../cognition/learner";
import { evaluateProposal } from "../learning/eval/pipeline";
import { applyProposal, rollbackProposal } from "../learning/apply";
import type { KnowledgeStore } from "../memory/knowledge-store";
import type { MissionStore } from "../mission/store";

export async function promoteVerifiedMissionLearning(args: {
	missionStore: MissionStore;
	knowledgeStore: KnowledgeStore;
	proposalStore: ProposalStore;
	applyDb: Database;
	missionId: string;
	objective: string;
	workspaceRoot: string;
}) {
	const checkpoints = args.missionStore.listTaskAttemptCheckpoints(args.missionId);
	const latestVerification = args.missionStore.getLatestVerification(args.missionId);
	const learned = learnFromMission(
		{
			missionId: args.missionId,
			objective: args.objective,
			status: latestVerification?.status === "pass" ? "success" : "partial",
			checkpoints,
			verificationVerdict: latestVerification?.status === "pass" ? "pass" : "pending",
		},
		args.knowledgeStore,
	);

	for (const proposal of args.proposalStore.listByStatus("approved")) {
		const report = await evaluateProposal(proposal, { workspaceRoot: args.workspaceRoot });
		args.proposalStore.setLastEval(proposal.id, report);
		if (!report.passed) continue;

		try {
			await applyProposal({ store: args.proposalStore, db: args.applyDb, proposalId: proposal.id });
		} catch (error) {
			await rollbackProposal({ store: args.proposalStore, db: args.applyDb, proposalId: proposal.id });
			throw error;
		}
	}

	return {
		recordedKnowledge: learned.recorded,
		plannerHeuristics: heuristicsForPlanning(args.knowledgeStore, 8),
	};
}
```

## Mission Control Acceptance Criteria for Builders

- Mission-local world-model claims always include source id, evidence refs, outcome status when known, and verified flag semantics.
- Global knowledge writes are rejected unless source refs are present; stale/superseded knowledge is excluded from active retrieval.
- Learning proposals are deduped while pending and evaluated through provenance, contradiction, replay, and sandbox gates before promotion.
- Apply paths snapshot mutable targets and provide rollback for applied proposals.
- Continuation scheduling respects user intent, proposal approval, terminal lifecycle, budgets, no-progress detection, and the shared verification preflight from [04 Verification Gates](./04-verification-gates.md).
