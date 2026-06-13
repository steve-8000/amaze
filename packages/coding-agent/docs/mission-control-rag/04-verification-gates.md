---
doc_id: mission-control-rag-04-verification-gates
domain: mission-control.verification
retrieval_tags:
  - acceptance-verifier
  - verification-context
  - llm-judge
  - lifecycle-template
  - continuation-policy
  - risk-based-gates
source_evidence:
  - packages/coding-agent/src/mission/core/verifier.ts
  - packages/coding-agent/src/mission/core/mission-runtime.ts
  - packages/coding-agent/src/mission/continuation/policy.ts
  - packages/coding-agent/src/mission/core/lifecycle-template.ts
  - packages/coding-agent/src/mission/core/llm-judge.ts
planner_uses:
  - Retrieve deterministic and semantic verification rules for Mission Control plans.
  - Decide which gates must block mission completion for code, architecture, runtime, release, and external-side-effect work.
  - Generate Builder contracts that include verifiable acceptance criteria and explicit uncertainty policy.
---

# Verification gates

Cross-references: [03 Execution, Subagents, and Isolation](./03-execution-subagents-isolation.md) produces task evidence for these gates; [05 Memory, Learning, Continuation](./05-memory-learning-continuation.md) only learns from outcomes after verification or continuation has resolved uncertainty.

## Spec

Mission Control verification authority has two layers:

1. Deterministic checks in `AcceptanceVerifier`: scope include/exclude, file existence, command exit, command output, LSP cleanliness, and manual placeholders.
2. Semantic checks through `llm-judged` criteria using an injected `VerificationContext.llmJudge`, with fail-closed parsing and cost caps.

Completion authority should come from the latest verifier/review/preflight state, not from model narration. A mission may complete only when its lifecycle template and risk policy permit it:

- required decision records exist;
- required regression contracts exist;
- required proposal approvals exist before mutation;
- required verifier verdict is pass or force;
- required source review verdict is pass with non-Markdown source files;
- declared phases are verified;
- no failing verifier verdict remains unresolved.

Uncertainty must be explicit. The planner should select an uncertain policy by risk:

- low-risk conversation/repo exploration: uncertain can surface as pending or warning;
- code changes: uncertain acceptance criteria should be converted into deterministic checks or LSP/command checks before completion;
- architecture/runtime/release/external-side-effect work: uncertain semantic checks block unless a force path is explicitly invoked by an authorized operator.

## Source Evidence

- `src/mission/core/verifier.ts`: `AcceptanceVerifier.verify` dispatches deterministic backends and `llm-judged` checks from a `VerificationContext`. Deterministic checks return stable evidence and confidence; `lsp-clean` and `llm-judged` return `uncertain` when their providers are absent. `summarize` has audit and contract modes, and default blocking policy treats `scope-include`, `lsp-clean`, and `llm-judged` uncertainty as blocking in contract mode.
- `src/mission/core/mission-runtime.ts`: `verify` records mission verification and emits `mission.verification.completed`; `recordVerification` treats a pass verdict as authoritative and marks criteria satisfied; `complete` uses shared acceptance preflight, phase verification, latest review, and recorded verifier verdicts to block or allow completion.
- `src/mission/continuation/policy.ts`: `buildAcceptancePreflight` is the pure source of completion gate truth shared by manual completion and continuation. `classifyContinuation` treats missing requirements or failing verifier verdicts as more work to continue, while terminal lifecycle, user messages, proposal approval, budget caps, and no-progress limits hold or stop scheduling.
- `src/mission/core/lifecycle-template.ts`: lifecycle templates define intent-specific requirements. `code_change` requires verification and review; `architecture_change`, `runtime_refactor`, and `release_hardening` require decision record, regression contract, proposal-before-mutation, verification, and review; `external_side_effect` requires decision record, proposal-before-mutation, and verification.
- `src/mission/core/llm-judge.ts`: `ProductionLlmJudgeRunner` is an injected semantic-verifier seam. It uses a strict verdict prompt, parses JSON verdicts, returns `uncertain` for unparseable replies or token-cap overruns, and returns `fail` when the chat call throws.

## Verification Authority Model

### Deterministic criteria

Use deterministic checks whenever the acceptance question can be measured by local state:

- `scope-include` and `scope-exclude` for changed-file blast radius;
- `file-exists` for required deliverables;
- `command-exit` when exit status is sufficient;
- `command-output` when output patterns or forbidden patterns matter;
- `lsp-clean` for editor diagnostics when a provider is configured.

The verifier should receive `changedFiles` from the execution/session layer. It should not compute its own diff because the mission runner owns what a subagent claims to have changed.

### Semantic criteria

Use `llm-judged` only for reviewable semantic claims that cannot be made deterministic yet, such as "the plan mentions rollback blast radius" or "the migration notes explain compatibility risk." The semantic judge must be isolated and read-only. If the judge is unavailable, unparseable, or over budget, the verdict is uncertain rather than invented.

### Runtime completion gates

A verifier pass is necessary but not always sufficient. `buildAcceptancePreflight` also checks lifecycle-template requirements and phase/review status. Verification failure is work to continue; missing external approval or user input is a hold/block condition. Completion should call the same preflight path that continuation uses to avoid divergent policy.

## Target TypeScript Sample: VerificationContext wiring

```ts
// Target TypeScript sample; not current implementation.
import { AcceptanceVerifier, summarize, type AcceptanceCriterion } from "../mission/core/verifier";
import { ProductionLlmJudgeRunner } from "../mission/core/llm-judge";

export async function verifyMissionChange(args: {
	cwd: string;
	changedFiles: string[];
	criteria: AcceptanceCriterion[];
	chatJudge: (input: { prompt: string }) => Promise<{ reply: string; tokensUsed?: number }>;
	lspDiagnostics?: (file: string | undefined) => Promise<LspDiagnostic[]>;
}) {
	const verifier = new AcceptanceVerifier();
	const results = await verifier.verify(args.criteria, {
		cwd: args.cwd,
		changedFiles: args.changedFiles,
		lspDiagnostics: args.lspDiagnostics,
		llmJudge: new ProductionLlmJudgeRunner({
			chat: args.chatJudge,
			maxTokensPerCall: 500,
		}),
	});

	return summarize(results, args.criteria, "contract");
}
```

## Target TypeScript Sample: risk-based uncertain policy

```ts
// Target TypeScript sample; not current implementation.
import type { Mission } from "../mission/core/mission";
import type { VerificationVerdict } from "../mission/core/verifier";

export function canCompleteWithUncertainty(mission: Mission, verdict: VerificationVerdict): boolean {
	if (verdict.verdict === "fail") return false;
	if (verdict.uncertainCount === 0) return true;

	switch (mission.intent) {
		case "conversation":
		case "question_answering":
		case "repo_exploration":
			return mission.riskLevel !== "high";
		case "code_change":
		case "architecture_change":
		case "runtime_refactor":
		case "release_hardening":
		case "external_side_effect":
			return false;
	}
}

export function nextVerificationAction(mission: Mission, verdict: VerificationVerdict): "complete" | "revise" | "operator-review" {
	if (canCompleteWithUncertainty(mission, verdict)) return "complete";
	if (verdict.results.some(result => result.status === "fail")) return "revise";
	return mission.riskLevel === "high" ? "operator-review" : "revise";
}
```

## Mission Control Acceptance Criteria for Builders

- Every Mission Control plan includes acceptance criteria that map to deterministic verifier backends when possible.
- Semantic `llm-judged` criteria are isolated, read-only, token-capped, and treated as uncertain when unavailable or malformed.
- Completion checks use the same acceptance preflight as continuation; there is no separate permissive completion path.
- High-risk intents require decision/review/regression/proposal gates according to `lifecycle-template.ts` before completion.
- A failing verifier verdict schedules revision work or blocks completion; it is never hidden by satisfied flags or subagent prose.
