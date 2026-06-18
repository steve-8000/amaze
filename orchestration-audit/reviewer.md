# Process Review: Subagent-First Orchestration, Runtime Boundaries, and Memory

## Scope Reviewed

- Inherited prior workflow from the parent session.
- Requested but unavailable local artifacts:
  - `/Users/steve/rocky/amaze/plan.md` — not found.
  - `/Users/steve/rocky/amaze/progress.md` — not found.
- Relevant changed/created prompt-contract files inspected:
  - `vendor/amaze-subagents/agents/context-builder.md`
  - `vendor/amaze-subagents/test/unit/context-builder-contract.test.ts`

## Findings

### F-1 — High — Parent underused subagents after initial discovery

**Evidence:** The parent initially listed/called subagent capability, but then performed exploration, implementation, test creation, and verification primarily in the parent thread. Only after the user explicitly corrected the behavior did the parent attempt a fanout to `context-builder`, `reviewer`, and `oracle`.

**Why it matters:** The desired amaze model is not “call one subagent once”; it is parent-led orchestration where bounded context-building, planning, reviewing, and implementation work are delegated whenever the task is non-trivial.

**Applicable paths:**
- `vendor/amaze-subagents/agents/context-builder.md:12` now defines context-builder as a `requirements-to-runtime-contract subagent`.
- `vendor/amaze-subagents/agents/context-builder.md:16` says its job is a `runtime-aware instruction contract`, not summarization.
- `vendor/amaze-subagents/agents/context-builder.md:21` requires identifying the best target runtime, agent, or chain.

**Actionable rule:** For any non-trivial request, the orchestrator should first delegate intent/context normalization to `context-builder`, then delegate at least one role-specific pass when useful: `planner` for approach, `worker` for edits, `reviewer` for critique, `oracle` for policy/consistency, `researcher` for external facts, or `scout` for fast code reconnaissance. Direct parent execution should be the exception, not the default.

### F-2 — High — Runtime contract work was implemented before being used as the operating contract

**Evidence:** The parent changed `context-builder` to require `runtime-instruction-contract.json`, but that same task was not first routed through such a contract. The change created the right concept, but the workflow did not model the concept being introduced.

**Applicable paths:**
- `vendor/amaze-subagents/agents/context-builder.md:37` introduces `runtime-instruction-contract.json`.
- `vendor/amaze-subagents/agents/context-builder.md:110-121` makes `meta-prompt.md` derive from the JSON contract and states that the JSON object is the source of truth.
- `vendor/amaze-subagents/test/unit/context-builder-contract.test.ts:39-65` protects the presence of the JSON contract and source-of-truth language.

**Actionable rule:** When changing orchestration behavior, the parent should dogfood the new orchestration path in the same turn: build a contract, hand it to the appropriate runtime, then synthesize the result. If the new mechanism is not yet available, the parent should explicitly state that bootstrap exception.

### F-3 — High — Orchestrator/delegate separation was blurred

**Evidence:** The parent acted as explorer, implementer, test author, verifier, and reviewer in one continuous path. That compressed the process and left no independent review before the final response.

**Why it matters:** The parent orchestrator should own routing, synthesis, conflict resolution, and final accountability. Delegates should own bounded work products. Blending those roles reduces parallelism, weakens review independence, and makes it harder to keep a long orchestration section alive.

**Applicable paths:**
- `vendor/amaze-subagents/agents/context-builder.md:121` distinguishes the JSON contract from the runtime-facing prompt. This supports a clean parent/delegate boundary: parent routes by contract; delegate executes the rendered task.

**Actionable rule:** Preserve role boundaries:
- Parent: decide routing, launch subagents, synthesize results, verify final evidence.
- `context-builder`: produce structured contract and meta-prompt; do not implement.
- `planner`: plan; do not edit unless explicitly asked.
- `worker`: implement bounded tasks.
- `reviewer`: inspect and report; do not edit.
- `oracle`: resolve policy/consistency questions; do not become a worker.

### F-4 — Medium — Memory handling was missed

**Evidence:** The parent did not recall memory at the start of non-trivial work and did not save or surface a durable memory candidate after the user clarified a stable operating preference: subagent-first orchestration, JSON-like runtime contracts, and memory use.

**Why it matters:** This is durable system behavior, not a one-off task preference. If available, memory should preserve it so later turns do not repeat the same correction.

**Applicable paths:** No repository file path applies directly; this is a runtime-process issue. The relevant durable preference came from the user’s instruction in the live session.

**Actionable rule:** At the start of non-trivial work, recall memory if a memory tool is exposed. After the user confirms a durable preference and the turn verifies it, save a concise memory entry. If no memory tool is exposed, explicitly say so and include a `Memory Candidate` in the final response or handoff contract for the parent/runtime to persist.

Recommended memory candidate:

> For non-trivial amaze work, use subagent-first orchestration: context-builder should compile user context into a JSON-like runtime instruction contract, then the parent should route bounded work to planner/reviewer/worker/oracle/researcher/scout as appropriate. Recall and save memory when tools are available; if unavailable, surface a Memory Candidate explicitly.

### F-5 — Medium — Expected tracking artifacts were absent

**Evidence:** The delegated task explicitly asked to read `/Users/steve/rocky/amaze/plan.md` and `/Users/steve/rocky/amaze/progress.md`, but both files were absent. This suggests the parent launched follow-up audit work without durable local plan/progress artifacts.

**Applicable paths:**
- `/Users/steve/rocky/amaze/plan.md` — missing.
- `/Users/steve/rocky/amaze/progress.md` — missing.

**Actionable rule:** For long-running orchestrations, the parent should maintain durable section state when it delegates multiple tasks. If the task references plan/progress files, create or update them before launching dependent subagents, or omit those references from the child prompt.

### F-6 — Medium — Final verification was parent-heavy and review-light

**Evidence:** The parent ran targeted diagnostics/tests and noted unrelated full-suite failures, but no independent reviewer pass occurred before finalizing the implementation response. The later user correction triggered review orchestration only after the final report.

**Applicable paths:**
- `vendor/amaze-subagents/test/unit/context-builder-contract.test.ts:30-65` shows useful regression coverage was added.

**Actionable rule:** For any file-changing task, the parent should schedule an independent review before final reporting when the change affects orchestration, prompts, permissions, memory, runtime contracts, deployment, or multi-agent behavior. The parent may still run its own verification, but independent review should happen before the final user-facing completion claim.

## Operating Rules Going Forward

1. **Default to subagent-first for non-trivial work.** If the request requires exploration plus action, use `context-builder` before implementation.
2. **Use a structured contract before role execution.** The handoff should include `intent`, `target_runtime`, `goal`, `scope`, `context`, `instructions`, `validation`, `permissions`, `escalation`, `output_contract`, and `handoff`.
3. **Keep the parent as orchestrator.** The parent routes, synthesizes, arbitrates, and verifies; delegates produce bounded artifacts.
4. **Do not stop after one subagent when the task has multiple phases.** Exploration, planning, implementation, and review are separable phases and should usually be delegated separately.
5. **Allow direct handling only for narrow exceptions.** Direct parent execution is acceptable for trivial self-contained answers, unavailable subagent tooling, emergency correction, or tiny single-file edits; the parent should state the exception briefly.
6. **Use memory deliberately.** Recall at the start of non-trivial work, save durable confirmed preferences after verification, and surface a memory candidate if no memory tool is available.
7. **Maintain durable progress state for long sections.** If child tasks are instructed to read plan/progress artifacts, those artifacts must exist and be current.
8. **Review before final when orchestration behavior changes.** Runtime-contract, prompt, memory, delegation, and permission changes should receive an independent reviewer pass before final completion.

## Residual Risks

- This review could not inspect `plan.md` or `progress.md` because both files were missing.
- The review is based on inherited session context plus inspected repository files; it cannot reconstruct tool outputs that were unavailable after compaction.
- Memory tool availability was not directly testable in this child runtime; the rule above covers both available and unavailable cases.
- `vendor/amaze-subagents/` appears untracked in the current Git status, so persistence of the prompt-contract changes depends on the parent’s vendor tracking/sync policy.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned concrete findings F-1 through F-6 with severity labels and applicable file paths, including vendor/amaze-subagents/agents/context-builder.md:12, :16, :21, :37, :110-121 and vendor/amaze-subagents/test/unit/context-builder-contract.test.ts:30-65."
    }
  ],
  "changedFiles": [
    "/Users/steve/rocky/amaze/orchestration-audit/reviewer.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read /Users/steve/rocky/amaze/plan.md and /Users/steve/rocky/amaze/progress.md",
      "result": "passed",
      "summary": "Both requested context files were checked and found missing with ENOENT."
    },
    {
      "command": "grep context-builder runtime contract markers",
      "result": "passed",
      "summary": "Confirmed relevant line references in context-builder.md and context-builder-contract.test.ts."
    },
    {
      "command": "git -C /Users/steve/rocky/amaze diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files were reported."
    }
  ],
  "validationOutput": [
    "plan.md: ENOENT",
    "progress.md: ENOENT",
    "No staged files reported by git diff --cached --name-only"
  ],
  "residualRisks": [
    "plan.md and progress.md were unavailable, so this review could not validate any parent-maintained durable plan/progress state.",
    "Some inherited tool output was unavailable after compaction, so this review relies on preserved conversation context and inspected files.",
    "Memory tool availability was not directly testable in this child runtime.",
    "vendor/amaze-subagents/ appears untracked, so persistence depends on parent vendor tracking policy."
  ],
  "noStagedFiles": true,
  "notes": "No source code was edited; only the required review artifact was written."
}
```
