# Historical Implementation Plan — Superseded

This document is retained as historical planning context only. It is not the active runtime policy.
Current behavior is direct-agent orchestration with no profile fanout and no automatic memory recall/store middleware.

# Original Plan — Subagent-First Orchestration + Memory-Candidate Handling

## Goal
Encode, as durable instruction, two behaviors so the user never has to repeat them:
1. **Subagent-first orchestration** — the orchestrator delegates non-trivial work through subagents and keeps a long-running coordinating section, instead of doing everything inline.
2. **Memory-candidate handling that is tool-availability-aware** — superseded by current no-automatic-memory middleware behavior.

## Key findings that shape the plan (evidence)

- **The authoritative, always-injected rule file is the global AGENTS.md**, not a repo file.
  - `~/.amaze/agent/AGENTS.md` is injected into the system prompt every turn (confirmed by the running session's Project Context).
  - Its own Authority section states: *"This file is the single global rule set. Project-level `AGENTS.md` files are not read; project-specific knowledge comes from memory."*
  - `~/rocky/amaze/AGENTS.md` is **byte-identical** to the global file — it is a tracked mirror, not a separately-read source.
- **The runtime dynamic prompt does NOT encode subagent policy.** `packages/coding-agent/test/dynamic-prompt/*` has zero references to `subagent|delegate|agent_run|orchestrat`. So orchestration behavior is governed only by AGENTS.md (always-on defaults) + vendor workflow prompts (slash commands). → AGENTS.md is the correct durable target; **no core runtime change is needed**.
- Historical note: earlier planning discussed memory tool availability. Current runtime policy does not rely on automatic memory recall/store middleware.
- **The vendor workflow prompts already encode strong subagent orchestration** (`vendor/amaze-subagents/prompts/parallel-*.md`, `review-loop.md`, `gather-context-and-clarify.md`) and parent/child separation. They need **no change** — the gap is the *always-on default*, which lives in AGENTS.md.
- The Report contract in AGENTS.md already ends every turn with **"Memory Candidate"**, giving a ready-made fallback channel when memory tools are absent.

## Scope
- **In scope:** edit AGENTS.md `Subagents` and `Memory` sections (+ a one-line nudge in `Execution`). Keep the two AGENTS.md copies in sync.
- **Out of scope:** core runtime / dynamic-prompt changes; vendor workflow prompt changes; enabling memory tools in `amaze.toml` (config decision belongs to the user); any new test framework for prose rules.

## File targets

1. **Primary (behavioral source of truth):** `/Users/steve/.amaze/agent/AGENTS.md`
2. **Mirror (keep byte-identical):** `/Users/steve/rocky/amaze/AGENTS.md`

> Both must receive the same edit. Editing only the repo mirror has **no behavioral effect** (project-level AGENTS.md is not read). Editing only the global file leaves the committed mirror stale.

## Proposed edits (smallest durable change)

### 1. `## Subagents` → make delegation the default operating mode
Replace the current 3 bullets with subagent-first rules:

```markdown
## Subagents (default operating mode)
- Default to subagent delegation for non-trivial work. The orchestrator routes, synthesizes, and verifies — it does not do all exploration, analysis, and implementation alone.
- When `agent_run` is available, push each non-trivial step through the right role instead of inline work: scout/context-builder (recon + context contract), researcher (external evidence), planner (plan), worker (implementation), reviewer (review), oracle (high-stakes decisions).
- Prefer parallel subagents for independent slices; respect the configured max-parallel cap.
- Keep the orchestrator section running across delegations: delegate → verify output → decide → delegate again, until the goal is met or a real blocker appears. Do not collapse into a single solo pass after one delegation.
- Do the work directly only when it is trivial, single-step, or so tightly coupled that handoff costs more than doing it. Never delegate what is cheaper to do inline.
- Give each subagent a goal, scope, limits, and expected output; verify its output before acting on it.
- Keep sensitive, destructive, production, credential, and external-messaging work local until explicitly approved. Children must not spawn subagents unless an explicit fanout agent was selected.
```

### 2. Historical `## Memory` proposal
Replace with:

```markdown
## Memory
- Superseded: do not add automatic memory recall/store middleware from this historical proposal.
```

### 3. `## Execution` → one-line nudge (optional but cheap)
Add a single bullet so the default loop references delegation:
```markdown
- Prefer delegating non-trivial steps to subagents and looping as orchestrator; act inline only for trivial or tightly-coupled steps.
```

## Why this is the smallest durable change
- One file (mirrored once), three section edits, no code, no new dependencies.
- Targets the only file that is read every turn and that the user explicitly named ("AGENTS.md").
- Reuses existing mechanisms: the `agent_run`/vendor workflow prompts (already strong) and the existing "Memory Candidate" report line (ready fallback).
- Guards against the obvious failure mode (over-delegating trivial work) with an explicit inline-work carve-out.

## Verification
1. **Read-back / structural check:** re-read both AGENTS.md files; confirm the three sections were updated and markdown headings/structure are intact.
2. **Sync check:** `diff ~/.amaze/agent/AGENTS.md ~/rocky/amaze/AGENTS.md` → expect **no output** (byte-identical).
3. **Behavioral spot-check (next turn):** on the next non-trivial request, confirm the orchestrator (a) routes work through `agent_run` rather than a single solo pass, and (b) ends with a Memory Candidate even though `mem_*` tools are absent.
4. No automated test is warranted for prose rules; adding a test harness for AGENTS.md would violate "simplicity first."

## Risks & notes
- **Over-delegation risk:** mitigated by the explicit "do inline for trivial/tightly-coupled" bullet. If future turns over-delegate, tighten the threshold wording rather than removing subagent-first.
- **Two-file drift risk:** the mirror must stay identical; the `diff` verification step covers this. Consider (future, optional) a pre-commit/husky check that fails when the two AGENTS.md diverge — not part of this minimal change.
- **Config dependency:** memory remains disabled until the user enables `[tools.mem]` + `[services.xenonite]` in `amaze.toml`. The tool-availability-aware wording means the instruction is correct in *both* states, so no edit is needed when the user later flips those flags.
- **Authority caveat:** if the intent is that the repo mirror should *not* exist at all (since it isn't read), that is a separate cleanup decision for the user; this plan keeps the mirror in sync rather than deleting it.

## Open questions for the parent/user
1. Keep the repo `AGENTS.md` as a synced mirror, or treat only the global file as canonical and drop the mirror?
2. Want the optional husky/pre-commit sync guard now, or defer it as future hardening?
