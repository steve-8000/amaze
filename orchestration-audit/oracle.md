# Oracle Decision: Durable Operating Principle for amaze Orchestration

## Verdict (one line)
Delegate by default for non-trivial work, but gate every delegation on a cost/benefit test; the orchestrator's job is to *coordinate a long-running section*, not to personally perform deep work — and never to spawn subagents for work cheaper to do directly.

---

## 1. Should the orchestrator maximize subagent use for non-trivial work?

**Yes — but "maximize value from delegation," not "maximize count of subagent calls."**

The correct durable principle is **subagent-first, not subagent-only**:

- The orchestrator is a *coordinator*. Its scarce resource is its own context window and decision continuity. Every unit of deep reading, searching, implementing, or reviewing it does itself burns that resource and shortens how long it can sustain the section.
- Therefore, **bounded, parallelizable, or context-heavy non-trivial work should be pushed to subagents** (context-builder → planner/worker/reviewer/oracle/researcher/scout), so the orchestrator stays lean and can run the section far longer.
- "Maximize" is measured by **how much verified work completes per orchestrator-context-unit spent**, not by raw delegation volume.

### Why this is durable (not just this turn)
- It matches the core rule: *"Delegate bounded, parallelizable work to the right agent."*
- A lean orchestrator can fan out 3–4 parallel workers and synthesize, which strictly dominates serial self-execution on throughput.
- It preserves orchestrator/delegate separation: the parent owns routing, review fanout, and follow-up launches; children own bounded execution.

---

## 2. How to avoid over-delegating trivial tasks

Apply a **delegation gate** before every spawn. Delegate only if **at least one** is true:

1. The task needs its own multi-step exploration (broad search + multi-file reads + synthesis).
2. The work is parallelizable into independent slices.
3. The work would consume enough orchestrator context to threaten section longevity.
4. The task benefits from an isolated/fresh context (e.g., adversarial review, fork-protected decision).

**Do NOT delegate (handle directly) when:**
- A single read/grep/ls answers it.
- It is a one-shot edit or a short factual lookup.
- The handoff cost (writing a contract + spawn + parse + verify) exceeds the cost of just doing it.
- The result is needed inline to decide the *next* delegation (sequential micro-step).

**Rule of thumb:** if specifying the subagent prompt takes longer than completing the task, do it yourself.

### Tradeoffs (explicit)
| Lever | Over-delegation cost | Under-delegation cost |
|---|---|---|
| Latency | Spawn + handoff round-trips stack up | Orchestrator serializes everything |
| Context | Fragmentation, handoff information loss | Orchestrator context exhausts early, section ends short |
| Quality | Children may drift without tight contracts | No independent/adversarial check |
| Throughput | Coordination overhead dominates on tiny tasks | No parallelism gain |

The gate above is the balance point: it captures parallelism/longevity wins while refusing coordination overhead on trivia.

---

## 3. Memory when no memory tool is exposed

**Context:** `AGENTS.md` states project-specific knowledge comes from memory, and mandates recall at the start of non-trivial work and save-after-verification. **But the current fork exposes no memory tool** (available tools: read, grep, find, ls, bash, web_search). This capability gap must be handled explicitly, not ignored.

**Policy — capability-aware memory behavior:**

1. **Detect, don't assume.** At task start, check whether a memory/recall tool is actually exposed in the current runtime.
2. **If memory tools ARE exposed:** recall relevant memory before non-trivial work; save durable preferences, stable project facts, verified decisions, and reusable lessons *after verification only*. Never save speculation, secrets, or noisy state.
3. **If memory tools are NOT exposed (degrade gracefully):**
   - Do **not** fabricate, simulate, or claim memory operations.
   - Do **not** silently drop the requirement.
   - **Always emit a "Memory Candidate" line in the final report** capturing what *should* be persisted (durable fact / verified decision / reusable lesson). The orchestrator — which may hold memory capability the fork does not — becomes the persistence path.
   - Treat in-session artifacts (handoff files, contracts, the report itself) as the substitute working memory for the current section.
4. **Forks specifically:** delegated children run on a fork and frequently lack memory tools. The durable rule is that **memory writes are an orchestrator responsibility**, and children surface candidates upward rather than attempting writes.

This keeps the system honest: memory intent is never lost, but it is also never faked when the capability is absent.

---

## Stop Conditions
- **Stop delegating and act directly** when the delegation gate (Section 2) fails — the task is trivial or sequentially blocking.
- **Stop spawning more subagents** when a parallel wave already answers the question, or two waves yield no new useful signal.
- **Stop and escalate to the user** only for true blockers, goal changes, or Hard-Stop actions (production, credentials, destructive, external messaging).
- **Stop self-execution and delegate** the moment the orchestrator notices it is doing deep multi-step work that is shortening the section.
- **Stop claiming memory was saved** whenever no memory tool is exposed — emit a Memory Candidate instead.
- **After three failed delegation/fix attempts**, stop and question the architecture rather than retrying blindly.

---

## Net Operating Principle (commitable)
> The orchestrator stays lean and long-running by delegating all bounded/parallel/context-heavy non-trivial work through structured contracts, doing trivial work itself, verifying every child output before acting, and always surfacing memory candidates upward when it cannot persist them directly.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Delivered a crisp durable orchestration policy answering all three questions (maximize subagent use, avoid over-delegation, memory with no memory tool) with tradeoffs and stop conditions, written to orchestration-audit/oracle.md. No code or unrelated files touched; scope limited to the requested policy decision."
    }
  ],
  "changedFiles": ["orchestration-audit/oracle.md"],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "cat AGENTS.md (core rules grounding)",
      "result": "passed",
      "summary": "Confirmed memory/subagent/execution rules used to ground the policy"
    },
    {
      "command": "ls tool inventory (read/grep/find/ls/bash/web_search)",
      "result": "passed",
      "summary": "Confirmed no memory tool exposed in this fork, grounding the memory-degradation policy"
    },
    {
      "command": "write orchestration-audit/oracle.md",
      "result": "passed",
      "summary": "Policy document written successfully"
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "Delegation gate is heuristic; borderline tasks still need orchestrator judgment.",
    "Policy assumes the orchestrator itself has memory capability to consume surfaced Memory Candidates; if it also lacks memory, persistence depends on the user/session artifacts.",
    "This is a policy artifact, not enforced in code; adoption requires the orchestrator to actually follow it."
  ],
  "noStagedFiles": true,
  "notes": "Pure decision/policy task. Key grounding fact: this fork exposes no memory tool, which directly informs Section 3. Recommend the parent treat the Net Operating Principle line as the durable rule and consider persisting it to memory."
}
```
