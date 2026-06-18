# Orchestration Policy — Context Builder Audit

## Runtime Instruction Contract

```json
{
  "contract_type": "runtime_instruction_contract",
  "schema_version": "1.0",
  "intent": "policy_implementation",
  "target_runtime": "worker",
  "routing": {
    "reason": "User wants durable code/instruction changes that enforce subagent-first orchestration and memory handling without repeated reminders.",
    "confidence": "high"
  },
  "goal": {
    "summary": "Patch AGENTS.md and the amaze-subagents SKILL.md so the orchestrator is structurally required to use subagents for non-trivial work and surface memory candidates every turn.",
    "why": "The orchestrator currently treats subagent delegation as optional. The user must not have to remind the system each session.",
    "success_criteria": [
      "AGENTS.md Subagents section explicitly names context-builder as the required first step for goal/plan/review/deploy/large-change/ambiguous work",
      "AGENTS.md Subagents section states the orchestrator must NOT do non-trivial investigation, implementation, or review solo",
      "AGENTS.md Memory section states how to handle memory when mem_* tools are unavailable (surface candidate in report)",
      "SKILL.md (pi-subagents) opening section reinforces context-builder-first routing as the default entry point",
      "Changes are minimal — no new files needed"
    ]
  },
  "scope": {
    "in": [
      "/Users/steve/rocky/amaze/AGENTS.md — Subagents section and Memory section",
      "/Users/steve/rocky/amaze/vendor/amaze-subagents/skills/pi-subagents/SKILL.md — When to Use section"
    ],
    "out": [
      "Runtime source code (vendor/amaze-subagents/src)",
      "Agent prompt files (worker.md, planner.md, etc.)",
      "amaze.toml — memory config is a deployment concern, not a workflow rule"
    ]
  },
  "context": {
    "user_request": "Make the amaze orchestrator use subagents by default for non-trivial work; use context-builder as runtime instruction contract compiler; handle memory candidates durably.",
    "relevant_files": [
      {
        "path": "AGENTS.md",
        "lines": "1-45",
        "relevance": "Single global rule set. The Subagents and Memory sections govern orchestrator behavior directly. This is the highest-priority target."
      },
      {
        "path": "vendor/amaze-subagents/skills/pi-subagents/SKILL.md",
        "lines": "1-60",
        "relevance": "Injected as a skill into the parent orchestrator. The 'When to Use' section is where context-builder-first routing should be anchored."
      }
    ],
    "evidence": [
      "AGENTS.md Subagents section currently says 'Delegate bounded, parallelizable work' — this is opt-in, not mandatory.",
      "AGENTS.md Memory section says 'Recall relevant memory at the start of non-trivial work / Save durable preferences...' but says nothing about what to do when mem_* tools are not available.",
      "SKILL.md 'When to Use' section lists advisory review, implementation handoffs, and multi-step tasks — but does not mention context-builder as the required first routing step.",
      "amaze.toml: tools.mem.enabled = false — memory tools are currently off. The orchestrator gets no mem_* tools in the active session.",
      "The pi-subagents SKILL.md is the live injected instruction for the orchestrator. Changes here take effect immediately without code changes."
    ],
    "assumptions": [
      "AGENTS.md is the global rule file and overrides project-level files per its own authority rule.",
      "Changes to SKILL.md take effect in the next session since skills are loaded at start.",
      "Memory tools (mem_*) are currently disabled; the fix must degrade gracefully to 'surface candidate in Report section'."
    ],
    "unknowns": []
  },
  "instructions": {
    "must_do": [
      "Patch AGENTS.md ## Subagents: add explicit rule that non-trivial investigation/implementation/review MUST go through subagents, not solo",
      "Patch AGENTS.md ## Subagents: add explicit rule that ambiguous/goal/plan/review/deploy work MUST start with context-builder as the routing/contract step",
      "Patch AGENTS.md ## Memory: add explicit rule for mem_* unavailable — emit memory candidate in ## Report section every turn",
      "Patch SKILL.md When to Use: add context-builder-first as the default routing step before planner/worker/reviewer"
    ],
    "must_not_do": [
      "Do not change runtime source code (src/)",
      "Do not add speculative new sections — patch only what is relevant",
      "Do not make memory mandatory when tools are unavailable — degrade gracefully"
    ],
    "suggested_approach": [
      "Edit AGENTS.md ## Subagents: replace 'Delegate bounded, parallelizable work' with a hard routing rule",
      "Edit AGENTS.md ## Memory: add the graceful degradation rule for missing mem_* tools",
      "Edit SKILL.md: in the 'When to Use' section prepend a context-builder-first routing rule"
    ]
  },
  "validation": {
    "required": true,
    "commands": [],
    "evidence_required": [
      "AGENTS.md Subagents section contains 'context-builder' as a required first step for named intent categories",
      "AGENTS.md Memory section contains explicit fallback for mem_* unavailable",
      "SKILL.md When to Use section references context-builder as default routing entry"
    ]
  },
  "permissions": {
    "requires_user_approval": false,
    "reasons": []
  },
  "escalation": {
    "ask_user_when": [
      "The user wants a different trigger list for context-builder-first routing"
    ],
    "stop_when": []
  },
  "output_contract": {
    "format": "markdown patches to AGENTS.md and SKILL.md",
    "required_sections": []
  },
  "handoff": {
    "next_agent": "worker",
    "task_prompt": "Apply the minimal patches described in this contract to AGENTS.md (Subagents section + Memory section) and vendor/amaze-subagents/skills/pi-subagents/SKILL.md (When to Use section). Use apply_patch. Do not change anything outside the targeted sections. Verify with lang_check/read after patching."
  }
}
```

---

## Exact Recommended Edit Targets

### 1. `AGENTS.md` — `## Subagents` section (lines 20–23)

**Current:**
```
## Subagents
- Delegate bounded, parallelizable work to the right agent (oracle/planner/reviewer/worker/researcher/scout/context-builder).
- Keep sensitive, destructive, production, credential, and external-messaging work local until explicitly approved.
- Give each subagent a goal, scope, limits, and expected output. Verify its output before acting on it.
```

**Patch — replace with:**
```
## Subagents
- For any non-trivial investigation, implementation, or review: use subagents. Do not work solo.
- Route through context-builder first when the request is a goal, plan, review, deploy, large change, or ambiguous intent. context-builder produces a runtime_instruction_contract that tells the next agent exactly what to do.
- Direct handling is only acceptable for: single-line answers, trivial lookups, listing tools/agents, and status checks.
- Give each subagent a goal, scope, limits, and expected output. Verify its output before acting on it.
- Keep sensitive, destructive, production, credential, and external-messaging work local until explicitly approved.
```

---

### 2. `AGENTS.md` — `## Memory` section (lines 18–20)

**Current:**
```
## Memory
- Recall relevant memory at the start of non-trivial work.
- Save durable preferences, stable project facts, verified decisions, and reusable lessons — after verification.
- Never save speculation, secrets, credentials, private data, or noisy state.
```

**Patch — add one line:**
```
## Memory
- Recall relevant memory at the start of non-trivial work.
- Save durable preferences, stable project facts, verified decisions, and reusable lessons — after verification.
- Never save speculation, secrets, credentials, private data, or noisy state.
- When mem_* tools are unavailable: surface memory candidates explicitly in the ## Report section every turn so they can be saved when tools become available.
```

---

### 3. `vendor/amaze-subagents/skills/pi-subagents/SKILL.md` — `## When to Use` section

**Current opening:**
```
## When to Use

- **Advisory review**: use fresh-context `reviewer` agents for adversarial code ...
```

**Patch — prepend one rule block:**
```
## When to Use

- **Default routing (context-builder first)**: for any goal, plan, deploy, review, large implementation, or ambiguous request — always start with `context-builder` to compile a `runtime_instruction_contract` before delegating to planner/worker/reviewer/oracle. This is not optional. Direct single-agent delegation is only acceptable when context is already fully grounded.
- **Advisory review**: use fresh-context `reviewer` agents for adversarial code ...
```

---

## Notes

- `amaze.toml tools.mem.enabled = false` is the current state. The memory patch above ensures the orchestrator degrades gracefully by surfacing candidates in the report instead of silently losing them.
- No source code changes are needed. All three targets are instruction/skill files.
- The SKILL.md change takes effect at the next session start (skills are loaded once per session).
- The AGENTS.md changes take effect immediately in the running session since it is the live global rule file.
