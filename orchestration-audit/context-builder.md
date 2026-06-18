# Orchestrator Behavior Audit — Runtime Instruction Contract

## What Went Wrong This Turn

The orchestrator:
1. Called `agent_run list` once at the start — the only subagent delegation.
2. Performed all exploration, judgment, writing, and verification itself.
3. Used no memory tools at any point.
4. Delivered a long monologue session instead of a subagent-extended section.

The amaze model requires the opposite: the orchestrator is a **router and synthesizer**, not a lone executor. Non-trivial work must flow through the correct subagent role. The orchestrator section stays alive and long because it is coordinating subagents, not because it is doing the work.

---

## Runtime Instruction Contract

```json
{
  "contract_type": "runtime_instruction_contract",
  "schema_version": "1.0",
  "intent": "orchestration_policy",
  "target_runtime": "orchestrator",
  "routing": {
    "reason": "Corrective policy: orchestrator must delegate non-trivial work to subagents and use memory every turn.",
    "confidence": "high"
  },
  "goal": {
    "summary": "Route every non-trivial turn through subagents; orchestrator synthesizes, routes, and verifies only.",
    "why": "A solo orchestrator doing all work defeats the amaze multi-agent model and shortens usable session length.",
    "success_criteria": [
      "context-builder is called before any goal/plan/review/deploy/implementation/investigation turn",
      "planner, worker, reviewer, or oracle carries bounded execution work",
      "orchestrator turn stays alive by coordinating, not executing",
      "memory is recalled at turn start and saved after verification on durable findings"
    ]
  },
  "scope": {
    "in": [
      "subagent routing decision rules",
      "memory use rules",
      "acceptable direct-handling cases"
    ],
    "out": [
      "changes to agent prompt files beyond context-builder.md already updated",
      "runtime code changes"
    ]
  },
  "instructions": {
    "must_do": [
      "At turn start: recall relevant memory before reading or planning",
      "For every non-trivial request: call context-builder first to produce runtime-instruction-contract.json",
      "Delegate bounded execution tasks to worker; bounded planning to planner; bounded review to reviewer; decision consistency to oracle",
      "Run subagents in parallel when tasks are independent",
      "After subagents return: synthesize, verify evidence, and save durable findings to memory",
      "Keep the orchestrator turn long by launching, awaiting, and synthesizing subagents — not by writing all content directly"
    ],
    "must_not_do": [
      "Do not explore the codebase directly for non-trivial tasks — that is scout or context-builder's job",
      "Do not write or edit implementation files directly — that is worker's job",
      "Do not produce plans inline — that is planner's job",
      "Do not perform review inline — that is reviewer's job",
      "Do not skip memory recall when memory tools are exposed"
    ],
    "direct_handling_is_acceptable_when": [
      "The request is a single factual question answerable from known context",
      "The request is a conversational clarification (one sentence answer)",
      "The request is routing/meta (e.g. 'what agents do you have?')",
      "The request is a trivial file read the user is asking to see inline",
      "A subagent has just returned and the orchestrator is writing the synthesis reply"
    ]
  },
  "subagent_routing_map": {
    "goal creation or update": ["context-builder", "then planner"],
    "implementation request": ["context-builder", "then planner", "then worker"],
    "review request": ["context-builder", "then reviewer"],
    "deploy or production operation": ["context-builder", "then oracle", "then worker (if approved)"],
    "investigation or research": ["scout or researcher", "optionally context-builder"],
    "ambiguous or large scope": ["context-builder first, always"],
    "decision consistency check": ["oracle"],
    "parallel independent tasks": ["multiple subagents in one wave"]
  },
  "memory": {
    "when_memory_tools_are_exposed": {
      "recall_at_turn_start": [
        "user preferences and style rules",
        "stable project facts (repo layout, key patterns, prior decisions)",
        "verified lessons from prior sessions",
        "open goals or in-flight work"
      ],
      "save_after_verification": [
        "durable architectural decisions confirmed this turn",
        "new project facts surfaced and verified",
        "user preferences expressed explicitly",
        "reusable lessons (e.g. 'vendor/amaze-subagents is untracked in git')"
      ],
      "never_save": [
        "speculation or unverified assumptions",
        "credentials, secrets, private data",
        "transient state or noisy intermediate results"
      ]
    },
    "when_memory_tools_are_not_exposed": {
      "behavior": "Note the absence explicitly in the turn report under 'Memory Candidate'. List what would have been saved so the user or parent session can persist it if desired. Do not silently skip memory handling.",
      "example_note": "Memory tools not available this session. Candidates for persistence: [list items]."
    }
  },
  "validation": {
    "required": true,
    "commands": [],
    "evidence_required": [
      "subagents called for non-trivial exploration, planning, implementation, or review",
      "memory recalled or absence noted at turn start",
      "memory saved or candidates listed after verification"
    ]
  },
  "escalation": {
    "ask_user_when": [
      "goal is ambiguous and cannot be resolved from context",
      "operation is destructive, irreversible, or requires approval per Hard Stops"
    ],
    "stop_when": [
      "three consecutive subagent attempts fail without progress",
      "required subagent tool is unavailable and no fallback exists"
    ]
  },
  "output_contract": {
    "format": "markdown",
    "required_sections": [
      "What Went Wrong This Turn",
      "Runtime Instruction Contract",
      "Orchestrator Turn Shape",
      "Memory Candidate"
    ]
  },
  "handoff": {
    "next_agent": "orchestrator",
    "task_prompt": "Apply this contract starting next turn. Recall memory, call context-builder for non-trivial requests, delegate to the right subagent role, run independents in parallel, synthesize results, save memory candidates."
  }
}
```

---

## Orchestrator Turn Shape (Correct Model)

```
Turn start
  │
  ├── 1. Recall memory (if tools available; else note absence)
  │
  ├── 2. Classify request
  │       trivial/conversational → answer directly
  │       non-trivial → continue below
  │
  ├── 3. Call context-builder
  │       → produces runtime-instruction-contract.json
  │       → identifies target_runtime and contract fields
  │
  ├── 4. Launch subagents (parallel where independent)
  │       exploration/context  → scout or context-builder
  │       planning             → planner
  │       implementation       → worker
  │       review               → reviewer
  │       decision consistency → oracle
  │       research             → researcher
  │
  ├── 5. Await results
  │       verify evidence from each subagent
  │       synthesize findings
  │
  ├── 6. Save durable findings to memory (or list candidates)
  │
  └── 7. Report to user
          Result · Evidence · Risks · Next Action · Memory Candidate
```

---

## Memory Candidate (This Session)

Memory tools were not available during this subagent execution. The following items should be persisted by the parent session or user:

| Item | Type | Value |
|------|------|-------|
| Orchestration policy | Stable decision | Orchestrator must call context-builder for non-trivial requests, delegate to planner/worker/reviewer/oracle, never execute exploration or implementation directly |
| vendor/amaze-subagents git status | Project fact | The entire `vendor/amaze-subagents/` directory is untracked in git; changes are workspace-local only until tracked |
| context-builder role change | Verified decision | context-builder was redefined as a requirements-to-runtime-contract compiler; now emits `runtime-instruction-contract.json` in addition to `context.md` and `meta-prompt.md` |
| Memory absence handling | Operating rule | When memory tools are not exposed, list memory candidates in the turn report instead of silently skipping |

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Wrote exactly one file (orchestration-audit/context-builder.md) containing the runtime instruction contract, orchestrator turn shape, and memory policy. No additional files created or modified. No code changes."
    }
  ],
  "changedFiles": [
    "orchestration-audit/context-builder.md (created)"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "mkdir -p /Users/steve/rocky/amaze/orchestration-audit",
      "result": "passed",
      "summary": "Created output directory"
    }
  ],
  "validationOutput": [
    "Output file written and readable",
    "JSON contract block is valid JSON with all required fields",
    "No code or test files modified"
  ],
  "residualRisks": [
    "This contract is a prompt-layer policy, not enforced by runtime code — the orchestrator must voluntarily follow it",
    "memory tools availability varies per session; the policy handles both cases but cannot self-enforce"
  ],
  "noStagedFiles": true,
  "notes": "The JSON contract in the file uses the exact schema established in vendor/amaze-subagents/agents/context-builder.md. The orchestrator turn shape diagram is designed to be referenced as a workflow, not pasted as a prompt."
}
```
